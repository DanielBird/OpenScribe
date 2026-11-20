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
use error::{SttError, SttErrorKind};
use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

/// How many cancels that came before their run or download are remembered. Each names one, and only that one can use
/// it, so a cancel that comes after its run has ended can't stop the next one.
pub const EARLY_CANCELS: usize = 8;

/// How long a new run or download waits for a cancelled run to finish ending. Killing the worker and closing its pipes
/// takes tens of milliseconds, and Start again sits where Cancel was, so a double-click lands in that time.
pub const CANCELLED_RUN_WAIT: Duration = Duration::from_secs(3);

/// The page names each run and download with a `crypto.randomUUID()`. Anything else isn't one of its ids.
pub fn is_usable_id(id: &str) -> bool {
  !id.is_empty() && id.len() <= 64
}

/// What is going now, if anything, and the cancels that came before what they named.
pub struct Slot<T> {
  /// The id the page gave it (none for a removal, which can't be cancelled), and the work itself.
  current: Option<(Option<String>, Arc<T>)>,
  early_cancels: VecDeque<String>,
}

impl<T> Default for Slot<T> {
  fn default() -> Self {
    Self { current: None, early_cancels: VecDeque::new() }
  }
}

impl<T> Slot<T> {
  fn current(&self) -> Option<&Arc<T>> {
    self.current.as_ref().map(|(_, work)| work)
  }

  /// The work going now, if the page gave it this id. Otherwise remembers the id for when its work begins.
  fn named_or_remember(&mut self, id: &str) -> Option<&Arc<T>> {
    if !is_usable_id(id) {
      return None;
    }
    if self.current.as_ref().is_some_and(|(named, _)| named.as_deref() == Some(id)) {
      return self.current();
    }
    if self.early_cancels.len() == EARLY_CANCELS {
      self.early_cancels.pop_front();
    }
    self.early_cancels.push_back(id.to_owned());
    None
  }

  /// Whether a cancel came for `id` before it began. It counts once.
  fn take_early_cancel(&mut self, id: &str) -> bool {
    let at = self.early_cancels.iter().position(|cancelled| cancelled == id);
    at.and_then(|at| self.early_cancels.remove(at)).is_some()
  }

  fn hold(&mut self, id: Option<&str>, work: T) -> Arc<T> {
    let work = Arc::new(work);
    self.current = Some((id.map(str::to_owned), Arc::clone(&work)));
    work
  }
}

/// What the commands share. One per app, managed by Tauri.
///
/// A run, a download and a removal exclude each other. The locks are always taken `running` first, then `download`.
#[derive(Default)]
pub struct Stt {
  pub recordings: recording::Recordings,
  /// The run going now, if any: one at a time.
  running: Mutex<Slot<worker::Running>>,
  /// Told, with `running`, when the run's place is free again.
  run_ended: Condvar,
  /// The download or removal going now, if any.
  download: Mutex<Slot<Downloading>>,
  /// Listing the graphics cards hung, in the probe or a run on a card (audit GPU-2). Until the app restarts, runs are
  /// on the processor and Settings lists no cards, so only the first run pays `worker::LISTING_TIMEOUT`.
  pub listing_hung: std::sync::atomic::AtomicBool,
}

/// A run's place, held until this is dropped, however the run ends (a panic included).
pub struct RunHeld<'a> {
  stt: &'a Stt,
  pub running: Arc<worker::Running>,
}

impl Drop for RunHeld<'_> {
  fn drop(&mut self) {
    self.stt.runs().current = None;
    self.stt.run_ended.notify_all();
  }
}

/// A download's or removal's place, held until this is dropped.
pub struct DownloadHeld<'a> {
  stt: &'a Stt,
  pub state: Arc<Downloading>,
}

impl std::fmt::Debug for DownloadHeld<'_> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("DownloadHeld").field("state", &self.state).finish_non_exhaustive()
  }
}

impl Drop for DownloadHeld<'_> {
  fn drop(&mut self) {
    self.stt.downloads().current = None;
  }
}

impl Stt {
  fn runs(&self) -> MutexGuard<'_, Slot<worker::Running>> {
    self.running.lock().unwrap_or_else(|e| e.into_inner())
  }

  fn downloads(&self) -> MutexGuard<'_, Slot<Downloading>> {
    self.download.lock().unwrap_or_else(|e| e.into_inner())
  }

  /// The run's place, once a run that was cancelled has left it, or `wait` has passed.
  fn runs_after_cancelled(&self, wait: Duration) -> MutexGuard<'_, Slot<worker::Running>> {
    let ending = |slot: &mut Slot<worker::Running>| slot.current().is_some_and(|r| r.is_cancelled());
    match self.run_ended.wait_timeout_while(self.runs(), wait, ending) {
      Ok((slot, _)) => slot,
      Err(poisoned) => poisoned.into_inner().0,
    }
  }

  /// Whether a local run is going.
  pub fn is_running(&self) -> bool {
    self.runs().current.is_some()
  }

  /// Whether a run or a download is going: closing the window asks first (`close_guard.rs`).
  pub fn is_busy(&self) -> bool {
    self.is_running() || self.current_download().is_some_and(|d| !d.is_removal())
  }

  /// Takes the run's place for the run the page named `id`, unless a cancel for it came first, or a run, a download or
  /// a removal holds it. A run that was cancelled is waited for, up to `wait`.
  pub fn begin_run(&self, id: &str, wait: Duration) -> Result<RunHeld<'_>, SttError> {
    if !is_usable_id(id) {
      return Err(SttError::new(SttErrorKind::Engine, "the run has no usable id"));
    }
    let mut runs = self.runs_after_cancelled(wait);
    if runs.take_early_cancel(id) {
      return Err(SttError::new(SttErrorKind::Cancelled, "cancelled before it started"));
    }
    if runs.current.is_some() {
      return Err(SttError::new(SttErrorKind::Busy, "a transcription is already running"));
    }
    if self.current_download().is_some() {
      return Err(SttError::new(SttErrorKind::Downloading, "the speech models are being downloaded or removed"));
    }
    let running = runs.hold(Some(id), worker::Running::default());
    Ok(RunHeld { stt: self, running })
  }

  /// Ends the run the page named `id`. If it hasn't begun yet, it's cancelled when it does.
  pub fn cancel_run(&self, id: &str) {
    if let Some(running) = self.runs().named_or_remember(id) {
      running.cancel();
    }
  }

  /// Ends whatever run is going: the page that owned it is gone (`lib.rs`).
  pub fn cancel_any_run(&self) {
    if let Some(running) = self.runs().current() {
      running.cancel();
    }
  }

  /// The download (or removal) going now.
  pub fn current_download(&self) -> Option<Arc<Downloading>> {
    self.downloads().current().cloned()
  }

  /// Stops the download the page named `id`, keeping its `.part` file for the next attempt. If it hasn't begun yet,
  /// it's cancelled when it does.
  pub fn cancel_download(&self, id: &str) {
    if let Some(download) = self.downloads().named_or_remember(id) {
      download.cancel();
    }
  }

  /// Stops whatever download is going: the page that owned it is gone (`lib.rs`).
  pub fn cancel_any_download(&self) {
    if let Some(download) = self.current_download() {
      download.cancel();
    }
  }

  /// Takes the download's place for `next` (named `id` by the page; a removal has none), unless a cancel for it came
  /// first, or a run, a download or a removal holds it. A run that was cancelled is waited for, up to `wait`.
  pub fn begin_download(
    &self,
    next: Downloading,
    id: Option<&str>,
    wait: Duration,
  ) -> Result<DownloadHeld<'_>, DownloadError> {
    if id.is_some_and(|id| !is_usable_id(id)) {
      return Err(DownloadError::new(DownloadErrorKind::Offline, "the download has no usable id"));
    }
    let runs = self.runs_after_cancelled(wait);
    let mut downloads = self.downloads();
    if id.is_some_and(|id| downloads.take_early_cancel(id)) {
      return Err(DownloadError::new(DownloadErrorKind::Cancelled, "cancelled before it started"));
    }
    if runs.current.is_some() {
      return Err(DownloadError::new(DownloadErrorKind::InUse, "a transcription is running"));
    }
    if downloads.current.is_some() {
      return Err(DownloadError::new(DownloadErrorKind::InUse, "a download or removal is already going"));
    }
    let state = downloads.hold(id, next);
    Ok(DownloadHeld { stt: self, state })
  }
}
