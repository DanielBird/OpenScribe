//! What the app and the worker process say to each other: one JSON job on the worker's stdin, then one JSON event per
//! line on its stdout. The worker writes nothing else to stdout; its stderr is the engine's own logging.

use super::error::SttErrorKind;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// The worker's first argument.
pub const WORKER_FLAG: &str = "--stt-worker";

/// What to transcribe, and with what.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
  pub recording: PathBuf,
  /// Holds `nemo_speech_asr_c.dll` and its dependencies.
  pub runtime_dir: PathBuf,
  pub words_model: PathBuf,
  pub speakers_model: PathBuf,
  /// A debug build's scripted run (`fake.rs`) instead of the engine.
  #[serde(default)]
  pub fake: Option<PathBuf>,
}

/// One word, in seconds from the start of the recording.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
  pub text: String,
  pub start: f64,
  pub end: f64,
  pub confidence: Option<f32>,
}

/// One stretch of one speaker, in seconds; `speaker` from 0.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
  pub speaker: u32,
  pub start: f64,
  pub end: f64,
}

/// How long the run took (Phase 34, decision 7). The app adds the worker's peak memory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
  /// Time spent decoding the recording, not counting waits for the models.
  pub decode_sec: f64,
  /// From the start of the run until the last word, loading the model included.
  pub words_sec: f64,
  /// From the start of the run until the last segment, loading the model included.
  pub speakers_sec: f64,
  pub total_sec: f64,
  /// The words model's threads: the C API's own min(8, hardware threads). The speakers model always uses 4.
  pub threads: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerResult {
  pub language: Option<String>,
  pub duration_sec: f64,
  pub words: Vec<Word>,
  pub speaker_segments: Vec<Segment>,
  pub timings: Timings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "kebab-case")]
pub enum Event {
  /// The recording is open: its length if the file states it.
  #[serde(rename_all = "camelCase")]
  Started { duration_sec: Option<f64> },
  /// Seconds of audio both models are done with.
  #[serde(rename_all = "camelCase")]
  Progress { done_sec: f64 },
  Done(WorkerResult),
  Failed { kind: SttErrorKind, detail: String },
}

impl Event {
  pub fn to_line(&self) -> String {
    serde_json::to_string(self).unwrap_or_else(|_| r#"{"event":"failed","kind":"engine","detail":"unwritable event"}"#.into())
  }

  pub fn from_line(line: &str) -> Option<Self> {
    serde_json::from_str(line.trim()).ok()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn events_round_trip_one_per_line() {
    let events = [
      Event::Started { duration_sec: Some(5.0) },
      Event::Progress { done_sec: 2.5 },
      Event::Done(WorkerResult {
        language: None,
        duration_sec: 5.0,
        words: vec![Word { text: "Hello".into(), start: 0.1, end: 0.4, confidence: Some(1.0) }],
        speaker_segments: vec![Segment { speaker: 0, start: 0.0, end: 5.0 }],
        timings: Timings { decode_sec: 0.1, words_sec: 1.0, speakers_sec: 0.5, total_sec: 1.1, threads: 8 },
      }),
      Event::Failed { kind: SttErrorKind::Unreadable, detail: "x".into() },
    ];
    for event in events {
      let line = event.to_line();
      assert!(!line.contains('\n'));
      assert_eq!(Event::from_line(&line), Some(event));
    }
    assert_eq!(
      Event::Progress { done_sec: 1.0 }.to_line(),
      r#"{"event":"progress","doneSec":1.0}"#
    );
  }

  #[test]
  fn anything_else_on_stdout_is_not_an_event() {
    assert_eq!(Event::from_line("ggml: loading model"), None);
    assert_eq!(Event::from_line(r#"{"event":"surprise"}"#), None);
  }

  #[test]
  fn a_job_reads_without_a_fake() {
    let job: Job = serde_json::from_str(
      r#"{"recording":"C:\\a.m4a","runtimeDir":"C:\\r","wordsModel":"C:\\w.gguf","speakersModel":"C:\\s.gguf"}"#,
    )
    .unwrap();
    assert_eq!(job.fake, None);
  }
}
