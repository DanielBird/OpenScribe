//! The speech pack (DECISIONS.md D50, D51): the model files this build works with, listed in
//! `speech-pack/pack.json` and compiled into the exe, and the check of a folder that should hold them.
//!
//! A folder `<root>/<pack id>/` holds the files and `receipt.json`, which remembers each file's hash by its size and
//! modified time, so a gigabyte is hashed once rather than at every start. In this phase the root comes from
//! `DESCRIBE_SPEECH_PACK_DIR`, in debug builds only; Phase 35 adds the app's own folder.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

const PACK_JSON: &str = include_str!("../../speech-pack/pack.json");
const RECEIPT: &str = "receipt.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
  Words,
  Speakers,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelDef {
  pub role: Role,
  pub file: String,
  pub bytes: u64,
  pub sha256: String,
  pub url: String,
  pub name: String,
  pub card: String,
  pub licence: String,
  pub copyright: String,
  /// `None` for the publisher's own file; otherwise what was done to it.
  pub changes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackDef {
  pub id: String,
  pub version: String,
  pub languages: Vec<String>,
  pub max_speakers: u32,
  pub models: Vec<ModelDef>,
}

impl PackDef {
  pub fn model(&self, role: Role) -> Option<&ModelDef> {
    self.models.iter().find(|m| m.role == role)
  }

  /// What the page is told about the pack (`SpeechPackInfo` in `bridge.ts`).
  pub fn info(&self) -> SpeechPackInfo {
    SpeechPackInfo {
      id: self.id.clone(),
      version: self.version.clone(),
      languages: self.languages.clone(),
      max_speakers: self.max_speakers,
      download_bytes: self.models.iter().map(|m| m.bytes).sum(),
    }
  }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechPackInfo {
  pub id: String,
  pub version: String,
  pub languages: Vec<String>,
  pub max_speakers: u32,
  pub download_bytes: u64,
}

/// The pack this build was made for.
pub fn definition() -> &'static PackDef {
  static DEF: OnceLock<PackDef> = OnceLock::new();
  DEF.get_or_init(|| serde_json::from_str(PACK_JSON).expect("speech-pack/pack.json is checked by cargo test"))
}

/// Whether `url` names exactly `file` at a fixed commit on Hugging Face, so nothing unpinned can be downloaded.
pub fn is_pinned(url: &str, file: &str) -> bool {
  let Ok(url) = tauri::Url::parse(url) else { return false };
  if url.scheme() != "https" || url.host_str() != Some("huggingface.co") || url.port().is_some() {
    return false;
  }
  if url.query().is_some() || url.fragment().is_some() || !url.username().is_empty() {
    return false;
  }
  let segments: Vec<&str> = url.path_segments().map(|s| s.collect()).unwrap_or_default();
  matches!(
    segments.as_slice(),
    [org, repo, "resolve", commit, name]
      if !org.is_empty() && !repo.is_empty() && commit.len() == 40
        && commit.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && *name == file
  )
}

/// Where the packs are kept: `DESCRIBE_SPEECH_PACK_DIR` in a debug build, nowhere yet in a release (Phase 35).
pub fn root() -> Option<PathBuf> {
  if !cfg!(debug_assertions) {
    return None;
  }
  std::env::var_os("DESCRIBE_SPEECH_PACK_DIR").filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// The files of a pack that checked out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadyPack {
  pub dir: PathBuf,
  pub words: PathBuf,
  pub speakers: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Unusable {
  /// This build's files are there but wrong or incomplete.
  Damaged,
  /// The files on disk belong to another version of the app.
  Outdated,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackState {
  Ready(ReadyPack),
  Missing,
  Unusable(Unusable),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
  pack_id: String,
  version: String,
  files: Vec<ReceiptFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptFile {
  file: String,
  bytes: u64,
  modified_ms: u128,
  sha256: String,
}

fn read_receipt(dir: &Path) -> Option<Receipt> {
  serde_json::from_slice(&std::fs::read(dir.join(RECEIPT)).ok()?).ok()
}

/// Writes the receipt beside the files, through a temporary name. A failure only means hashing again next time.
fn write_receipt(dir: &Path, receipt: &Receipt) {
  let Ok(json) = serde_json::to_vec_pretty(receipt) else { return };
  let temp = dir.join(format!("{RECEIPT}.tmp"));
  if std::fs::write(&temp, json).is_ok() {
    let _ = std::fs::rename(&temp, dir.join(RECEIPT));
  }
}

fn modified_ms(meta: &std::fs::Metadata) -> u128 {
  meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0)
}

/// The SHA-256 of a file, as lower-case hex, read in 1 MB pieces.
pub fn sha256_of(path: &Path) -> std::io::Result<String> {
  let mut file = std::fs::File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buffer = vec![0u8; 1 << 20];
  loop {
    let n = file.read(&mut buffer)?;
    if n == 0 {
      break;
    }
    hasher.update(&buffer[..n]);
  }
  Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Whether another pack's folder (a receipt naming another pack or version) sits under `root`.
fn other_pack_under(root: &Path, def: &PackDef) -> bool {
  let Ok(entries) = std::fs::read_dir(root) else { return false };
  entries.flatten().filter(|e| e.path().is_dir()).any(|e| {
    read_receipt(&e.path()).is_some_and(|r| r.pack_id != def.id || r.version != def.version)
  })
}

/// Checks `<root>/<def.id>/` against `def`. Hashes only files whose size or modified time differ from the receipt.
pub fn check(root: &Path, def: &PackDef) -> PackState {
  let dir = root.join(&def.id);
  let receipt = read_receipt(&dir);
  let other_version = receipt.as_ref().is_some_and(|r| r.pack_id != def.id || r.version != def.version);
  let present: Vec<bool> = def.models.iter().map(|m| dir.join(&m.file).is_file()).collect();

  if !present.iter().any(|p| *p) {
    return if other_version || other_pack_under(root, def) {
      PackState::Unusable(Unusable::Outdated)
    } else {
      PackState::Missing
    };
  }
  let wrong = if other_version { Unusable::Outdated } else { Unusable::Damaged };
  if present.iter().any(|p| !*p) {
    return PackState::Unusable(wrong);
  }

  let mut checked = Vec::with_capacity(def.models.len());
  for model in &def.models {
    let path = dir.join(&model.file);
    let Ok(meta) = std::fs::metadata(&path) else { return PackState::Unusable(wrong) };
    if meta.len() != model.bytes {
      return PackState::Unusable(wrong);
    }
    let modified = modified_ms(&meta);
    let remembered = receipt.as_ref().and_then(|r| {
      r.files.iter().find(|f| f.file == model.file && f.bytes == meta.len() && f.modified_ms == modified)
    });
    let sha256 = match remembered {
      Some(entry) => entry.sha256.clone(),
      None => match sha256_of(&path) {
        Ok(hash) => hash,
        Err(_) => return PackState::Unusable(wrong),
      },
    };
    if !sha256.eq_ignore_ascii_case(&model.sha256) {
      return PackState::Unusable(wrong);
    }
    checked.push(ReceiptFile { file: model.file.clone(), bytes: meta.len(), modified_ms: modified, sha256 });
  }

  let fresh = Receipt { pack_id: def.id.clone(), version: def.version.clone(), files: checked };
  if receipt.as_ref() != Some(&fresh) {
    write_receipt(&dir, &fresh);
  }
  let path_of = |role| def.model(role).map(|m| dir.join(&m.file));
  match (path_of(Role::Words), path_of(Role::Speakers)) {
    (Some(words), Some(speakers)) => PackState::Ready(ReadyPack { dir, words, speakers }),
    _ => PackState::Unusable(Unusable::Damaged),
  }
}

#[cfg(test)]
pub mod tests {
  use super::*;
  use std::sync::atomic::{AtomicU32, Ordering};

  /// A fresh, empty folder under the system's temporary folder, deleted when dropped.
  pub struct TempDir(pub PathBuf);
  impl TempDir {
    pub fn new(name: &str) -> Self {
      static N: AtomicU32 = AtomicU32::new(0);
      let dir = std::env::temp_dir()
        .join(format!("describe-test-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
      let _ = std::fs::remove_dir_all(&dir);
      std::fs::create_dir_all(&dir).unwrap();
      Self(dir)
    }
  }
  impl Drop for TempDir {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
  }

  const WORDS: &[u8] = b"pretend words model";
  const SPEAKERS: &[u8] = b"pretend speakers model, a little longer";

  fn model(role: Role, file: &str, content: &[u8]) -> ModelDef {
    ModelDef {
      role,
      file: file.into(),
      bytes: content.len() as u64,
      sha256: hash(content),
      url: format!("https://huggingface.co/org/repo/resolve/{}/{file}", "a".repeat(40)),
      name: file.into(),
      card: "https://huggingface.co/org/repo".into(),
      licence: "CC-BY-4.0".into(),
      copyright: "© Someone".into(),
      changes: None,
    }
  }

  fn test_def(version: &str) -> PackDef {
    PackDef {
      id: "test-pack".into(),
      version: version.into(),
      languages: vec!["en".into()],
      max_speakers: 8,
      models: vec![model(Role::Words, "words.gguf", WORDS), model(Role::Speakers, "speakers.gguf", SPEAKERS)],
    }
  }

  fn install(root: &Path, def: &PackDef) -> PathBuf {
    let dir = root.join(&def.id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("words.gguf"), WORDS).unwrap();
    std::fs::write(dir.join("speakers.gguf"), SPEAKERS).unwrap();
    dir
  }

  #[test]
  fn the_builds_pack_is_valid_and_every_url_pinned() {
    let def = definition();
    assert!(!def.id.is_empty() && !def.version.is_empty());
    assert!(def.model(Role::Words).is_some() && def.model(Role::Speakers).is_some());
    assert_eq!(def.models.len(), 2);
    for m in &def.models {
      assert!(is_pinned(&m.url, &m.file), "not pinned: {}", m.url);
      assert_eq!(m.sha256.len(), 64);
      assert!(m.bytes > 0);
      assert!(m.card.starts_with("https://huggingface.co/"));
    }
    assert!(def.languages.contains(&"en".to_string()));
    assert_eq!(def.info().download_bytes, def.models.iter().map(|m| m.bytes).sum::<u64>());
  }

  #[test]
  fn only_a_url_at_a_commit_counts_as_pinned() {
    let commit = "541d1f99c6b0c3cd0b11a95167540bb8edefd82b";
    let ok = format!("https://huggingface.co/nvidia/m/resolve/{commit}/f.gguf");
    assert!(is_pinned(&ok, "f.gguf"));
    assert!(!is_pinned(&ok, "other.gguf"));
    assert!(!is_pinned("https://huggingface.co/nvidia/m/resolve/main/f.gguf", "f.gguf"));
    assert!(!is_pinned(&ok.replace("https:", "http:"), "f.gguf"));
    assert!(!is_pinned(&ok.replace("huggingface.co", "huggingface.co.evil.example"), "f.gguf"));
    assert!(!is_pinned(&format!("{ok}?download=true"), "f.gguf"));
    assert!(!is_pinned(&ok.replace("resolve", "blob"), "f.gguf"));
    assert!(!is_pinned(&ok.replace(commit, &commit.to_uppercase()), "f.gguf"));
  }

  #[test]
  fn a_valid_folder_is_ready_and_writes_its_receipt() {
    let root = TempDir::new("pack-valid");
    let def = test_def("1.0.0");
    let dir = install(&root.0, &def);
    let state = check(&root.0, &def);
    assert_eq!(
      state,
      PackState::Ready(ReadyPack { dir: dir.clone(), words: dir.join("words.gguf"), speakers: dir.join("speakers.gguf") })
    );
    let receipt = read_receipt(&dir).unwrap();
    assert_eq!(receipt.version, "1.0.0");
    assert_eq!(receipt.files.len(), 2);
  }

  #[test]
  fn nothing_there_is_missing() {
    let root = TempDir::new("pack-missing");
    assert_eq!(check(&root.0, &test_def("1.0.0")), PackState::Missing);
    assert_eq!(check(&root.0.join("does-not-exist"), &test_def("1.0.0")), PackState::Missing);
  }

  #[test]
  fn a_missing_file_a_wrong_size_or_a_wrong_hash_is_damaged() {
    let def = test_def("1.0.0");
    let root = TempDir::new("pack-missing-file");
    let dir = install(&root.0, &def);
    std::fs::remove_file(dir.join("speakers.gguf")).unwrap();
    assert_eq!(check(&root.0, &def), PackState::Unusable(Unusable::Damaged));

    let root = TempDir::new("pack-size");
    let dir = install(&root.0, &def);
    std::fs::write(dir.join("words.gguf"), b"short").unwrap();
    assert_eq!(check(&root.0, &def), PackState::Unusable(Unusable::Damaged));

    let root = TempDir::new("pack-hash");
    let dir = install(&root.0, &def);
    let mut altered = WORDS.to_vec();
    altered[0] ^= 1;
    std::fs::write(dir.join("words.gguf"), altered).unwrap();
    assert_eq!(check(&root.0, &def), PackState::Unusable(Unusable::Damaged));
  }

  #[test]
  fn the_receipt_is_reused_and_invalidated_by_a_change() {
    let def = test_def("1.0.0");
    let root = TempDir::new("pack-receipt");
    let dir = install(&root.0, &def);
    assert!(matches!(check(&root.0, &def), PackState::Ready(_)));

    // A receipt that vouches for a hash is believed while size and modified time match: proof that no hashing ran.
    let mut receipt = read_receipt(&dir).unwrap();
    receipt.files[0].sha256 = "0".repeat(64);
    write_receipt(&dir, &receipt);
    assert_eq!(check(&root.0, &def), PackState::Unusable(Unusable::Damaged));

    // Touching the file changes its modified time, so it is hashed again, found right, and the receipt fixed.
    std::thread::sleep(std::time::Duration::from_millis(20));
    std::fs::write(dir.join("words.gguf"), WORDS).unwrap();
    assert!(matches!(check(&root.0, &def), PackState::Ready(_)));
    assert_eq!(read_receipt(&dir).unwrap().files[0].sha256, hash(WORDS));
  }

  #[test]
  fn another_versions_files_are_outdated() {
    let root = TempDir::new("pack-outdated");
    let old = test_def("0.9.0");
    let dir = install(&root.0, &old);
    assert!(matches!(check(&root.0, &old), PackState::Ready(_)));
    // The next version lists other files: the old ones are there, under a receipt for 0.9.0.
    let mut new = test_def("1.0.0");
    new.models[0] = model(Role::Words, "words.gguf", b"the new words model");
    assert_eq!(check(&root.0, &new), PackState::Unusable(Unusable::Outdated));
    // Only another pack's folder, nothing of this one's.
    std::fs::rename(&dir, root.0.join("an-older-pack")).unwrap();
    assert_eq!(check(&root.0, &new), PackState::Unusable(Unusable::Outdated));
  }

  #[test]
  fn a_new_version_with_the_same_files_stays_ready() {
    let root = TempDir::new("pack-same-files");
    install(&root.0, &test_def("1.0.0"));
    assert!(matches!(check(&root.0, &test_def("1.0.0")), PackState::Ready(_)));
    assert!(matches!(check(&root.0, &test_def("1.1.0")), PackState::Ready(_)));
  }
}
