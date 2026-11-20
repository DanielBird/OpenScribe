//! The commands the page may call, each granted in `capabilities/default.json` (`build.rs` lists them), and the
//! native drop on the window. Errors are a kind and a detail (`error.rs`), never a path outside the pack.

use super::download::{self, DownloadError, DownloadErrorKind, Downloading};
use super::error::{SttError, SttErrorKind};
use super::pack::{self, PackState, SpeechPackInfo, Unusable};
use super::protocol::{Device, Event, GpuDevice, Job, Segment, Word};
use super::worker::{self, Finished, ListingHung, Outcome, Running};
use super::{CANCELLED_RUN_WAIT, Stt, cpu, fake, power, recording};
use crate::close_guard::CLOSE_GUARD;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;
use tauri::{AppHandle, DragDropEvent, Runtime, State, WebviewWindow};

/// Every command, for `build.rs` and the invoke handler in `lib.rs`. Keep the three lists in step.
pub const COMMANDS: &[&str] = &[
  "stt_choose_recording",
  "stt_status",
  "stt_devices",
  "stt_start",
  "stt_cancel",
  "set_close_guard",
  "stt_download",
  "stt_download_cancel",
  "stt_remove_models",
];

// ---- What the page is told (bridge.ts reads each with a zod schema) ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UnusableReason {
  Damaged,
  Outdated,
  Cpu,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum LocalSttStatus {
  Ready { pack: SpeechPackInfo },
  Missing { pack: SpeechPackInfo },
  Unusable { pack: SpeechPackInfo, reason: UnusableReason },
  #[serde(rename_all = "camelCase")]
  Downloading { pack: SpeechPackInfo, received_bytes: u64, total_bytes: u64 },
}

/// A download's progress: bytes of the whole download (every file), a few times a second at most.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
  pub received_bytes: u64,
  pub total_bytes: u64,
}

/// `TranscriptionProgress`'s local phases.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum Progress {
  Preparing,
  #[serde(rename_all = "camelCase")]
  Transcribing { done_sec: f64, total_sec: Option<f64> },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSttTimings {
  pub decode_sec: f64,
  pub words_sec: f64,
  pub speakers_sec: f64,
  pub total_sec: f64,
  /// The words model's threads on the processor; none on a card.
  pub threads: Option<u32>,
  /// The card the run used, `{ name, nth }`, so two identical cards stay apart (audit GPU-6); none is the processor
  /// (Phase 37, decision 7).
  pub device: Option<Device>,
  pub peak_memory_bytes: Option<u64>,
  /// Set when the run asked for a card and ran on the processor instead (audit GPU-3).
  pub fell_back: Option<FellBack>,
}

/// A run that asked for a card and ran on the processor instead (Phase 37, decision 5), and why (audit GPU-3). Only in
/// the run's timings, which Settings shows under Timings: never a message.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FellBack {
  /// The card asked for, `{ name, nth }`.
  pub device: Device,
  /// Why it wasn't used, with no path.
  pub reason: String,
}

/// Why a card is skipped once listing has hung this session (audit GPU-2).
const SKIPPED_AFTER_A_HANG: &str = "listing the cards hung earlier, so they're skipped until DeScribe restarts";
/// Why a card is skipped without the Vulkan engine's files.
const NO_VULKAN_ENGINE: &str = "the Vulkan engine isn't installed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSttResult {
  pub language: Option<String>,
  pub duration_sec: f64,
  pub words: Vec<Word>,
  pub speaker_segments: Vec<Segment>,
  pub timings: LocalSttTimings,
}

// ---- Where things are ----

/// A debug build's scripted engine (`fake.rs`): `DESCRIBE_STT_FAKE=<script.json>`.
fn fake_script() -> Option<PathBuf> {
  if !cfg!(debug_assertions) {
    return None;
  }
  std::env::var_os("DESCRIBE_STT_FAKE").filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// The engine's C API, in either engine's folder.
const ENGINE_DLL: &str = "nemo_speech_asr_c.dll";
/// Only the Vulkan engine has it.
const VULKAN_DLL: &str = "ggml-vulkan.dll";
/// The Vulkan engine's folder, inside the processor engine's.
const VULKAN_FOLDER: &str = "vulkan";

/// The two engines (Phase 37, decision 1): the processor's, and the Vulkan one in `vulkan\` beside it.
#[derive(Debug, Default, Clone, PartialEq)]
struct Engines {
  processor: Option<PathBuf>,
  vulkan: Option<PathBuf>,
}

/// Where the engines are: beside the exe when installed; in a debug build also `DESCRIBE_STT_RUNTIME_DIR`, or
/// `src-tauri/stt-runtime/` (`npm run desktop:stt-runtime`).
fn engines() -> Engines {
  let beside_exe = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf()));
  let mut candidates = Vec::new();
  if cfg!(debug_assertions) {
    if let Some(dir) = std::env::var_os("DESCRIBE_STT_RUNTIME_DIR").filter(|v| !v.is_empty()) {
      candidates.push(PathBuf::from(dir));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("stt-runtime"));
  }
  candidates.extend(beside_exe);
  find_engines(&candidates)
}

/// The first of `candidates` that holds the processor engine, and the first whose `vulkan\` holds the Vulkan one.
fn find_engines(candidates: &[PathBuf]) -> Engines {
  let processor = candidates.iter().find(|d| d.join(ENGINE_DLL).is_file()).cloned();
  let vulkan = candidates
    .iter()
    .map(|d| d.join(VULKAN_FOLDER))
    .find(|d| d.join(ENGINE_DLL).is_file() && d.join(VULKAN_DLL).is_file());
  Engines { processor, vulkan }
}

/// The graphics cards `stt_devices` lists: none when pretending there's no Vulkan, a debug build's made-up ones, none
/// without AVX2 or a Vulkan engine, none once listing has hung this session (audit GPU-2), else what the probe finds
/// in that engine.
fn devices_now(
  no_gpu: bool,
  made_up: Option<Vec<GpuDevice>>,
  cpu_ok: bool,
  hung: bool,
  vulkan: Option<&Path>,
  probe: impl FnOnce(&Path) -> Result<Vec<GpuDevice>, ListingHung>,
) -> Result<Vec<GpuDevice>, ListingHung> {
  if no_gpu {
    return Ok(Vec::new());
  }
  if let Some(devices) = made_up {
    return Ok(devices);
  }
  match vulkan.filter(|_| cpu_ok && !hung) {
    Some(dir) => probe(dir),
    None => Ok(Vec::new()),
  }
}

/// The pack's state, from the folder (or ready for a scripted engine).
fn pack_state() -> PackState {
  if fake_script().is_some() {
    let dir = PathBuf::new();
    return PackState::Ready(pack::ReadyPack { dir: dir.clone(), words: dir.clone(), speakers: dir });
  }
  match pack::root() {
    Some(root) => pack::check(&root, pack::definition()),
    None => PackState::Missing,
  }
}

fn status_now(stt: &Stt) -> LocalSttStatus {
  let pack = pack::definition().info();
  if let Some(download) = stt.current_download().filter(|d| !d.is_removal()) {
    let (received_bytes, total_bytes) = download.progress();
    return LocalSttStatus::Downloading { pack, received_bytes, total_bytes };
  }
  if !cpu::can_run_engine() {
    return LocalSttStatus::Unusable { pack, reason: UnusableReason::Cpu };
  }
  match pack_state() {
    PackState::Ready(_) => LocalSttStatus::Ready { pack },
    PackState::Missing => LocalSttStatus::Missing { pack },
    PackState::Unusable(Unusable::Damaged) => LocalSttStatus::Unusable { pack, reason: UnusableReason::Damaged },
    PackState::Unusable(Unusable::Outdated) => LocalSttStatus::Unusable { pack, reason: UnusableReason::Outdated },
  }
}

// ---- The commands ----

/// Shows Windows' Open dialog and hands the chosen file to the page (`recording.rs`). Returns its token once WebView2
/// has taken the file, `None` if the user cancelled, or a `recording` error if the file couldn't be handed over.
#[tauri::command]
pub async fn stt_choose_recording<R: Runtime>(
  window: WebviewWindow<R>,
  stt: State<'_, Arc<Stt>>,
) -> Result<Option<String>, SttError> {
  let path = match recording::picked_for_tests() {
    Some(path) => Some(path),
    None => choose(&window).await?,
  };
  let Some(path) = path else { return Ok(None) };
  let path = recording::usable(&path).ok_or_else(|| SttError::new(SttErrorKind::Recording, "not a file"))?;
  let token = stt.recordings.add(path.clone());
  handed_over(hand_over(&window, &token, &path, None)?).await?;
  Ok(Some(token))
}

/// Whether the speech models are there and usable. Hashes them the first time (about a second a gigabyte).
#[tauri::command]
pub async fn stt_status(stt: State<'_, Arc<Stt>>) -> Result<LocalSttStatus, SttError> {
  let stt = Arc::clone(&stt);
  tauri::async_runtime::spawn_blocking(move || status_now(&stt))
    .await
    .map_err(|e| SttError::new(SttErrorKind::Engine, e.to_string()))
}

/// The graphics cards the Vulkan engine finds, in ggml's order (Phase 37, decision 2), listed by a worker process that
/// is ended after 15 s. Empty when there's no Vulkan engine, no Vulkan on the computer, or no card, and for the rest of
/// the session once listing has hung (audit GPU-2). Never fails: the `Result` is only what Tauri asks of an async
/// command that takes `State`.
#[tauri::command]
pub async fn stt_devices(stt: State<'_, Arc<Stt>>) -> Result<Vec<GpuDevice>, SttError> {
  let stt = Arc::clone(&stt);
  let devices = tauri::async_runtime::spawn_blocking(move || {
    let engines = engines();
    let hung = stt.listing_hung.load(Ordering::SeqCst);
    let probe = |dir: &Path| worker::devices(dir, worker::LISTING_TIMEOUT);
    let (no_gpu, made_up, cpu_ok) = (fake::no_gpu(), fake::devices(), cpu::can_run_engine());
    devices_now(no_gpu, made_up, cpu_ok, hung, engines.vulkan.as_deref(), probe).unwrap_or_else(|ListingHung| {
      stt.listing_hung.store(true, Ordering::SeqCst);
      Vec::new()
    })
  })
  .await
  .unwrap_or_default();
  Ok(devices)
}

/// Transcribes the recording chosen under `token`, sending progress on `on_progress`. One run at a time. `run_id` is
/// the page's name for the run, which `stt_cancel` takes. `device` is the card to run on; none is the processor. A card
/// that isn't there runs it on the processor (Phase 37, decision 5), and a failure on one is `gpu` (decision 6).
#[tauri::command]
pub async fn stt_start(
  token: String,
  run_id: String,
  device: Option<Device>,
  on_progress: Channel<Progress>,
  stt: State<'_, Arc<Stt>>,
) -> Result<LocalSttResult, SttError> {
  let stt = Arc::clone(&stt);
  tauri::async_runtime::spawn_blocking(move || start(&stt, &token, &run_id, device, &on_progress))
    .await
    .map_err(|e| SttError::new(SttErrorKind::Engine, e.to_string()))?
}

/// Ends the run named `run_id`. Its `stt_start` then fails with `cancelled`, even if this came first: this runs on the
/// main thread, and nothing orders it after `stt_start` taking the run's place.
#[tauri::command]
pub fn stt_cancel(run_id: String, stt: State<'_, Arc<Stt>>) {
  stt.cancel_run(&run_id);
}

/// Whether the page has work running that closing the window would lose (`close_guard.rs`).
#[tauri::command]
pub fn set_close_guard(active: bool) {
  CLOSE_GUARD.set(active);
}

/// Downloads the speech models this build lists (`download.rs`), sending progress on `on_progress`. It takes nothing
/// that names a URL, a host or a folder: those come from the list compiled into the app. `download_id` is the page's
/// name for the download, which `stt_download_cancel` takes.
#[tauri::command]
pub async fn stt_download<R: Runtime>(
  app: AppHandle<R>,
  download_id: String,
  on_progress: Channel<DownloadProgress>,
  stt: State<'_, Arc<Stt>>,
) -> Result<(), DownloadError> {
  let stt = Arc::clone(&stt);
  let user_agent = format!("DeScribe/{}", app.package_info().version);
  tauri::async_runtime::spawn_blocking(move || {
    let def = pack::definition();
    let next = Downloading::new(def.info().download_bytes);
    let held = stt.begin_download(next, Some(&download_id), CANCELLED_RUN_WAIT)?;
    run_download(def, &held.state, user_agent, &on_progress)
  })
  .await
  .map_err(|e| DownloadError::new(DownloadErrorKind::Offline, e.to_string()))?
}

fn run_download(
  def: &pack::PackDef,
  state: &Downloading,
  user_agent: String,
  progress: &Channel<DownloadProgress>,
) -> Result<(), DownloadError> {
  let root = pack::root()
    .ok_or_else(|| DownloadError::new(DownloadErrorKind::Write, "the app has no folder to keep them in"))?;
  let _awake = power::KeepAwake::new("DeScribe is downloading its speech models");
  let free = download::free_bytes;
  let opts = download::Options { user_agent, allow_loopback_http: pack::is_test_list(), free_bytes: &free };
  download::download(def, &root, state, &opts, &mut |received_bytes, total_bytes| {
    let _ = progress.send(DownloadProgress { received_bytes, total_bytes });
  })
}

/// Stops the download named `download_id`. Its `stt_download` then fails with `cancelled`, even if this came first.
#[tauri::command]
pub fn stt_download_cancel(download_id: String, stt: State<'_, Arc<Stt>>) {
  stt.cancel_download(&download_id);
}

/// **Remove** in Settings: deletes the speech models and anything a download left (`pack::remove`).
#[tauri::command]
pub async fn stt_remove_models(stt: State<'_, Arc<Stt>>) -> Result<(), DownloadError> {
  let stt = Arc::clone(&stt);
  tauri::async_runtime::spawn_blocking(move || {
    let _held = stt.begin_download(Downloading::removal(), None, CANCELLED_RUN_WAIT)?;
    match pack::root() {
      Some(root) => pack::remove(&root, pack::definition()).map_err(|e| download::io_error(&root, "removing", &e)),
      None => Ok(()),
    }
  })
  .await
  .map_err(|e| DownloadError::new(DownloadErrorKind::Write, e.to_string()))?
}

fn start(
  stt: &Stt,
  token: &str,
  run_id: &str,
  device: Option<Device>,
  progress: &Channel<Progress>,
) -> Result<LocalSttResult, SttError> {
  let held = stt.begin_run(run_id, CANCELLED_RUN_WAIT)?;
  run(token, device, &held.running, progress, &stt.recordings, &stt.listing_hung)
}

fn run(
  token: &str,
  device: Option<Device>,
  running: &Running,
  progress: &Channel<Progress>,
  recordings: &recording::Recordings,
  listing_hung: &AtomicBool,
) -> Result<LocalSttResult, SttError> {
  let recording = recordings
    .path(token)
    .and_then(|p| recording::usable(&p))
    .ok_or_else(|| SttError::new(SttErrorKind::Recording, "the recording isn't there any more"))?;
  if !cpu::can_run_engine() {
    return Err(SttError::new(SttErrorKind::Cpu, "the processor lacks AVX2"));
  }
  let ready = match pack_state() {
    PackState::Ready(ready) => ready,
    PackState::Missing => return Err(SttError::new(SttErrorKind::PackMissing, "no speech models")),
    PackState::Unusable(Unusable::Damaged) => {
      return Err(SttError::new(SttErrorKind::PackDamaged, "a model file doesn't match its size or hash"));
    }
    PackState::Unusable(Unusable::Outdated) => {
      return Err(SttError::new(SttErrorKind::PackOutdated, "the models belong to another version of DeScribe"));
    }
  };
  let fake = fake_script();
  let device = device.filter(|_| !fake::no_gpu());
  let engines = engines();
  let processor = processor_dir(&engines, fake.is_some());
  let hung = listing_hung.load(Ordering::SeqCst);
  let requested = device.clone();
  let (job, skipped) = job_for(recording, ready, fake, device, &engines, hung, processor.clone())?;

  let _ = progress.send(Progress::Preparing);
  let _awake = power::KeepAwake::new("DeScribe is transcribing a recording");
  let mut total_sec = None;
  let mut on_event = |event: &Event| match event {
    Event::Started { duration_sec } => {
      total_sec = *duration_sec;
      let _ = progress.send(Progress::Transcribing { done_sec: 0.0, total_sec });
    }
    Event::Progress { done_sec } => {
      let _ = progress.send(Progress::Transcribing { done_sec: *done_sec, total_sec });
    }
    _ => {}
  };
  let (outcome, missing) = run_job(job, processor.ok(), listing_hung, |job| worker::run(job, running, &mut on_event))?;
  let fell_back = skipped.or(missing).zip(requested).map(|(reason, device)| FellBack { device, reason });
  let r = outcome.result;
  Ok(LocalSttResult {
    language: r.language,
    duration_sec: r.duration_sec,
    words: r.words,
    speaker_segments: r.speaker_segments,
    timings: LocalSttTimings {
      decode_sec: r.timings.decode_sec,
      words_sec: r.timings.words_sec,
      speakers_sec: r.timings.speakers_sec,
      total_sec: r.timings.total_sec,
      threads: r.timings.threads,
      device: r.timings.device,
      peak_memory_bytes: outcome.peak_memory_bytes,
      fell_back,
    },
  })
}

/// The processor engine's folder; a scripted engine needs none.
fn processor_dir(engines: &Engines, scripted: bool) -> Result<PathBuf, SttError> {
  match (&engines.processor, scripted) {
    (Some(dir), _) => Ok(dir.clone()),
    (None, true) => Ok(PathBuf::new()),
    (None, false) => Err(SttError::new(SttErrorKind::Engine, "the engine's files aren't installed")),
  }
}

/// The job for a run: on `device` with the Vulkan engine if there is one (a scripted engine needs none), else on the
/// processor engine, `processor`, without a message (Phase 37, decision 5). Once listing the cards has hung this
/// session (`hung`, audit GPU-2), on the processor too. With the job, why a card asked for was skipped (audit GPU-3).
fn job_for(
  recording: PathBuf,
  ready: pack::ReadyPack,
  fake: Option<PathBuf>,
  device: Option<Device>,
  engines: &Engines,
  hung: bool,
  processor: Result<PathBuf, SttError>,
) -> Result<(Job, Option<String>), SttError> {
  let card_engine = match (&engines.vulkan, &fake) {
    _ if hung => Err(SKIPPED_AFTER_A_HANG),
    (Some(dir), _) => Ok(dir.clone()),
    (None, Some(_)) => Ok(PathBuf::new()),
    (None, None) => Err(NO_VULKAN_ENGINE),
  };
  let (device, runtime_dir, skipped) = match (device, card_engine) {
    (Some(device), Ok(dir)) => (Some(device), dir, None),
    (Some(_), Err(reason)) => (None, processor?, Some(reason.to_string())),
    (None, _) => (None, processor?, None),
  };
  let job = Job { recording, runtime_dir, words_model: ready.words, speakers_model: ready.speakers, fake, device };
  Ok((job, skipped))
}

/// Runs `job` with `work` (`worker::run`). If its card isn't there, or listing the cards hung, runs it once more on the
/// processor engine in `processor` (Phase 37, decision 5). A hang is also noted in `hung`, so the session's later runs
/// skip the card (audit GPU-2). With the outcome, why the card wasn't used, if it fell back (audit GPU-3). A failure
/// comes back as the worker gave it: the worker says which of its failures are the card's (`gpu`, decision 6), and
/// `worker::run` which crashes are (audit GPU-1).
fn run_job(
  job: Job,
  processor: Option<PathBuf>,
  hung: &AtomicBool,
  mut work: impl FnMut(&Job) -> Result<Finished, SttError>,
) -> Result<(Outcome, Option<String>), SttError> {
  if job.device.is_none() {
    return match work(&job)? {
      Finished::Done(outcome) => Ok((outcome, None)),
      Finished::DeviceMissing { .. } | Finished::ListingHung => {
        Err(SttError::new(SttErrorKind::Engine, "the engine wanted a card on the processor"))
      }
    };
  }
  let reason = match work(&job)? {
    Finished::Done(outcome) => return Ok((outcome, None)),
    Finished::DeviceMissing { reason } => reason,
    Finished::ListingHung => {
      hung.store(true, Ordering::SeqCst);
      format!("listing the cards took longer than {} s", worker::LISTING_TIMEOUT.as_secs())
    }
  };
  let runtime_dir = processor.ok_or_else(|| SttError::new(SttErrorKind::Engine, "the engine's files aren't installed"))?;
  let (outcome, _) = run_job(Job { device: None, runtime_dir, ..job }, None, hung, work)?;
  Ok((outcome, Some(reason)))
}

// ---- Choosing and dropping the recording ----

#[cfg(windows)]
async fn choose<R: Runtime>(window: &WebviewWindow<R>) -> Result<Option<PathBuf>, SttError> {
  let owner = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
  tauri::async_runtime::spawn_blocking(move || recording::native::choose(owner))
    .await
    .map_err(|e| SttError::new(SttErrorKind::Recording, e.to_string()))?
    .map_err(|e| SttError::new(SttErrorKind::Recording, format!("the Open dialog failed: {e}")))
}

#[cfg(not(windows))]
async fn choose<R: Runtime>(_window: &WebviewWindow<R>) -> Result<Option<PathBuf>, SttError> {
  Ok(None)
}

/// What `handed_over` reports, before the reason.
const NOT_HANDED_OVER: &str = "couldn't hand the file to the page";

/// Posts the file to the page. `Err` only if the message couldn't be sent to the main thread at all; whether WebView2
/// took the file comes back on the receiver (`handed_over`).
#[cfg(windows)]
fn hand_over<R: Runtime>(
  window: &WebviewWindow<R>,
  token: &str,
  path: &std::path::Path,
  at: Option<(f64, f64)>,
) -> Result<recording::Posted, SttError> {
  recording::native::post_file(window, recording::recording_message(token, at), path)
    .map_err(|e| SttError::new(SttErrorKind::Recording, format!("{NOT_HANDED_OVER}: {e}")))
}

#[cfg(not(windows))]
fn hand_over<R: Runtime>(
  _window: &WebviewWindow<R>,
  _token: &str,
  _path: &std::path::Path,
  _at: Option<(f64, f64)>,
) -> Result<recording::Posted, SttError> {
  let (done, posted) = std::sync::mpsc::sync_channel(1);
  let _ = done.send(Ok(()));
  Ok(posted)
}

/// Waits, on a blocking thread, for WebView2 to take the file `hand_over` posted.
async fn handed_over(posted: recording::Posted) -> Result<(), SttError> {
  let fail = |detail: String| SttError::new(SttErrorKind::Recording, format!("{NOT_HANDED_OVER}: {detail}"));
  tauri::async_runtime::spawn_blocking(move || posted.recv())
    .await
    .map_err(|e| fail(e.to_string()))?
    .unwrap_or_else(|_| Err("the window was gone".to_owned()))
    .map_err(fail)
}

/// A file dragged onto the window (`dragDropEnabled: true`, so the page's own drop events don't fire). The page hears
/// when a drag is over the window, and gets the first dropped file with where it landed, to check it against its zone,
/// or, if WebView2 wouldn't take the file, a `describe.drop-failed` message saying why.
pub fn on_drag_drop<R: Runtime>(window: &WebviewWindow<R>, stt: &Stt, event: &DragDropEvent) {
  #[cfg(windows)]
  {
    let post = |over: bool| {
      let _ = recording::native::post(window, recording::drag_message(over));
    };
    match event {
      DragDropEvent::Enter { .. } => post(true),
      DragDropEvent::Leave => post(false),
      DragDropEvent::Drop { paths, position } => {
        post(false);
        let Some(path) = paths.iter().find_map(|p| recording::usable(p)) else { return };
        let scale = window.scale_factor().unwrap_or(1.0);
        let at = (position.x / scale, position.y / scale);
        let token = stt.recordings.add(path.clone());
        let Ok(posted) = hand_over(window, &token, &path, Some(at)) else { return };
        // This is the main thread, which runs the handover; wait for its result elsewhere.
        let window = window.clone();
        tauri::async_runtime::spawn_blocking(move || {
          if let Ok(Err(detail)) = posted.recv() {
            let detail = format!("{NOT_HANDED_OVER}: {detail}");
            let _ = recording::native::post(&window, recording::drop_failed_message(at, &detail));
          }
        });
      }
      _ => {}
    }
  }
  #[cfg(not(windows))]
  let _ = (window, stt, event);
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_page_gets_the_shapes_bridge_ts_reads() {
    let pack = pack::definition().info();
    let ready = serde_json::to_value(LocalSttStatus::Ready { pack: pack.clone() }).unwrap();
    assert_eq!(ready["state"], "ready");
    assert_eq!(ready["pack"]["maxSpeakers"], 8);
    assert!(ready["pack"]["downloadBytes"].as_u64().unwrap() > 800_000_000);
    let cpu = serde_json::to_value(LocalSttStatus::Unusable { pack, reason: UnusableReason::Cpu }).unwrap();
    assert_eq!((cpu["state"].as_str(), cpu["reason"].as_str()), (Some("unusable"), Some("cpu")));
    let downloading = serde_json::to_value(LocalSttStatus::Downloading {
      pack: pack::definition().info(),
      received_bytes: 5,
      total_bytes: 9,
    })
    .unwrap();
    assert_eq!((downloading["state"].as_str(), downloading["receivedBytes"].as_u64()), (Some("downloading"), Some(5)));
    assert_eq!(downloading["totalBytes"], 9);
    assert_eq!(
      serde_json::to_value(DownloadProgress { received_bytes: 1, total_bytes: 2 }).unwrap(),
      serde_json::json!({ "receivedBytes": 1, "totalBytes": 2 })
    );
    assert_eq!(
      serde_json::to_value(DownloadError::new(DownloadErrorKind::InUse, "x")).unwrap(),
      serde_json::json!({ "kind": "in-use", "detail": "x" })
    );
    assert_eq!(serde_json::to_value(Progress::Preparing).unwrap(), serde_json::json!({ "phase": "preparing" }));
    assert_eq!(
      serde_json::to_value(Progress::Transcribing { done_sec: 1.5, total_sec: None }).unwrap(),
      serde_json::json!({ "phase": "transcribing", "doneSec": 1.5, "totalSec": null })
    );
    let on_a_card = LocalSttTimings {
      decode_sec: 1.0,
      words_sec: 2.0,
      speakers_sec: 3.0,
      total_sec: 4.0,
      threads: None,
      device: Some(Device { name: "NVIDIA RTX A2000".into(), nth: 1 }),
      peak_memory_bytes: Some(5),
      fell_back: None,
    };
    assert_eq!(
      serde_json::to_value(&on_a_card).unwrap(),
      serde_json::json!({ "decodeSec": 1.0, "wordsSec": 2.0, "speakersSec": 3.0, "totalSec": 4.0, "threads": null,
        "device": { "name": "NVIDIA RTX A2000", "nth": 1 }, "peakMemoryBytes": 5, "fellBack": null })
    );
    let fell_back = LocalSttTimings {
      threads: Some(8),
      device: None,
      fell_back: Some(FellBack { device: Device { name: "NVIDIA RTX A2000".into(), nth: 1 }, reason: "x".into() }),
      ..on_a_card
    };
    assert_eq!(
      serde_json::to_value(fell_back).unwrap()["fellBack"],
      serde_json::json!({ "device": { "name": "NVIDIA RTX A2000", "nth": 1 }, "reason": "x" })
    );
    assert_eq!(
      serde_json::to_value(vec![card("AMD Radeon 740M Graphics")]).unwrap(),
      serde_json::json!([{ "name": "AMD Radeon 740M Graphics", "kind": "integrated-gpu", "memoryBytes": 512 }])
    );
    assert_eq!(
      serde_json::to_value(SttError::new(SttErrorKind::Gpu, "x")).unwrap(),
      serde_json::json!({ "kind": "gpu", "detail": "x" })
    );
  }

  fn card(name: &str) -> GpuDevice {
    GpuDevice { name: name.into(), kind: super::super::protocol::GpuKind::IntegratedGpu, memory_bytes: 512 }
  }

  /// A folder of its own under the temp folder, removed at the end even when the test panics.
  struct Scratch(PathBuf);

  impl Scratch {
    fn new(name: &str) -> Self {
      let dir = std::env::temp_dir().join(format!("describe-{name}-{}", std::process::id()));
      let _ = std::fs::remove_dir_all(&dir);
      std::fs::create_dir_all(&dir).unwrap();
      Self(dir)
    }

    fn file(&self, path: &str) -> &Self {
      let path = self.0.join(path);
      std::fs::create_dir_all(path.parent().unwrap()).unwrap();
      std::fs::write(path, b"").unwrap();
      self
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn both_engines_are_found() {
    let empty = Scratch::new("engines-none");
    let cpu_only = Scratch::new("engines-cpu");
    cpu_only.file(ENGINE_DLL).file("vulkan/nemo_speech_asr_c.dll"); // no ggml-vulkan.dll: not an engine
    let both = Scratch::new("engines-both");
    both.file(ENGINE_DLL).file("vulkan/nemo_speech_asr_c.dll").file("vulkan/ggml-vulkan.dll");

    assert_eq!(find_engines(std::slice::from_ref(&empty.0)), Engines::default());
    assert_eq!(find_engines(&[empty.0.clone(), cpu_only.0.clone()]), Engines {
      processor: Some(cpu_only.0.clone()),
      vulkan: None
    });
    assert_eq!(find_engines(&[cpu_only.0.clone(), both.0.clone()]), Engines {
      processor: Some(cpu_only.0.clone()),
      vulkan: Some(both.0.join("vulkan"))
    });
  }

  #[test]
  fn the_cards_come_from_the_vulkan_engine() {
    let dir = Path::new(r"C:\app\vulkan");
    let found = vec![card("Intel(R) UHD Graphics 770")];
    let probe = |at: &Path| {
      assert_eq!(at, dir);
      Ok(found.clone())
    };
    let never = |_: &Path| -> Result<Vec<GpuDevice>, ListingHung> { panic!("probed without a Vulkan engine") };
    assert_eq!(devices_now(false, None, true, false, None, never), Ok(vec![]), "no Vulkan engine: no cards, no probe");
    assert_eq!(devices_now(false, None, false, false, Some(dir), never), Ok(vec![]), "no AVX2: the engine can't load");
    assert_eq!(devices_now(false, None, true, false, Some(dir), probe), Ok(found));
    let made_up = vec![card("A"), card("A")];
    assert_eq!(devices_now(false, Some(made_up.clone()), true, false, None, never), Ok(made_up.clone()));
    assert_eq!(devices_now(true, Some(made_up), true, false, Some(dir), never), Ok(vec![]));
  }

  /// Audit GPU-2: a probe that hangs says so, and once one has, the session doesn't probe again.
  #[test]
  fn once_listing_has_hung_the_cards_arent_probed() {
    let dir = Path::new(r"C:\app\vulkan");
    let hangs = |_: &Path| Err(ListingHung);
    assert_eq!(devices_now(false, None, true, false, Some(dir), hangs), Err(ListingHung));
    let never = |_: &Path| -> Result<Vec<GpuDevice>, ListingHung> { panic!("probed after a hang") };
    assert_eq!(devices_now(false, None, true, true, Some(dir), never), Ok(vec![]));
  }

  fn ready() -> pack::ReadyPack {
    pack::ReadyPack { dir: "p".into(), words: "p/w.gguf".into(), speakers: "p/s.gguf".into() }
  }

  fn rtx() -> Device {
    Device { name: "NVIDIA GeForce RTX 2070 SUPER".into(), nth: 0 }
  }

  #[test]
  fn a_run_on_a_card_needs_the_vulkan_engine() {
    let both = Engines { processor: Some("cpu".into()), vulkan: Some("cpu/vulkan".into()) };
    let cpu_only = Engines { processor: Some("cpu".into()), vulkan: None };
    let job = |device, engines: &Engines, fake: Option<PathBuf>| {
      let processor = processor_dir(engines, fake.is_some());
      job_for("a.m4a".into(), ready(), fake, device, engines, false, processor)
    };

    let (on_card, skipped) = job(Some(rtx()), &both, None).unwrap();
    assert_eq!((on_card.device, on_card.runtime_dir, skipped), (Some(rtx()), PathBuf::from("cpu/vulkan"), None));
    assert_eq!(on_card.words_model, PathBuf::from("p/w.gguf"));
    let (no_vulkan, skipped) = job(Some(rtx()), &cpu_only, None).unwrap();
    assert_eq!((no_vulkan.device, no_vulkan.runtime_dir), (None, PathBuf::from("cpu")), "the processor, no message");
    assert_eq!(skipped.as_deref(), Some(NO_VULKAN_ENGINE), "audit GPU-3: the record says why");
    let (processor, skipped) = job(None, &both, None).unwrap();
    assert_eq!((processor.device, processor.runtime_dir, skipped), (None, PathBuf::from("cpu"), None));
    let (scripted, _) = job(Some(rtx()), &Engines::default(), Some("fake.json".into())).unwrap();
    assert_eq!((scripted.device, scripted.runtime_dir), (Some(rtx()), PathBuf::new()));
    assert_eq!(job(None, &Engines::default(), None).unwrap_err().kind, SttErrorKind::Engine);

    // Audit GPU-2: once listing has hung, the card is skipped for the session.
    let (after_a_hang, skipped) =
      job_for("a.m4a".into(), ready(), None, Some(rtx()), &both, true, Ok("cpu".into())).unwrap();
    assert_eq!((after_a_hang.device, after_a_hang.runtime_dir), (None, PathBuf::from("cpu")));
    assert_eq!(skipped.as_deref(), Some(SKIPPED_AFTER_A_HANG));
    let scripted = job_for("a.m4a".into(), ready(), Some("f.json".into()), Some(rtx()), &both, true, Ok("".into()));
    assert_eq!(scripted.unwrap().0.device, None);
  }

  fn card_job() -> Job {
    Job {
      recording: "a.m4a".into(),
      runtime_dir: "cpu/vulkan".into(),
      words_model: "w".into(),
      speakers_model: "s".into(),
      fake: None,
      device: Some(rtx()),
    }
  }

  fn done() -> Finished {
    use super::super::protocol::{Timings, WorkerResult};
    let timings =
      Timings { decode_sec: 0.0, words_sec: 0.0, speakers_sec: 0.0, total_sec: 0.0, threads: Some(8), device: None };
    let result = WorkerResult { language: None, duration_sec: 1.0, words: vec![], speaker_segments: vec![], timings };
    Finished::Done(Outcome { result, peak_memory_bytes: Some(1) })
  }

  #[test]
  fn a_missing_card_runs_the_same_job_on_the_processor() {
    let mut jobs = Vec::new();
    let missing = Finished::DeviceMissing { reason: "the Vulkan engine found no graphics card".into() };
    let mut answers = vec![Ok(missing), Ok(done())].into_iter();
    let hung = AtomicBool::new(false);
    let outcome = run_job(card_job(), Some("cpu".into()), &hung, |job| {
      jobs.push(job.clone());
      answers.next().unwrap()
    });
    assert_eq!(outcome.unwrap().1.as_deref(), Some("the Vulkan engine found no graphics card"), "audit GPU-3");
    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[1], Job { device: None, runtime_dir: "cpu".into(), ..card_job() });
    assert!(!hung.load(Ordering::SeqCst), "a missing card isn't a hang");

    let on_the_card = run_job(card_job(), Some("cpu".into()), &hung, |_| Ok(done())).unwrap();
    assert_eq!(on_the_card.1, None, "a run that used its card didn't fall back");

    let mut once = 0;
    let refused = run_job(card_job(), None, &hung, |_| {
      once += 1;
      Ok(Finished::DeviceMissing { reason: "x".into() })
    });
    assert_eq!((refused.unwrap_err().kind, once), (SttErrorKind::Engine, 1), "no processor engine to fall back to");
  }

  /// Audit GPU-2: a hang while listing runs the job on the processor, as a missing card does, and is remembered.
  #[test]
  fn a_hang_while_listing_runs_the_same_job_on_the_processor() {
    let mut jobs = Vec::new();
    let mut answers = vec![Ok(Finished::ListingHung), Ok(done())].into_iter();
    let hung = AtomicBool::new(false);
    let outcome = run_job(card_job(), Some("cpu".into()), &hung, |job| {
      jobs.push(job.clone());
      answers.next().unwrap()
    });
    assert_eq!(outcome.unwrap().1.as_deref(), Some("listing the cards took longer than 15 s"), "audit GPU-3");
    assert_eq!(jobs, vec![card_job(), Job { device: None, runtime_dir: "cpu".into(), ..card_job() }]);
    assert!(hung.load(Ordering::SeqCst));
  }

  #[test]
  fn a_failure_on_a_card_comes_back_as_the_worker_gave_it() {
    let fails_with = |job: Job, kind, detail: &str| {
      run_job(job, None, &AtomicBool::new(false), |_| Err(SttError::new(kind, detail))).unwrap_err()
    };
    // The worker's and worker::run's own `gpu` (run.rs, worker::on_a_card).
    let error = fails_with(card_job(), SttErrorKind::Gpu, "ggml_vulkan: ErrorDeviceLost");
    assert_eq!(error, SttError::new(SttErrorKind::Gpu, "ggml_vulkan: ErrorDeviceLost"));
    // Audit GPU-1: what isn't the card's stays as it is, even in a run on a card.
    for (kind, detail) in [
      (SttErrorKind::Engine, "starting Media Foundation failed: 0x80004005"),
      (SttErrorKind::Engine, "starting the engine: access is denied"),
      (SttErrorKind::Unreadable, "x"),
      (SttErrorKind::Cancelled, "x"),
      (SttErrorKind::Cpu, "x"),
    ] {
      assert_eq!(fails_with(card_job(), kind, detail), SttError::new(kind, detail));
    }
    let on_the_processor = Job { device: None, runtime_dir: "cpu".into(), ..card_job() };
    for kind in [SttErrorKind::Engine, SttErrorKind::OutOfMemory] {
      assert_eq!(fails_with(on_the_processor.clone(), kind, "x").kind, kind);
    }

    // After falling back, a failure is the processor's.
    let missing = Finished::DeviceMissing { reason: "x".into() };
    let mut answers = vec![Ok(missing), Err(SttError::new(SttErrorKind::Engine, "x"))].into_iter();
    let hung = AtomicBool::new(false);
    let error = run_job(card_job(), Some("cpu".into()), &hung, |_| answers.next().unwrap()).unwrap_err();
    assert_eq!(error.kind, SttErrorKind::Engine);
  }

  #[test]
  fn the_command_list_matches_build_rs() {
    let build = include_str!("../../build.rs");
    for command in COMMANDS {
      assert!(build.contains(&format!("\"{command}\"")), "build.rs doesn't list {command}");
    }
    let lib = include_str!("../lib.rs");
    for command in COMMANDS {
      assert!(lib.contains(&format!("stt::commands::{command},")), "lib.rs doesn't register {command}");
    }
    let capability = include_str!("../../capabilities/default.json");
    for command in COMMANDS {
      assert!(capability.contains(&format!("\"allow-{}\"", command.replace('_', "-"))), "not granted: {command}");
    }
  }

  #[test]
  fn choosing_waits_for_webview2_to_take_the_file() {
    let posted = |result: Option<Result<(), String>>| {
      let (done, posted) = std::sync::mpsc::sync_channel(1);
      if let Some(result) = result {
        done.send(result).unwrap();
      }
      posted // `done` is dropped here, as when the closure never ran
    };
    let wait = |p| tauri::async_runtime::block_on(handed_over(p));
    assert_eq!(wait(posted(Some(Ok(())))), Ok(()));
    let refused = wait(posted(Some(Err("No such interface supported (0x80004002)".into())))).unwrap_err();
    assert_eq!(refused.kind, SttErrorKind::Recording);
    assert_eq!(refused.detail, "couldn't hand the file to the page: No such interface supported (0x80004002)");
    let gone = wait(posted(None)).unwrap_err();
    assert_eq!(gone.kind, SttErrorKind::Recording);
    assert_eq!(gone.detail, "couldn't hand the file to the page: the window was gone");
  }
}

#[cfg(test)]
mod exclusion_tests {
  use super::super::EARLY_CANCELS;
  use super::*;
  use std::time::{Duration, Instant};

  const NO_WAIT: Duration = Duration::ZERO;

  fn channel() -> Channel<Progress> {
    Channel::new(|_| Ok(()))
  }

  #[test]
  fn a_run_a_download_and_a_removal_exclude_each_other() {
    let stt = Stt::default();
    let held = stt.begin_download(Downloading::new(10), Some("d"), NO_WAIT).unwrap();
    assert!(stt.is_busy());
    assert_eq!(stt.begin_download(Downloading::removal(), None, NO_WAIT).unwrap_err().kind, DownloadErrorKind::InUse);
    assert_eq!(start(&stt, "no-such-token", "r", None, &channel()).unwrap_err().kind, SttErrorKind::Downloading);
    assert!(matches!(status_now(&stt), LocalSttStatus::Downloading { total_bytes: 10, .. }));
    stt.cancel_any_download();
    assert!(held.state.is_cancelled());
    drop(held);
    assert!(!stt.is_busy());

    let run = stt.begin_run("r", NO_WAIT).unwrap();
    assert!(stt.is_busy());
    let refused = stt.begin_download(Downloading::new(10), Some("d"), NO_WAIT).unwrap_err();
    assert_eq!(refused.kind, DownloadErrorKind::InUse);
    drop(run);
    assert!(!stt.is_running());

    let _removal = stt.begin_download(Downloading::removal(), None, NO_WAIT).unwrap();
    assert!(!stt.is_busy(), "a removal doesn't hold the window open");
    assert!(!matches!(status_now(&stt), LocalSttStatus::Downloading { .. }));
  }

  #[test]
  fn a_cancel_that_arrives_before_its_run_is_kept() {
    let stt = Stt::default();
    stt.cancel_run("a");
    assert_eq!(start(&stt, "no-such-token", "a", None, &channel()).unwrap_err().kind, SttErrorKind::Cancelled);
    assert!(!stt.is_running());
    // It counts once.
    assert_eq!(start(&stt, "no-such-token", "a", None, &channel()).unwrap_err().kind, SttErrorKind::Recording);
  }

  #[test]
  fn a_cancel_stops_only_the_run_it_names() {
    let stt = Stt::default();
    stt.cancel_run("old");
    assert_eq!(start(&stt, "no-such-token", "b", None, &channel()).unwrap_err().kind, SttErrorKind::Recording);

    let held = stt.begin_run("c", NO_WAIT).unwrap();
    stt.cancel_run("other");
    assert!(!held.running.is_cancelled());
    stt.cancel_run("c");
    assert!(held.running.is_cancelled());
    drop(held);
    assert!(!stt.is_running(), "the place is freed when the run ends");
  }

  #[test]
  fn only_the_last_few_early_cancels_are_kept() {
    let stt = Stt::default();
    for i in 0..=EARLY_CANCELS {
      stt.cancel_run(&format!("r{i}"));
    }
    assert_eq!(start(&stt, "no-such-token", "r0", None, &channel()).unwrap_err().kind, SttErrorKind::Recording);
    let last = format!("r{EARLY_CANCELS}");
    assert_eq!(start(&stt, "no-such-token", &last, None, &channel()).unwrap_err().kind, SttErrorKind::Cancelled);
  }

  #[test]
  fn a_run_needs_a_usable_id() {
    let stt = Stt::default();
    assert_eq!(start(&stt, "no-such-token", "", None, &channel()).unwrap_err().kind, SttErrorKind::Engine);
    let long = "x".repeat(65);
    stt.cancel_run(&long);
    assert_eq!(start(&stt, "no-such-token", &long, None, &channel()).unwrap_err().kind, SttErrorKind::Engine);
    let refused = stt.begin_download(Downloading::new(10), Some(""), NO_WAIT).unwrap_err();
    assert_eq!(refused.kind, DownloadErrorKind::Offline);
  }

  #[test]
  fn a_new_run_waits_for_a_cancelled_one_to_end() {
    let stt = Stt::default();
    let held = stt.begin_run("a", NO_WAIT).unwrap();

    let asked = Instant::now();
    assert_eq!(stt.begin_run("b", Duration::from_secs(5)).err().map(|e| e.kind), Some(SttErrorKind::Busy));
    assert!(asked.elapsed() < Duration::from_secs(1), "a run that wasn't cancelled is refused at once");

    stt.cancel_run("a");
    let refused = stt.begin_run("b", Duration::from_millis(50)).err().map(|e| e.kind);
    assert_eq!(refused, Some(SttErrorKind::Busy), "a cancelled run that doesn't end is waited for only so long");

    std::thread::scope(|s| {
      s.spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        drop(held);
      });
      let next = stt.begin_run("b", Duration::from_secs(5));
      assert!(next.is_ok(), "Start again straight after Cancel gets the place");
    });
  }

  #[test]
  fn a_download_cancel_that_arrives_first_is_kept() {
    let stt = Stt::default();
    stt.cancel_download("d");
    let refused = stt.begin_download(Downloading::new(10), Some("d"), NO_WAIT).unwrap_err();
    assert_eq!(refused.kind, DownloadErrorKind::Cancelled);
    assert!(stt.current_download().is_none());

    stt.cancel_download("old");
    let held = stt.begin_download(Downloading::new(10), Some("e"), NO_WAIT).unwrap();
    assert!(!held.state.is_cancelled());
    stt.cancel_download("e");
    assert!(held.state.is_cancelled());
  }

  #[test]
  fn a_download_waits_for_a_cancelled_run_to_end() {
    let stt = Stt::default();
    let held = stt.begin_run("a", NO_WAIT).unwrap();
    stt.cancel_run("a");
    std::thread::scope(|s| {
      s.spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        drop(held);
      });
      assert!(stt.begin_download(Downloading::new(10), Some("d"), Duration::from_secs(5)).is_ok());
    });
  }
}
