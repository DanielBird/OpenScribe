//! The worker process: `describe.exe --stt-worker` (DECISIONS.md D51, D53). It reads one job on stdin, transcribes,
//! writes events on stdout and exits. The app ends it to cancel, which frees everything at once.
//!
//! Three threads: the decoder feeds both models through small bounded channels, so memory stays constant however long
//! the recording; the words model works through 30 s pieces (`chunks.rs`); the speakers model takes the whole
//! recording as one stream. The models run at the same time, as Phase 33 measured them.

use super::chunks::Chunker;
use super::decode::DecodeError;
use super::error::{SttErrorKind, without_path};
use super::nemo::{Api, EngineError, Speakers, Words};
use super::protocol::{Event, Job, Segment, Timings, Word, WorkerResult};
use std::io::{BufRead, Write};
use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender, SyncSender, channel, sync_channel};
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

/// The worker's entry point. Returns the process's exit code.
pub fn main() -> i32 {
  let mut emitter = Emitter(std::io::stdout().lock());
  // From the app, on stdin. For timing runs by hand (pinrun doesn't pass stdin on): `--stt-worker --job <file>`.
  let mut line = String::new();
  let read = match std::env::args().skip_while(|a| a != "--job").nth(1) {
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
    return super::fake::run(&script, &mut emitter);
  }
  match transcribe(&job, &mut emitter) {
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

/// A detail with the job's paths replaced, so it never shows where the recording or the user's files are.
fn clean(detail: &str, job: &Job) -> String {
  let detail = without_path(detail, &job.recording, "<recording>");
  let detail = without_path(&detail, &job.words_model, "<words model>");
  let detail = without_path(&detail, &job.speakers_model, "<speakers model>");
  without_path(&detail, &job.runtime_dir, "<runtime>")
}

fn engine_failure(error: &EngineError) -> Msg {
  let kind = if error.is_out_of_memory() { SttErrorKind::OutOfMemory } else { SttErrorKind::Engine };
  Msg::Failed(kind, error.to_string())
}

fn decode_failure(error: &DecodeError) -> Msg {
  let kind = if error.stage.starts_with("starting Media Foundation") { SttErrorKind::Engine } else { SttErrorKind::Unreadable };
  Msg::Failed(kind, error.detail())
}

fn transcribe<W: Write>(job: &Job, emitter: &mut Emitter<W>) -> Result<WorkerResult, (SttErrorKind, String)> {
  let started = Instant::now();
  let api = Api::load(&job.runtime_dir).map_err(|e| (SttErrorKind::Engine, e))?;
  let threads = std::thread::available_parallelism().map(|n| n.get().min(8) as u32).unwrap_or(8);
  let (to_main, messages) = channel::<Msg>();
  let (to_words, words_in) = sync_channel::<Block>(QUEUE);
  let (to_speakers, speakers_in) = sync_channel::<Block>(QUEUE);

  std::thread::scope(|scope| {
    let api = &api;
    let tx = to_main.clone();
    scope.spawn(move || decoder_thread(&job.recording, to_words, to_speakers, tx));
    let tx = to_main.clone();
    scope.spawn(move || words_thread(api, &job.words_model, words_in, tx, started));
    let tx = to_main.clone();
    scope.spawn(move || speakers_thread(api, &job.speakers_model, speakers_in, tx, started));
    drop(to_main);
    collect(messages, emitter, started, threads)
  })
}

/// Turns the threads' messages into events, and their results into the worker's. Returns at the first failure: the
/// process then exits, which stops the other threads.
fn collect<W: Write>(
  messages: Receiver<Msg>,
  emitter: &mut Emitter<W>,
  started: Instant,
  threads: u32,
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
        timings: Timings { decode_sec, words_sec, speakers_sec, total_sec: started.elapsed().as_secs_f64(), threads },
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

fn words_thread(api: &Api, model: &std::path::Path, input: Receiver<Block>, tx: Sender<Msg>, started: Instant) {
  let mut model = match Words::load(api, model) {
    Ok(model) => model,
    Err(error) => {
      let _ = tx.send(engine_failure(&error));
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
          let _ = tx.send(engine_failure(&error));
          return;
        }
      }
    }
  }
  if let Some((rate, chunks)) = chunker
    && let Some(piece) = chunks.finish()
    && let Err(error) = recognise(&mut model, rate, piece)
  {
    let _ = tx.send(engine_failure(&error));
    return;
  }
  let languages = std::mem::take(&mut model.languages);
  let _ = tx.send(Msg::Words { words, languages, seconds: started.elapsed().as_secs_f64() });
}

fn speakers_thread(api: &Api, model: &std::path::Path, input: Receiver<Block>, tx: Sender<Msg>, started: Instant) {
  let mut model = match Speakers::load(api, model) {
    Ok(model) => model,
    Err(error) => {
      let _ = tx.send(engine_failure(&error));
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
        let _ = tx.send(engine_failure(&error));
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
    let _ = tx.send(engine_failure(&error));
    return;
  }
  match model.finish() {
    Ok(raw) => {
      let segments = raw.into_iter().map(|s| Segment { speaker: s.speaker, start: s.start, end: s.end }).collect();
      let _ = tx.send(Msg::Speakers { segments, seconds: started.elapsed().as_secs_f64() });
    }
    Err(error) => {
      let _ = tx.send(engine_failure(&error));
    }
  }
}
