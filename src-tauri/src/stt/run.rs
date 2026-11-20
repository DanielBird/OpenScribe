//! The worker process: `describe.exe --stt-worker` (DECISIONS.md D51, D53). It reads one job on stdin, transcribes,
//! writes events on stdout and exits. The app ends it to cancel, which frees everything at once.
//!
//! Three threads: the decoder feeds both models through small bounded channels, so memory stays constant however long
//! the recording; the words model works through 30 s pieces (`chunks.rs`); the speakers model takes the whole
//! recording as one stream. The models run at the same time, as Phase 33 measured them, on the processor or both on
//! the job's graphics card (Phase 37).
//!
//! `describe.exe --stt-worker --devices <dir>` instead lists the graphics cards the engine in `dir` finds, in one line,
//! and exits. It is a process of its own so that a driver that crashes or hangs while listing can't take the app with
//! it.

use super::chunks::Chunker;
use super::decode::DecodeError;
use super::error::{SttErrorKind, without_path};
use super::nemo::{Api, EngineError, Registry, Speakers, Words, gpu_index, gpus};
use super::protocol::{DEVICES_FLAG, Device, Event, GpuDevice, Job, Segment, Timings, Word, WorkerResult};
use std::io::{BufRead, Write};
use std::path::Path;
use std::sync::mpsc::{Receiver, Sender, SyncSender, channel, sync_channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Decoded audio goes to the models in blocks of this length.
const BLOCK_SEC: f64 = 5.0;
/// The speakers model is pushed this much at a time, as Phase 33 pushed it.
const SPEAKERS_PUSH_SEC: f64 = 30.0;
/// Blocks waiting for each model: 40 s of audio, about 2.5 MB.
const QUEUE: usize = 8;
/// Progress at most this often.
const PROGRESS_EVERY: Duration = Duration::from_millis(500);

type Block = (u32, Arc<Vec<f32>>);

enum Msg {
  Opened { duration_sec: Option<f64> },
  Decoded { seconds: f64, decode_sec: f64 },
  WordsAt(f64),
  SpeakersAt(f64),
  Words { words: Vec<Word>, languages: Vec<String>, seconds: f64 },
  Speakers { segments: Vec<Segment>, seconds: f64 },
  Failed(SttErrorKind, String),
}

/// Writes events to stdout, one per line, flushed at once.
pub struct Emitter<W: Write>(pub W);

impl<W: Write> Emitter<W> {
  pub fn emit(&mut self, event: &Event) {
    let _ = writeln!(self.0, "{}", event.to_line());
    let _ = self.0.flush();
  }
}

/// The worker's exit code when the app has gone.
const APP_GONE: i32 = 3;
/// The worker's exit code when the job's card isn't there (`Event::DeviceMissing`).
const DEVICE_MISSING: i32 = 4;
/// The engine's `gpu` for the processor.
const PROCESSOR: i32 = -1;

/// The worker's stdout, a pipe to the app. A write that fails means the app has gone (closed, crashed, or it has let
/// go of this run), so the worker calls `gone` at once rather than transcribe for no one. Normally the job object has
/// ended the worker before that (`worker.rs`). Noticed at the next event: about every 500 ms while decoding, later
/// during a model's load or the speakers model's final flush.
pub struct ToApp<W: Write> {
  out: W,
  gone: fn(),
}

impl<W: Write> ToApp<W> {
  fn checked<T>(&self, result: std::io::Result<T>) -> std::io::Result<T> {
    if result.is_err() {
      (self.gone)();
    }
    result
  }
}

impl<W: Write> Write for ToApp<W> {
  fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
    let result = self.out.write(buf);
    self.checked(result)
  }

  fn flush(&mut self) -> std::io::Result<()> {
    let result = self.out.flush();
    self.checked(result)
  }
}

/// The worker's entry point. Returns the process's exit code.
pub fn main() -> i32 {
  let mut emitter = Emitter(ToApp { out: std::io::stdout().lock(), gone: || std::process::exit(APP_GONE) });
  let args: Vec<String> = std::env::args().collect();
  if let Some(at) = args.iter().position(|a| a == DEVICES_FLAG) {
    let dir = args.get(at + 1).map(std::path::PathBuf::from).unwrap_or_default();
    emitter.emit(&Event::Devices { devices: cards(&dir).unwrap_or_default() });
    return 0;
  }
  // From the app, on stdin. For timing runs by hand (pinrun doesn't pass stdin on): `--stt-worker --job <file>`.
  let mut line = String::new();
  let read = match args.iter().skip_while(|a| *a != "--job").nth(1) {
    Some(path) => std::fs::read_to_string(path).map(|text| line = text).is_ok(),
    None => std::io::stdin().lock().read_line(&mut line).is_ok(),
  };
  let job: Job = match read.then(|| serde_json::from_str(&line).ok()).flatten() {
    Some(job) => job,
    None => {
      emitter.emit(&Event::Failed { kind: SttErrorKind::Engine, detail: "the worker got no job".into() });
      return 2;
    }
  };
  if let Some(script) = job.fake.clone().filter(|_| cfg!(debug_assertions)) {
    if let Some(reason) = fake_card_missing(&job, &super::fake::devices().unwrap_or_default()) {
      emitter.emit(&Event::DeviceMissing { reason });
      return DEVICE_MISSING;
    }
    if job.device.is_some() {
      emitter.emit(&Event::DeviceFound);
    }
    return super::fake::run(&script, job.device.as_ref(), &mut emitter);
  }
  let gpu = match &job.device {
    None => PROCESSOR,
    Some(device) => match card_index(&job.runtime_dir, device) {
      Ok(gpu) => {
        emitter.emit(&Event::DeviceFound);
        gpu
      }
      Err(reason) => {
        emitter.emit(&Event::DeviceMissing { reason });
        return DEVICE_MISSING;
      }
    },
  };
  match transcribe(&job, gpu, &mut emitter) {
    Ok(result) => {
      emitter.emit(&Event::Done(result));
      0
    }
    Err((kind, detail)) => {
      let detail = clean(&detail, &job);
      emitter.emit(&Event::Failed { kind, detail });
      1
    }
  }
}

/// The graphics cards the engine in `dir` finds, or why it won't load (for the Vulkan engine, Windows without
/// `vulkan-1.dll`), with no path. The probe drops the reason; a run's `DeviceMissing` carries it (audit GPU-3).
fn cards(dir: &Path) -> Result<Vec<GpuDevice>, String> {
  match Registry::load(dir) {
    Ok(registry) => Ok(gpus(&registry.list())),
    Err(error) => Err(format!("the Vulkan engine didn't load: {}", without_path(&error, dir, "<runtime>"))),
  }
}

/// The engine's `gpu` for `device`, if the engine in `dir` loads and finds it; else why not (audit GPU-3).
fn card_index(dir: &Path, device: &Device) -> Result<i32, String> {
  let listed = cards(dir)?;
  gpu_index(&listed, device).ok_or_else(|| not_listed(&listed))
}

/// Why a card isn't among `listed`: what the engine found instead, by the drivers' names.
fn not_listed(listed: &[GpuDevice]) -> String {
  if listed.is_empty() {
    return "the Vulkan engine found no graphics card".into();
  }
  let names: Vec<&str> = listed.iter().map(|d| d.name.as_str()).collect();
  format!("the Vulkan engine found only {}", names.join(", "))
}

/// Why a scripted run's card is missing from the made-up cards (`fake.rs`), as the engine's would be; none if it's
/// there or the run is on the processor.
fn fake_card_missing(job: &Job, devices: &[GpuDevice]) -> Option<String> {
  let device = job.device.as_ref()?;
  gpu_index(devices, device).is_none().then(|| not_listed(devices))
}

/// A detail with the job's paths replaced, so it never shows where the recording or the user's files are.
fn clean(detail: &str, job: &Job) -> String {
  let detail = without_path(detail, &job.recording, "<recording>");
  let detail = without_path(&detail, &job.words_model, "<words model>");
  let detail = without_path(&detail, &job.speakers_model, "<speakers model>");
  without_path(&detail, &job.runtime_dir, "<runtime>")
}

/// A model's failure: on a card it is the card's, `gpu` (Phase 37, decision 6), out of memory included.
fn engine_failure(error: &EngineError, gpu: i32) -> Msg {
  let kind = match (gpu != PROCESSOR, error.is_out_of_memory()) {
    (true, _) => SttErrorKind::Gpu,
    (false, true) => SttErrorKind::OutOfMemory,
    (false, false) => SttErrorKind::Engine,
  };
  Msg::Failed(kind, error.to_string())
}

/// The decoder's failure, never the card's, whichever the run is on (audit GPU-1).
fn decode_failure(error: &DecodeError) -> Msg {
  let kind = if error.stage.starts_with("starting Media Foundation") { SttErrorKind::Engine } else { SttErrorKind::Unreadable };
  Msg::Failed(kind, error.detail())
}

/// Where a run's models ran, for its timings.
struct RanOn {
  /// The words model's threads, on the processor.
  threads: Option<u32>,
  /// The job's card, on a card.
  device: Option<Device>,
}

/// Where the models load, and the lock that loads them one at a time on a card. ggml-vulkan creates a card's device
/// the first time a model asks for it, without a lock (`ggml_vk_get_device`): two models loading at once both create
/// one, and the first is freed under its model ("vkCreateFence: Invalid device", then an abort; Phase 37, Task 3).
/// Once loaded they share the device, which guards its own queue. On the processor they load together, as before.
struct Loading {
  gpu: i32,
  lock: Mutex<()>,
}

impl Loading {
  fn load<T>(&self, load: impl FnOnce(i32) -> T) -> T {
    let _one_at_a_time = (self.gpu != PROCESSOR).then(|| self.lock.lock().unwrap_or_else(|e| e.into_inner()));
    load(self.gpu)
  }

  /// A model's failure where the models run.
  fn failure(&self, error: &EngineError) -> Msg {
    engine_failure(error, self.gpu)
  }
}

/// Transcribes `job` on the processor (`gpu` -1) or the card `gpu` counts to, both models alike.
fn transcribe<W: Write>(job: &Job, gpu: i32, emitter: &mut Emitter<W>) -> Result<WorkerResult, (SttErrorKind, String)> {
  let started = Instant::now();
  // On a card this is the Vulkan engine, which the processor's engine can stand in for.
  let unloadable = if gpu == PROCESSOR { SttErrorKind::Engine } else { SttErrorKind::Gpu };
  let api = Api::load(&job.runtime_dir).map_err(|e| (unloadable, e))?;
  let ran_on = match job.device.as_ref().filter(|_| gpu != PROCESSOR) {
    Some(device) => RanOn { threads: None, device: Some(device.clone()) },
    None => RanOn {
      threads: Some(std::thread::available_parallelism().map(|n| n.get().min(8) as u32).unwrap_or(8)),
      device: None,
    },
  };
  let (to_main, messages) = channel::<Msg>();
  let (to_words, words_in) = sync_channel::<Block>(QUEUE);
  let (to_speakers, speakers_in) = sync_channel::<Block>(QUEUE);

  let loading = Loading { gpu, lock: Mutex::new(()) };

  std::thread::scope(|scope| {
    let (api, loading) = (&api, &loading);
    let tx = to_main.clone();
    scope.spawn(move || decoder_thread(&job.recording, to_words, to_speakers, tx));
    let tx = to_main.clone();
    scope.spawn(move || words_thread(api, &job.words_model, loading, words_in, tx, started));
    let tx = to_main.clone();
    scope.spawn(move || speakers_thread(api, &job.speakers_model, loading, speakers_in, tx, started));
    drop(to_main);
    collect(messages, emitter, started, ran_on)
  })
}

/// Turns the threads' messages into events, and their results into the worker's. Returns at the first failure, but
/// `transcribe`'s scope still waits for the other threads to work through their queues, so the app ends the worker
/// as soon as it reads `Failed` (`worker.rs`).
fn collect<W: Write>(
  messages: Receiver<Msg>,
  emitter: &mut Emitter<W>,
  started: Instant,
  ran_on: RanOn,
) -> Result<WorkerResult, (SttErrorKind, String)> {
  let (mut words_at, mut speakers_at, mut reported) = (0.0f64, 0.0f64, Instant::now() - PROGRESS_EVERY);
  let (mut decoded, mut words, mut speakers) = (None, None, None);
  for message in messages {
    match message {
      Msg::Opened { duration_sec } => emitter.emit(&Event::Started { duration_sec }),
      Msg::Decoded { seconds, decode_sec } => decoded = Some((seconds, decode_sec)),
      Msg::WordsAt(at) => words_at = at,
      Msg::SpeakersAt(at) => speakers_at = at,
      Msg::Words { words: w, languages, seconds } => words = Some((w, languages, seconds)),
      Msg::Speakers { segments, seconds } => speakers = Some((segments, seconds)),
      Msg::Failed(kind, detail) => return Err((kind, detail)),
    }
    if reported.elapsed() >= PROGRESS_EVERY && words.is_none() {
      reported = Instant::now();
      emitter.emit(&Event::Progress { done_sec: words_at.min(speakers_at) });
    }
    if decoded.is_some() && words.is_some() && speakers.is_some() {
      break;
    }
  }
  match (decoded, words, speakers) {
    (Some((duration_sec, decode_sec)), Some((words, languages, words_sec)), Some((speaker_segments, speakers_sec))) => {
      Ok(WorkerResult {
        language: languages.into_iter().next(),
        duration_sec,
        words,
        speaker_segments,
        timings: Timings {
          decode_sec,
          words_sec,
          speakers_sec,
          total_sec: started.elapsed().as_secs_f64(),
          threads: ran_on.threads,
          device: ran_on.device,
        },
      })
    }
    _ => Err((SttErrorKind::Engine, "a part of the engine stopped without a result".into())),
  }
}

fn decoder_thread(path: &std::path::Path, words: SyncSender<Block>, speakers: SyncSender<Block>, tx: Sender<Msg>) {
  #[cfg(windows)]
  {
    let mut decoder = match super::decode::Decoder::open(path) {
      Ok(decoder) => decoder,
      Err(error) => {
        let _ = tx.send(decode_failure(&error));
        return;
      }
    };
    let _ = tx.send(Msg::Opened { duration_sec: decoder.duration_sec() });
    let rate = decoder.rate();
    let block = (BLOCK_SEC * rate as f64) as usize;
    let mut busy = Duration::ZERO;
    let mut total = 0u64;
    let mut pending = Vec::with_capacity(block * 2);
    loop {
      let t = Instant::now();
      let more = match decoder.next_block(&mut pending) {
        Ok(more) => more,
        Err(error) => {
          let _ = tx.send(decode_failure(&error));
          return;
        }
      };
      busy += t.elapsed();
      if pending.len() >= block || (!more && !pending.is_empty()) {
        total += pending.len() as u64;
        let shared = Arc::new(std::mem::replace(&mut pending, Vec::with_capacity(block * 2)));
        // A model that has stopped (its thread failed) no longer listens; the failure is already on its way.
        if words.send((rate, Arc::clone(&shared))).is_err() || speakers.send((rate, shared)).is_err() {
          return;
        }
      }
      if !more {
        break;
      }
    }
    let _ = tx.send(Msg::Decoded { seconds: total as f64 / rate as f64, decode_sec: busy.as_secs_f64() });
  }
  #[cfg(not(windows))]
  {
    let _ = (path, words, speakers);
    let _ = tx.send(Msg::Failed(SttErrorKind::Engine, "decoding needs Windows".into()));
  }
}

/// One `recognize` per 30 s piece, in order: never several pieces at once, which a card gets wrong (`nemo.rs`).
fn words_thread(api: &Api, model: &Path, loading: &Loading, input: Receiver<Block>, tx: Sender<Msg>, started: Instant) {
  let mut model = match loading.load(|gpu| Words::load(api, model, gpu)) {
    Ok(model) => model,
    Err(error) => {
      let _ = tx.send(loading.failure(&error));
      return;
    }
  };
  let mut chunker: Option<(u32, Chunker)> = None;
  let mut words = Vec::new();
  let mut recognise = |model: &mut Words, rate: u32, piece: super::chunks::Piece| -> Result<f64, EngineError> {
    let found = model.recognize(&piece.samples, rate)?;
    words.extend(found.into_iter().filter(|w| piece.keeps(rate, w.start, w.end)).map(|w| Word {
      text: w.text,
      start: piece.start_sec + w.start,
      end: piece.start_sec + w.end,
      confidence: Some(w.confidence),
    }));
    let (_, own_end) = piece.own_part(rate);
    Ok(if own_end.is_finite() { own_end } else { piece.start_sec + piece.len_sec(rate) })
  };
  for (rate, block) in input {
    let (_, chunks) = chunker.get_or_insert_with(|| (rate, Chunker::new(rate)));
    for piece in chunks.push(&block) {
      match recognise(&mut model, rate, piece) {
        Ok(at) => {
          let _ = tx.send(Msg::WordsAt(at));
        }
        Err(error) => {
          let _ = tx.send(loading.failure(&error));
          return;
        }
      }
    }
  }
  if let Some((rate, chunks)) = chunker
    && let Some(piece) = chunks.finish()
    && let Err(error) = recognise(&mut model, rate, piece)
  {
    let _ = tx.send(loading.failure(&error));
    return;
  }
  let languages = std::mem::take(&mut model.languages);
  let _ = tx.send(Msg::Words { words, languages, seconds: started.elapsed().as_secs_f64() });
}

fn speakers_thread(
  api: &Api,
  model: &Path,
  loading: &Loading,
  input: Receiver<Block>,
  tx: Sender<Msg>,
  started: Instant,
) {
  let mut model = match loading.load(|gpu| Speakers::load(api, model, gpu)) {
    Ok(model) => model,
    Err(error) => {
      let _ = tx.send(loading.failure(&error));
      return;
    }
  };
  let mut pending: Vec<f32> = Vec::new();
  let mut rate = 16_000;
  let mut pushed = 0u64;
  for (block_rate, block) in input {
    rate = block_rate;
    pending.extend_from_slice(&block);
    if pending.len() as f64 >= SPEAKERS_PUSH_SEC * rate as f64 {
      if let Err(error) = model.push(&pending, rate) {
        let _ = tx.send(loading.failure(&error));
        return;
      }
      pushed += pending.len() as u64;
      pending.clear();
      let _ = tx.send(Msg::SpeakersAt(pushed as f64 / rate as f64));
    }
  }
  if !pending.is_empty()
    && let Err(error) = model.push(&pending, rate)
  {
    let _ = tx.send(loading.failure(&error));
    return;
  }
  match model.finish() {
    Ok(raw) => {
      let segments = raw.into_iter().map(|s| Segment { speaker: s.speaker, start: s.start, end: s.end }).collect();
      let _ = tx.send(Msg::Speakers { segments, seconds: started.elapsed().as_secs_f64() });
    }
    Err(error) => {
      let _ = tx.send(loading.failure(&error));
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicUsize, Ordering};

  /// A pipe whose reader has gone.
  struct Broken;

  impl Write for Broken {
    fn write(&mut self, _buf: &[u8]) -> std::io::Result<usize> {
      Err(std::io::ErrorKind::BrokenPipe.into())
    }

    fn flush(&mut self) -> std::io::Result<()> {
      Err(std::io::ErrorKind::BrokenPipe.into())
    }
  }

  static GONE: AtomicUsize = AtomicUsize::new(0);

  #[test]
  fn the_worker_notices_when_the_app_has_gone() {
    let mut emitter = Emitter(ToApp { out: Vec::new(), gone: || panic!("the app is still there") });
    emitter.emit(&Event::Progress { done_sec: 1.0 });
    assert!(!emitter.0.out.is_empty());

    let mut emitter = Emitter(ToApp { out: Broken, gone: || _ = GONE.fetch_add(1, Ordering::SeqCst) });
    emitter.emit(&Event::Progress { done_sec: 1.0 });
    assert!(GONE.load(Ordering::SeqCst) >= 1);
  }

  #[test]
  fn a_scripted_run_finds_its_card_among_the_made_up_ones() {
    use super::super::protocol::GpuKind;
    let card = |name: &str| GpuDevice { name: name.into(), kind: GpuKind::Gpu, memory_bytes: 1 };
    let job = |device: Option<Device>| Job {
      recording: "a.wav".into(),
      runtime_dir: "r".into(),
      words_model: "w".into(),
      speakers_model: "s".into(),
      fake: Some("f.json".into()),
      device,
    };
    let on = |name: &str, nth| Some(Device { name: name.into(), nth });
    let two_alike = [card("RTX"), card("RTX")];
    assert_eq!(fake_card_missing(&job(None), &[]), None, "the processor needs no card");
    assert_eq!(fake_card_missing(&job(on("RTX", 1)), &two_alike), None);
    let only = Some("the Vulkan engine found only RTX, RTX".to_string());
    assert_eq!(fake_card_missing(&job(on("RTX", 2)), &two_alike), only);
    assert_eq!(fake_card_missing(&job(on("UHD", 0)), &two_alike), only);
    assert_eq!(fake_card_missing(&job(on("RTX", 0)), &[]), Some("the Vulkan engine found no graphics card".into()));
  }

  /// Audit GPU-3: an engine that won't load says why, without its folder, so a run's record can tell it from a card
  /// that isn't there.
  #[test]
  fn an_engine_that_wont_load_says_why() {
    let dir = std::env::temp_dir().join(format!("describe-no-engine-{}", std::process::id()));
    let reason = cards(&dir).unwrap_err();
    assert!(reason.starts_with("the Vulkan engine didn't load: "), "{reason}");
    assert!(!reason.contains(&*dir.to_string_lossy()), "{reason}");
    let device = Device { name: "AMD Radeon 740M Graphics".into(), nth: 0 };
    assert_eq!(card_index(&dir, &device), Err(reason));
  }

  /// Audit GPU-1: a model's failure on a card is the card's; on the processor it stays the engine's.
  #[test]
  fn a_models_failure_is_the_cards_only_on_a_card() {
    let kind = |gpu, message: &str| {
      let Msg::Failed(kind, detail) = engine_failure(&EngineError { status: 3, message: message.into() }, gpu) else {
        panic!("not a failure")
      };
      assert!(detail.contains(message));
      kind
    };
    assert_eq!(kind(0, "ggml_vulkan: ErrorDeviceLost"), SttErrorKind::Gpu);
    assert_eq!(kind(1, "ggml_vulkan: out of memory"), SttErrorKind::Gpu);
    assert_eq!(kind(PROCESSOR, "recognize failed"), SttErrorKind::Engine);
    assert_eq!(kind(PROCESSOR, "out of memory"), SttErrorKind::OutOfMemory);
    let loading = Loading { gpu: 0, lock: Mutex::new(()) };
    let error = EngineError { status: 3, message: "x".into() };
    assert!(matches!(loading.failure(&error), Msg::Failed(SttErrorKind::Gpu, _)));

    // The decoder's failures are never the card's: it has no say in where the models run.
    let decoding = |stage| decode_failure(&DecodeError { stage, hresult: 0x8007_0005_u32 as i32, message: "x".into() });
    assert!(matches!(decoding("starting Media Foundation"), Msg::Failed(SttErrorKind::Engine, _)));
    assert!(matches!(decoding("reading a sample"), Msg::Failed(SttErrorKind::Unreadable, _)));
  }

  /// Removes the scratch folder, even when the test panics.
  struct Scratch(std::path::PathBuf);

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  fn here() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
  }

  /// The processor engine, or the Vulkan engine beside it (`npm run desktop:stt-runtime`). One per test process, as
  /// one per worker: their DLLs share names, so a second engine would bind to the first one's ggml. Run the card's
  /// tests on their own: `cargo test -- --ignored on_a_card`, then `-- --ignored on_the_processor`.
  fn engine(vulkan: bool) -> std::path::PathBuf {
    static FIRST: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let first = *FIRST.get_or_init(|| vulkan);
    assert_eq!(first, vulkan, "one engine per test process: run the card's tests and the processor's separately");
    let dir = if vulkan { here().join("stt-runtime").join("vulkan") } else { here().join("stt-runtime") };
    assert!(dir.join("nemo_speech_asr_c.dll").is_file(), "no engine in {}: run npm run desktop:stt-runtime", dir.display());
    dir
  }

  /// The card the opt-in tests use: `DESCRIBE_STT_TEST_GPU` (default 0), by its place among the Vulkan engine's cards.
  fn test_card() -> Device {
    let at: usize = std::env::var("DESCRIBE_STT_TEST_GPU").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let listed = cards(&engine(true)).expect("the Vulkan engine loads");
    let card = listed.get(at).unwrap_or_else(|| panic!("no card {at} among {listed:?}"));
    let nth = listed[..at].iter().filter(|g| g.name == card.name).count() as u32;
    Device { name: card.name.clone(), nth }
  }

  /// Audit DES-1: a Windows user name such as "Søren Müller" puts non-ASCII letters in the models' paths. The engine
  /// opens them with `ggml_fopen` (UTF-8, then `_wfopen`), so they must load. Run on a PC whose ANSI code page isn't
  /// UTF-8, or a narrow open would pass here too. Needs the real engine and models, so it's opt-in:
  /// `cargo test -- --ignored on_the_processor`.
  #[test]
  #[ignore = "needs src-tauri/stt-runtime and .speech-pack: npm run desktop:stt-runtime, npm run desktop:fetch-models"]
  fn model_paths_with_non_ascii_letters_load_on_the_processor() {
    let result = run_in_a_non_ascii_folder(engine(false), None);
    assert_eq!(result.timings.device, None);
    assert!(result.timings.threads.is_some());
  }

  /// The same on a card (Phase 37), both models on it: `DESCRIBE_STT_TEST_GPU` picks which.
  #[test]
  #[ignore = "needs src-tauri/stt-runtime/vulkan, .speech-pack and a graphics card"]
  fn model_paths_with_non_ascii_letters_load_on_a_card() {
    let card = test_card();
    let result = run_in_a_non_ascii_folder(engine(true), Some(card.clone()));
    assert_eq!(result.timings.device, Some(card));
    assert_eq!(result.timings.threads, None);
  }

  #[test]
  #[ignore = "needs src-tauri/stt-runtime/vulkan and a graphics card"]
  fn the_engine_lists_the_cards_on_a_card() {
    let listed = cards(&engine(true)).expect("the Vulkan engine loads");
    assert!(!listed.is_empty(), "no card found");
    assert!(listed.iter().all(|g| !g.name.is_empty() && g.memory_bytes > 0), "{listed:?}");
    assert!(card_index(&engine(true), &test_card()).is_ok());
    let missing = card_index(&engine(true), &Device { name: "No Such Card".into(), nth: 0 }).unwrap_err();
    assert!(missing.starts_with("the Vulkan engine found only "), "{missing}");
  }

  #[test]
  #[ignore = "needs src-tauri/stt-runtime"]
  fn no_cards_are_listed_on_the_processor() {
    assert_eq!(cards(&engine(false)), Ok(vec![]), "the processor engine has no GPU backend");
  }

  /// Transcribes `tone-5s.wav` from a folder whose path has non-ASCII letters, with the engine in `runtime_dir`.
  fn run_in_a_non_ascii_folder(runtime_dir: std::path::PathBuf, device: Option<Device>) -> WorkerResult {
    use super::super::pack::{self, Role};
    let here = here();
    let def = pack::compiled();
    let pack_dir = here.join("..").join(".speech-pack").join(&def.id);

    let scratch = Scratch(std::env::temp_dir().join(format!(
      "describe-Søren-Müller-æøå-{}-{}",
      std::process::id(),
      if device.is_some() { "card" } else { "cpu" }
    )));
    std::fs::create_dir_all(&scratch.0).unwrap();
    let place = |role: Role| {
      let file = &def.model(role).expect("the pack names both models").file;
      let from = pack_dir.join(file);
      assert!(from.is_file(), "no {file}: run npm run desktop:fetch-models");
      let to = scratch.0.join(file);
      if std::fs::hard_link(&from, &to).is_err() {
        std::fs::copy(&from, &to).unwrap();
      }
      to
    };
    let words_model = place(Role::Words);
    let speakers_model = place(Role::Speakers);
    let recording = scratch.0.join("opptak-ø.wav");
    std::fs::copy(here.join("..").join("fixtures").join("audio").join("tone-5s.wav"), &recording).unwrap();
    assert!(!words_model.to_string_lossy().is_ascii());

    let gpu = match &device {
      Some(card) => card_index(&runtime_dir, card).expect("the card is listed"),
      None => PROCESSOR,
    };
    let job = Job { recording, runtime_dir, words_model, speakers_model, fake: None, device };
    let result = transcribe(&job, gpu, &mut Emitter(Vec::new()));
    assert!(result.is_ok(), "{:?}", result.err().map(|(kind, detail)| (kind, clean(&detail, &job))));
    let result = result.unwrap();
    assert_eq!(result.duration_sec.round(), 5.0);
    result
  }
}
