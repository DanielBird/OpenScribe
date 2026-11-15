//! A scripted engine for debug builds (`DESCRIBE_STT_FAKE=<script.json>`), so the desktop flow can be driven without
//! models: it runs inside the real worker process, so starting it, its events, cancelling (ending it) and a crash are
//! all real. Scripts live in `fixtures/local-stt/`.

use super::error::SttErrorKind;
use super::protocol::{Event, Segment, Timings, Word, WorkerResult};
use super::run::Emitter;
use serde::Deserialize;
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Script {
  pub duration_sec: f64,
  /// Progress to report, each after a pause.
  #[serde(default)]
  pub steps: Vec<Step>,
  #[serde(default)]
  pub language: Option<String>,
  #[serde(default)]
  pub words: Vec<Word>,
  #[serde(default)]
  pub speaker_segments: Vec<Segment>,
  /// End with this failure instead of a result.
  #[serde(default)]
  pub failure: Option<Failure>,
  /// End by aborting the process, as a crash in native code would.
  #[serde(default)]
  pub crash: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Step {
  pub after_ms: u64,
  pub done_sec: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Failure {
  pub kind: SttErrorKind,
  pub detail: String,
}

/// Plays `script` and returns the exit code. Aborts the process for a crash.
pub fn run<W: Write>(script: &Path, emitter: &mut Emitter<W>) -> i32 {
  let started = Instant::now();
  let script: Script = match std::fs::read(script).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
    Some(script) => script,
    None => {
      emitter.emit(&Event::Failed { kind: SttErrorKind::Engine, detail: "the fake engine's script is unreadable".into() });
      return 2;
    }
  };
  play(script, emitter, started)
}

fn play<W: Write>(script: Script, emitter: &mut Emitter<W>, started: Instant) -> i32 {
  emitter.emit(&Event::Started { duration_sec: Some(script.duration_sec) });
  for step in &script.steps {
    std::thread::sleep(Duration::from_millis(step.after_ms));
    emitter.emit(&Event::Progress { done_sec: step.done_sec });
  }
  if script.crash {
    std::process::abort();
  }
  if let Some(failure) = script.failure {
    emitter.emit(&Event::Failed { kind: failure.kind, detail: failure.detail });
    return 1;
  }
  let total_sec = started.elapsed().as_secs_f64();
  emitter.emit(&Event::Done(WorkerResult {
    language: script.language,
    duration_sec: script.duration_sec,
    words: script.words,
    speaker_segments: script.speaker_segments,
    timings: Timings { decode_sec: 0.0, words_sec: total_sec, speakers_sec: total_sec, total_sec, threads: 8 },
  }));
  0
}

#[cfg(test)]
mod tests {
  use super::*;

  fn script(name: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/local-stt").join(name)
  }

  fn events_of(name: &str) -> (i32, Vec<Event>) {
    let mut emitter = Emitter(Vec::new());
    let code = run(&script(name), &mut emitter);
    let text = String::from_utf8(emitter.0).unwrap();
    (code, text.lines().map(|l| Event::from_line(l).expect(l)).collect())
  }

  #[test]
  fn a_scripted_run_reports_progress_then_its_result() {
    let (code, events) = events_of("fake-run.json");
    assert_eq!(code, 0);
    assert!(matches!(events[0], Event::Started { duration_sec: Some(_) }));
    let progress: Vec<f64> = events
      .iter()
      .filter_map(|e| if let Event::Progress { done_sec } = e { Some(*done_sec) } else { None })
      .collect();
    assert!(progress.len() >= 2 && progress.windows(2).all(|p| p[0] <= p[1]));
    let Some(Event::Done(result)) = events.last() else { panic!("no result") };
    assert!(!result.words.is_empty() && !result.speaker_segments.is_empty());
  }

  #[test]
  fn a_scripted_failure_ends_with_its_kind() {
    let (code, events) = events_of("fake-unreadable.json");
    assert_eq!(code, 1);
    assert!(matches!(events.last(), Some(Event::Failed { kind: SttErrorKind::Unreadable, .. })));
  }

  #[test]
  fn every_script_in_the_fixtures_reads() {
    for entry in std::fs::read_dir(script("")).unwrap().flatten() {
      let bytes = std::fs::read(entry.path()).unwrap();
      serde_json::from_slice::<Script>(&bytes).unwrap_or_else(|e| panic!("{}: {e}", entry.path().display()));
    }
  }
}
