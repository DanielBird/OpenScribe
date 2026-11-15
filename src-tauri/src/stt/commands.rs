//! The commands the page may call, each granted in `capabilities/default.json` (`build.rs` lists them), and the
//! native drop on the window. Errors are a kind and a detail (`error.rs`), never a path outside the pack.

use super::error::{SttError, SttErrorKind};
use super::pack::{self, PackState, SpeechPackInfo, Unusable};
use super::protocol::{Event, Job, Segment, Word};
use super::worker::{self, Running};
use super::{Stt, cpu, power, recording};
use crate::close_guard::CLOSE_GUARD;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{DragDropEvent, Runtime, State, WebviewWindow};

/// Every command, for `build.rs` and the invoke handler in `lib.rs`. Keep the three lists in step.
pub const COMMANDS: &[&str] = &["stt_choose_recording", "stt_status", "stt_start", "stt_cancel", "set_close_guard"];

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

fn status_now() -> LocalSttStatus {
  let pack = pack::definition().info();
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

/// Shows Windows' Open dialog and hands the chosen file to the page (`recording.rs`). Returns its token, or `None` if
/// the user cancelled.
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
  hand_over(&window, &token, &path, None)?;
  Ok(Some(token))
}

/// Whether the speech models are there and usable. Hashes them the first time (about a second a gigabyte).
#[tauri::command]
pub async fn stt_status() -> Result<LocalSttStatus, SttError> {
  tauri::async_runtime::spawn_blocking(status_now).await.map_err(|e| SttError::new(SttErrorKind::Engine, e.to_string()))
}

/// Transcribes the recording chosen under `token`, sending progress on `on_progress`. One run at a time.
#[tauri::command]
pub async fn stt_start(
  token: String,
  on_progress: Channel<Progress>,
  stt: State<'_, Arc<Stt>>,
) -> Result<LocalSttResult, SttError> {
  let stt = Arc::clone(&stt);
  tauri::async_runtime::spawn_blocking(move || start(&stt, &token, &on_progress))
    .await
    .map_err(|e| SttError::new(SttErrorKind::Engine, e.to_string()))?
}

/// Ends the run, if there is one. The run's own `stt_start` then fails with `cancelled`.
#[tauri::command]
pub fn stt_cancel(stt: State<'_, Arc<Stt>>) {
  stt.cancel();
}

/// Whether the page has work running that closing the window would lose (`close_guard.rs`).
#[tauri::command]
pub fn set_close_guard(active: bool) {
  CLOSE_GUARD.set(active);
}

fn start(stt: &Stt, token: &str, progress: &Channel<Progress>) -> Result<LocalSttResult, SttError> {
  let running = Arc::new(Running::default());
  {
    let mut current = stt.running.lock().unwrap_or_else(|e| e.into_inner());
    if current.is_some() {
      return Err(SttError::new(SttErrorKind::Busy, "a transcription is already running"));
    }
    *current = Some(Arc::clone(&running));
  }
  let result = run(token, &running, progress, &stt.recordings);
  *stt.running.lock().unwrap_or_else(|e| e.into_inner()) = None;
  result
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
  let _awake = power::KeepAwake::new();
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

#[cfg(windows)]
fn hand_over<R: Runtime>(
  window: &WebviewWindow<R>,
  token: &str,
  path: &std::path::Path,
  at: Option<(f64, f64)>,
) -> Result<(), SttError> {
  recording::native::post_file(window, recording::recording_message(token, at), path)
    .map_err(|e| SttError::new(SttErrorKind::Recording, format!("couldn't hand the file to the page: {e}")))
}

#[cfg(not(windows))]
fn hand_over<R: Runtime>(
  _window: &WebviewWindow<R>,
  _token: &str,
  _path: &std::path::Path,
  _at: Option<(f64, f64)>,
) -> Result<(), SttError> {
  Ok(())
}

/// A file dragged onto the window (`dragDropEnabled: true`, so the page's own drop events don't fire). The page hears
/// when a drag is over the window, and gets the first dropped file with where it landed, to check it against its zone.
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
        let token = stt.recordings.add(path.clone());
        let _ = hand_over(window, &token, &path, Some((position.x / scale, position.y / scale)));
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
    let capability = include_str!("../../capabilities/default.json");
    for command in COMMANDS {
      assert!(capability.contains(&format!("\"allow-{}\"", command.replace('_', "-"))), "not granted: {command}");
    }
  }
}
