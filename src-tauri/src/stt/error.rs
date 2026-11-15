//! What the page is told when something goes wrong: a kind it maps to a message, and a detail for D41's Technical
//! details. A detail never names a path outside the pack: the recording's path and the user's folders are replaced.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SttErrorKind {
  /// A run is already going.
  Busy,
  /// The speech models are being downloaded or removed.
  Downloading,
  /// The recording handed over is unknown, gone, or not a file.
  Recording,
  /// No speech models in the pack folder.
  PackMissing,
  /// The models are there but don't match the pack's sizes or hashes.
  PackDamaged,
  /// The models on disk belong to another version of the app.
  PackOutdated,
  /// The processor lacks an instruction set the engine needs (AVX2).
  Cpu,
  /// Media Foundation can't read the recording.
  Unreadable,
  /// The engine ran out of memory.
  OutOfMemory,
  /// The engine failed, crashed or answered with something unreadable.
  Engine,
  /// The run was cancelled.
  Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SttError {
  pub kind: SttErrorKind,
  pub detail: String,
}

impl SttError {
  pub fn new(kind: SttErrorKind, detail: impl Into<String>) -> Self {
    Self { kind, detail: detail.into() }
  }
}

impl std::fmt::Display for SttError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{:?}: {}", self.kind, self.detail)
  }
}

impl std::error::Error for SttError {}

/// `text` with `path` (and its parent folders) replaced by `name`, so a detail never shows where files are.
pub fn without_path(text: &str, path: &Path, name: &str) -> String {
  let mut out = text.to_owned();
  for candidate in [path.to_string_lossy().into_owned(), path.to_string_lossy().replace('\\', "/")] {
    if !candidate.is_empty() {
      out = out.replace(&candidate, name);
    }
  }
  if let Some(home) = std::env::var_os("USERPROFILE").map(|h| h.to_string_lossy().into_owned())
    && !home.is_empty()
  {
    out = out.replace(&home, "%USERPROFILE%").replace(&home.replace('\\', "/"), "%USERPROFILE%");
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn kinds_serialize_as_the_page_expects() {
    let json = serde_json::to_string(&SttError::new(SttErrorKind::PackOutdated, "x")).unwrap();
    assert_eq!(json, r#"{"kind":"pack-outdated","detail":"x"}"#);
    assert_eq!(serde_json::to_string(&SttErrorKind::OutOfMemory).unwrap(), r#""out-of-memory""#);
  }

  #[test]
  fn details_lose_the_recordings_path() {
    let path = Path::new(r"D:\Interviews\P01 Anna.m4a");
    let text = r"MFCreateSourceReaderFromURL(D:\Interviews\P01 Anna.m4a) failed; also D:/Interviews/P01 Anna.m4a";
    let cleaned = without_path(text, path, "<recording>");
    assert_eq!(cleaned, "MFCreateSourceReaderFromURL(<recording>) failed; also <recording>");
  }

  #[test]
  fn details_lose_the_users_folder() {
    let Some(home) = std::env::var_os("USERPROFILE") else { return };
    let home = home.to_string_lossy().into_owned();
    let text = format!(r"opening {home}\AppData\x.gguf");
    assert_eq!(without_path(&text, Path::new("unrelated"), "<x>"), r"opening %USERPROFILE%\AppData\x.gguf");
  }
}
