//! What the app and the worker process say to each other: one JSON job on the worker's stdin, then one JSON event per
//! line on its stdout. The worker writes nothing else to stdout; its stderr is the engine's own logging.

use super::error::SttErrorKind;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// The worker's first argument.
pub const WORKER_FLAG: &str = "--stt-worker";
/// After `WORKER_FLAG`, with the Vulkan engine's folder: list the graphics cards and exit (Phase 37, decision 2).
pub const DEVICES_FLAG: &str = "--devices";

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
  /// The graphics card to run both models on; none is the processor. `runtime_dir` is then the Vulkan engine's.
  #[serde(default)]
  pub device: Option<Device>,
}

/// A graphics card as the page saves it (Phase 37, decision 3): ggml's description, and which of the cards with that
/// description it is (from 0), since ggml's index can change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
  pub name: String,
  pub nth: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GpuKind {
  Gpu,
  IntegratedGpu,
}

/// A graphics card the Vulkan engine found, in ggml's order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuDevice {
  /// As the driver names it, such as "AMD Radeon 740M Graphics".
  pub name: String,
  pub kind: GpuKind,
  /// The card's memory as ggml reports it (an integrated card's is shared with the processor).
  pub memory_bytes: u64,
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
  /// The words model's threads on the processor: the C API's own min(8, hardware threads). The speakers model always
  /// uses 4. None for a run on a card.
  pub threads: Option<u32>,
  /// The card the run used, as the job named it, so two identical cards stay apart (audit GPU-6); none is the
  /// processor.
  #[serde(default)]
  pub device: Option<Device>,
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
  /// The job's card isn't among the Vulkan engine's devices, or that engine won't load. Said before any work, so the
  /// app can run the job on the processor instead (Phase 37, decision 5). `reason` says which, for the run's record
  /// (audit GPU-3); it names no path.
  DeviceMissing { reason: String },
  /// The job's card is among the Vulkan engine's devices: said as soon as they are listed, before any work. Until then
  /// the app gives the worker `LISTING_TIMEOUT`, as it gives the probe (audit GPU-2).
  DeviceFound,
  /// The probe's one line (`--stt-worker --devices <dir>`): the graphics cards, in ggml's order.
  Devices { devices: Vec<GpuDevice> },
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
        timings: Timings {
          decode_sec: 0.1,
          words_sec: 1.0,
          speakers_sec: 0.5,
          total_sec: 1.1,
          threads: Some(8),
          device: None,
        },
      }),
      Event::Failed { kind: SttErrorKind::Unreadable, detail: "x".into() },
      Event::DeviceMissing { reason: "the Vulkan engine found no graphics card".into() },
      Event::DeviceFound,
      Event::Devices {
        devices: vec![
          GpuDevice { name: "NVIDIA GeForce RTX 2070 SUPER".into(), kind: GpuKind::Gpu, memory_bytes: 8 << 30 },
          GpuDevice { name: "Intel(R) UHD Graphics 770".into(), kind: GpuKind::IntegratedGpu, memory_bytes: 1 << 34 },
        ],
      },
      Event::Devices { devices: vec![] },
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
    assert_eq!(
      Event::DeviceMissing { reason: "x".into() }.to_line(),
      r#"{"event":"device-missing","reason":"x"}"#
    );
    assert_eq!(Event::DeviceFound.to_line(), r#"{"event":"device-found"}"#);
    assert_eq!(
      Event::Devices {
        devices: vec![GpuDevice { name: "AMD Radeon 740M Graphics".into(), kind: GpuKind::IntegratedGpu, memory_bytes: 1 }],
      }
      .to_line(),
      r#"{"event":"devices","devices":[{"name":"AMD Radeon 740M Graphics","kind":"integrated-gpu","memoryBytes":1}]}"#
    );
  }

  #[test]
  fn a_job_names_its_card() {
    let job: Job = serde_json::from_str(
      r#"{"recording":"C:\\a.m4a","runtimeDir":"C:\\r\\vulkan","wordsModel":"C:\\w.gguf","speakersModel":"C:\\s.gguf",
          "device":{"name":"AMD Radeon 740M Graphics","nth":0}}"#,
    )
    .unwrap();
    assert_eq!(job.device, Some(Device { name: "AMD Radeon 740M Graphics".into(), nth: 0 }));
  }

  #[test]
  fn timings_without_a_device_are_the_processors() {
    let timings: Timings = serde_json::from_str(
      r#"{"decodeSec":0.1,"wordsSec":1.0,"speakersSec":0.5,"totalSec":1.1,"threads":8}"#,
    )
    .unwrap();
    assert_eq!((timings.threads, timings.device), (Some(8), None));
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
    assert_eq!(job.device, None, "a job without a device runs on the processor");
  }
}
