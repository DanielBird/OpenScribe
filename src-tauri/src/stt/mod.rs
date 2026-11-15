//! Transcription on this computer (DECISIONS.md D50, D51, D53, D54): the recording Rust chooses and hands to the page,
//! the speech pack and its download, and the worker process that runs the engine.

pub mod chunks;
pub mod commands;
pub mod cpu;
pub mod decode;
pub mod download;
#[cfg(all(test, windows))]
mod download_tests;
pub mod error;
pub mod fake;
pub mod nemo;
pub mod pack;
pub mod power;
pub mod protocol;
pub mod recording;
pub mod run;
pub mod worker;

use download::{DownloadError, DownloadErrorKind, Downloading};
use std::sync::{Arc, Mutex};

/// What the commands share. One per app, managed by Tauri.
///
/// A run, a download and a removal exclude each other. The locks are always taken `running` first, then `download`.
#[derive(Default)]
pub struct Stt {
  pub recordings: recording::Recordings,
  /// The run going now, if any: one at a time.
  pub running: Mutex<Option<Arc<worker::Running>>>,
  /// The download or removal going now, if any.
  pub download: Mutex<Option<Arc<Downloading>>>,
}

impl Stt {
  /// Whether a local run is going.
  pub fn is_running(&self) -> bool {
    self.running.lock().map(|r| r.is_some()).unwrap_or(false)
  }

  /// Whether a run or a download is going: closing the window asks first (`close_guard.rs`).
  pub fn is_busy(&self) -> bool {
    self.is_running() || self.current_download().is_some_and(|d| !d.is_removal())
  }

  /// Ends the run going now, if any.
  pub fn cancel(&self) {
    if let Some(running) = self.running.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
      running.cancel();
    }
  }

  /// The download (or removal) going now.
  pub fn current_download(&self) -> Option<Arc<Downloading>> {
    self.download.lock().unwrap_or_else(|e| e.into_inner()).clone()
  }

  /// Ends the download going now, if any. Its `.part` file is kept for the next attempt.
  pub fn cancel_download(&self) {
    if let Some(download) = self.current_download() {
      download.cancel();
    }
  }

  /// Takes the download's place, unless a run, a download or a removal holds it.
  pub fn begin_download(&self, next: Downloading) -> Result<Arc<Downloading>, DownloadError> {
    let running = self.running.lock().unwrap_or_else(|e| e.into_inner());
    if running.is_some() {
      return Err(DownloadError::new(DownloadErrorKind::InUse, "a transcription is running"));
    }
    let mut current = self.download.lock().unwrap_or_else(|e| e.into_inner());
    if current.is_some() {
      return Err(DownloadError::new(DownloadErrorKind::InUse, "a download or removal is already going"));
    }
    let next = Arc::new(next);
    *current = Some(Arc::clone(&next));
    Ok(next)
  }

  pub fn end_download(&self) {
    *self.download.lock().unwrap_or_else(|e| e.into_inner()) = None;
  }
}
