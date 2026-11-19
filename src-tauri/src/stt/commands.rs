//! The commands the page may call, each granted in `capabilities/default.json` (`build.rs` lists them), and the
//! native drop on the window. Errors are a kind and a detail (`error.rs`), never a path outside the pack.

use super::download::{self, DownloadError, DownloadErrorKind, Downloading};
use super::error::{SttError, SttErrorKind};
use super::pack::{self, PackState, SpeechPackInfo, Unusable};
use super::protocol::{Event, Job, Segment, Word};
use super::worker::{self, Running};
use super::{CANCELLED_RUN_WAIT, Stt, cpu, power, recording};
use crate::close_guard::CLOSE_GUARD;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, DragDropEvent, Runtime, State, WebviewWindow};

/// Every command, for `build.rs` and the invoke handler in `lib.rs`. Keep the three lists in step.
pub const COMMANDS: &[&str] = &[
  "stt_choose_recording",
  "stt_status",
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
  pub threads: u32,
  pub peak_memory_bytes: Option<u64>,
}

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

/// The engine's DLLs: beside the exe when installed; in a debug build `DESCRIBE_STT_RUNTIME_DIR`, or
/// `src-tauri/stt-runtime/` (`npm run desktop:stt-runtime`).
fn runtime_dir() -> Option<PathBuf> {
  let beside_exe = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf()));
  let mut candidates = Vec::new();
  if cfg!(debug_assertions) {
    if let Some(dir) = std::env::var_os("DESCRIBE_STT_RUNTIME_DIR").filter(|v| !v.is_empty()) {
      candidates.push(PathBuf::from(dir));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("stt-runtime"));
  }
  candidates.extend(beside_exe);
  candidates.into_iter().find(|d| d.join("nemo_speech_asr_c.dll").is_file())
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

/// Transcribes the recording chosen under `token`, sending progress on `on_progress`. One run at a time. `run_id` is
/// the page's name for the run, which `stt_cancel` takes.
#[tauri::command]
pub async fn stt_start(
  token: String,
  run_id: String,
  on_progress: Channel<Progress>,
  stt: State<'_, Arc<Stt>>,
) -> Result<LocalSttResult, SttError> {
  let stt = Arc::clone(&stt);
  tauri::async_runtime::spawn_blocking(move || start(&stt, &token, &run_id, &on_progress))
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

fn start(stt: &Stt, token: &str, run_id: &str, progress: &Channel<Progress>) -> Result<LocalSttResult, SttError> {
  let held = stt.begin_run(run_id, CANCELLED_RUN_WAIT)?;
  run(token, &held.running, progress, &stt.recordings)
}

fn run(
  token: &str,
  running: &Running,
  progress: &Channel<Progress>,
  recordings: &recording::Recordings,
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
  let runtime_dir = match (&fake, runtime_dir()) {
    (_, Some(dir)) => dir,
    (Some(_), None) => PathBuf::new(),
    (None, None) => return Err(SttError::new(SttErrorKind::Engine, "the engine's files aren't installed")),
  };
  let job = Job { recording, runtime_dir, words_model: ready.words, speakers_model: ready.speakers, fake };

  let _ = progress.send(Progress::Preparing);
  let _awake = power::KeepAwake::new("DeScribe is transcribing a recording");
  let mut total_sec = None;
  let outcome = worker::run(&job, running, |event| match event {
    Event::Started { duration_sec } => {
      total_sec = *duration_sec;
      let _ = progress.send(Progress::Transcribing { done_sec: 0.0, total_sec });
    }
    Event::Progress { done_sec } => {
      let _ = progress.send(Progress::Transcribing { done_sec: *done_sec, total_sec });
    }
    _ => {}
  })?;
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
      peak_memory_bytes: outcome.peak_memory_bytes,
    },
  })
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
    assert_eq!(start(&stt, "no-such-token", "r", &channel()).unwrap_err().kind, SttErrorKind::Downloading);
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
    assert_eq!(start(&stt, "no-such-token", "a", &channel()).unwrap_err().kind, SttErrorKind::Cancelled);
    assert!(!stt.is_running());
    // It counts once.
    assert_eq!(start(&stt, "no-such-token", "a", &channel()).unwrap_err().kind, SttErrorKind::Recording);
  }

  #[test]
  fn a_cancel_stops_only_the_run_it_names() {
    let stt = Stt::default();
    stt.cancel_run("old");
    assert_eq!(start(&stt, "no-such-token", "b", &channel()).unwrap_err().kind, SttErrorKind::Recording);

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
    assert_eq!(start(&stt, "no-such-token", "r0", &channel()).unwrap_err().kind, SttErrorKind::Recording);
    let last = format!("r{EARLY_CANCELS}");
    assert_eq!(start(&stt, "no-such-token", &last, &channel()).unwrap_err().kind, SttErrorKind::Cancelled);
  }

  #[test]
  fn a_run_needs_a_usable_id() {
    let stt = Stt::default();
    assert_eq!(start(&stt, "no-such-token", "", &channel()).unwrap_err().kind, SttErrorKind::Engine);
    let long = "x".repeat(65);
    stt.cancel_run(&long);
    assert_eq!(start(&stt, "no-such-token", &long, &channel()).unwrap_err().kind, SttErrorKind::Engine);
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
