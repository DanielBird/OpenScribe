//! Transcription on this computer (DECISIONS.md D50, D51, D53): the recording Rust chooses and hands to the page, the
//! speech pack, and the worker process that runs the engine.

pub mod chunks;
pub mod commands;
pub mod cpu;
pub mod decode;
pub mod error;
pub mod fake;
pub mod nemo;
pub mod pack;
pub mod power;
pub mod protocol;
pub mod recording;
pub mod run;
pub mod worker;

use std::sync::{Arc, Mutex};

/// What the commands share. One per app, managed by Tauri.
#[derive(Default)]
pub struct Stt {
  pub recordings: recording::Recordings,
  /// The run going now, if any: one at a time.
  pub running: Mutex<Option<Arc<worker::Running>>>,
}

impl Stt {
  /// Whether a local run is going.
  pub fn is_running(&self) -> bool {
    self.running.lock().map(|r| r.is_some()).unwrap_or(false)
  }

  /// Ends the run going now, if any.
  pub fn cancel(&self) {
    if let Some(running) = self.running.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
      running.cancel();
    }
  }
}
