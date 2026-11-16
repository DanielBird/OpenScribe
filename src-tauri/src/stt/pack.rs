//! The speech pack (DECISIONS.md D50, D51): the model files this build works with, listed in
//! `speech-pack/pack.json` and compiled into the exe, and the check of a folder that should hold them.
//!
//! A folder `<root>/<pack id>/` holds the files and `receipt.json`, which remembers each file's hash by its size and
//! modified time, so a gigabyte is hashed once rather than at every start. The root is the app's own folder
//! (DECISIONS.md D54): the package's LocalCache, or `%LOCALAPPDATA%\<identifier>` unpackaged. A debug build can point it
//! elsewhere with `DESCRIBE_SPEECH_PACK_DIR`.
//!
//! Every folder under the root that the app made has a receipt, so removing and cleaning up only ever touch files a
//! receipt or the list names.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

const PACK_JSON: &str = include_str!("../../speech-pack/pack.json");
const RECEIPT: &str = "receipt.json";
/// The root's own name, under the app's folder.
const FOLDER: &str = "speech-pack";
/// `identifier` in tauri.conf.json: the unpackaged app's folder under `%LOCALAPPDATA%`, as the web view's (T17).
const IDENTIFIER: &str = "io.github.danielbird.describe";
/// A file being downloaded is `<file>.part` until it matches.
pub const PART: &str = ".part";

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

/// The list compiled into this build.
pub fn compiled() -> PackDef {
  serde_json::from_str(PACK_JSON).expect("speech-pack/pack.json is checked by cargo test")
}

/// The pack this build was made for, or in a debug build the test list `DESCRIBE_SPEECH_PACK_TEST_LIST` names.
pub fn definition() -> &'static PackDef {
  static DEF: OnceLock<PackDef> = OnceLock::new();
  DEF.get_or_init(|| test_list().unwrap_or_else(compiled))
}

/// A debug build's list for a stand-in server (`scripts/speech-pack-test-server.mjs`). A release never reads it.
fn test_list() -> Option<PackDef> {
  if !cfg!(debug_assertions) {
    return None;
  }
  let path = std::env::var_os("DESCRIBE_SPEECH_PACK_TEST_LIST").filter(|v| !v.is_empty())?;
  let text = std::fs::read_to_string(&path).ok()?;
  match serde_json::from_str::<PackDef>(&text) {
    Ok(def) if is_plain_name(&def.id) && def.models.iter().all(|m| is_plain_name(&m.file)) => Some(def),
    Ok(_) => {
      eprintln!("DESCRIBE_SPEECH_PACK_TEST_LIST has an id or file that isn't a plain name; using the compiled list");
      None
    }
    Err(e) => {
      eprintln!("DESCRIBE_SPEECH_PACK_TEST_LIST is unreadable ({e}); using the compiled list");
      None
    }
  }
}

/// Whether the test list is in use, which lets the downloader use plain HTTP to 127.0.0.1 (debug builds only).
pub fn is_test_list() -> bool {
  cfg!(debug_assertions) && *definition() != compiled()
}

/// Whether `url` is plain HTTP to this computer's loopback address, which only tests and the test list may use.
pub fn is_loopback_http(url: &str) -> bool {
  tauri::Url::parse(url).is_ok_and(|u| u.scheme() == "http" && u.host_str() == Some("127.0.0.1"))
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

/// Where the packs are kept: `DESCRIBE_SPEECH_PACK_DIR` in a debug build if it is set; otherwise the installed app's
/// LocalCache (kept across updates, removed on uninstall: Phase 33's D7), or `%LOCALAPPDATA%\<identifier>` unpackaged.
pub fn root() -> Option<PathBuf> {
  if cfg!(debug_assertions)
    && let Some(dir) = std::env::var_os("DESCRIBE_SPEECH_PACK_DIR").filter(|v| !v.is_empty())
  {
    return Some(PathBuf::from(dir));
  }
  static APP: OnceLock<Option<PathBuf>> = OnceLock::new();
  APP
    .get_or_init(|| {
      package_cache_dir()
        .or_else(|| std::env::var_os("LOCALAPPDATA").filter(|v| !v.is_empty()).map(|d| PathBuf::from(d).join(IDENTIFIER)))
        .map(|dir| dir.join(FOLDER))
    })
    .clone()
}

/// The installed app's `LocalCache`, or `None` without package identity.
#[cfg(windows)]
fn package_cache_dir() -> Option<PathBuf> {
  let folder = windows::Storage::ApplicationData::Current().ok()?.LocalCacheFolder().ok()?;
  Some(PathBuf::from(folder.Path().ok()?.to_os_string()))
}

#[cfg(not(windows))]
fn package_cache_dir() -> Option<PathBuf> {
  None
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
pub(crate) struct Receipt {
  pack_id: String,
  version: String,
  files: Vec<ReceiptFile>,
}

impl Receipt {
  fn is_for(&self, def: &PackDef) -> bool {
    self.pack_id == def.id && self.version == def.version
  }
}

/// One file the app found to match: its hash, remembered by its size and modified time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReceiptFile {
  file: String,
  bytes: u64,
  modified_ms: u128,
  sha256: String,
}

pub(crate) fn read_receipt(dir: &Path) -> Option<Receipt> {
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
  other_pack_dirs(root, def).next().is_some()
}

/// The folders under `root`, other than this pack's, with a receipt for another pack or version: the app made them.
fn other_pack_dirs<'a>(root: &Path, def: &'a PackDef) -> impl Iterator<Item = PathBuf> + 'a {
  std::fs::read_dir(root)
    .into_iter()
    .flatten()
    .flatten()
    .map(|e| e.path())
    .filter(move |p| p.is_dir() && p.file_name().is_some_and(|n| n != def.id.as_str()))
    .filter(move |p| read_receipt(p).is_some_and(|r| !r.is_for(def)))
}

/// What one listed file is on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FileState {
  /// There, with the listed size and hash.
  Verified(ReceiptFile),
  /// Not there (a `.part` doesn't count).
  Absent,
  /// There, but the size or hash is wrong, or it can't be read.
  Wrong,
}

/// Checks one listed file in `dir`. Hashes it only if the receipt doesn't vouch for its size and modified time.
pub(crate) fn file_state(dir: &Path, model: &ModelDef, receipt: Option<&Receipt>) -> FileState {
  let path = dir.join(&model.file);
  let Ok(meta) = std::fs::metadata(&path) else { return FileState::Absent };
  if !meta.is_file() || meta.len() != model.bytes {
    return FileState::Wrong;
  }
  let modified = modified_ms(&meta);
  let remembered = receipt.and_then(|r| {
    r.files.iter().find(|f| f.file == model.file && f.bytes == meta.len() && f.modified_ms == modified)
  });
  let sha256 = match remembered {
    Some(entry) => entry.sha256.clone(),
    None => match sha256_of(&path) {
      Ok(hash) => hash,
      Err(_) => return FileState::Wrong,
    },
  };
  if !sha256.eq_ignore_ascii_case(&model.sha256) {
    return FileState::Wrong;
  }
  FileState::Verified(ReceiptFile { file: model.file.clone(), bytes: meta.len(), modified_ms: modified, sha256 })
}

/// The receipt entry for a listed file whose hash was just found to be `sha256`.
pub(crate) fn entry_for(dir: &Path, model: &ModelDef, sha256: String) -> Option<ReceiptFile> {
  let meta = std::fs::metadata(dir.join(&model.file)).ok()?;
  Some(ReceiptFile { file: model.file.clone(), bytes: meta.len(), modified_ms: modified_ms(&meta), sha256 })
}

/// The receipt `dir` should have for this pack: its own if it names this pack and version, else one that keeps only
/// the entries for files this list has, unchanged.
fn start_receipt(dir: &Path, def: &PackDef) -> Receipt {
  let mut receipt = read_receipt(dir).unwrap_or_default();
  if !receipt.is_for(def) {
    receipt
      .files
      .retain(|f| def.models.iter().any(|m| m.file == f.file && m.bytes == f.bytes && m.sha256 == f.sha256));
    receipt.pack_id = def.id.clone();
    receipt.version = def.version.clone();
  }
  receipt
}

/// Makes `dir` with a receipt for this pack, so every folder the app downloads into is one it can clean up.
pub(crate) fn claim(dir: &Path, def: &PackDef) -> std::io::Result<()> {
  std::fs::create_dir_all(dir)?;
  let receipt = start_receipt(dir, def);
  if read_receipt(dir).as_ref() != Some(&receipt) {
    write_receipt(dir, &receipt);
  }
  Ok(())
}

/// Records `file`, just found to match, in the receipt of `dir`, so the next check doesn't hash it again.
pub(crate) fn record_verified(dir: &Path, def: &PackDef, file: ReceiptFile) {
  let mut receipt = start_receipt(dir, def);
  receipt.files.retain(|f| f.file != file.file);
  receipt.files.push(file);
  write_receipt(dir, &receipt);
}

/// Checks `<root>/<def.id>/` against `def`. Hashes only files whose size or modified time differ from the receipt.
///
/// A file that is there but wrong makes the pack damaged (or outdated, under another version's receipt). Otherwise a
/// file that isn't there makes it missing, so a download cancelled half-way is offered again rather than reported as
/// damaged (D54); outdated instead if another version's files are about.
pub fn check(root: &Path, def: &PackDef) -> PackState {
  let dir = root.join(&def.id);
  let receipt = read_receipt(&dir);
  let other_version = receipt.as_ref().is_some_and(|r| !r.is_for(def));
  let mut checked = Vec::with_capacity(def.models.len());
  let mut absent = false;
  for model in &def.models {
    match file_state(&dir, model, receipt.as_ref()) {
      FileState::Verified(entry) => checked.push(entry),
      FileState::Absent => absent = true,
      FileState::Wrong => {
        return PackState::Unusable(if other_version { Unusable::Outdated } else { Unusable::Damaged });
      }
    }
  }
  if absent {
    // Remember what did match, so neither the next check nor the download hashes it again.
    if !other_version && !checked.is_empty() {
      let partial = Receipt { pack_id: def.id.clone(), version: def.version.clone(), files: checked };
      if receipt.as_ref() != Some(&partial) {
        write_receipt(&dir, &partial);
      }
    }
    return if other_version || other_pack_under(root, def) {
      PackState::Unusable(Unusable::Outdated)
    } else {
      PackState::Missing
    };
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

/// Deletes `path` if it is there. Only a failure other than "not found" counts.
pub(crate) fn delete(path: &Path) -> std::io::Result<()> {
  match std::fs::remove_file(path) {
    Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
    _ => Ok(()),
  }
}

/// Whether `name` is one plain file name, so joining it onto a folder stays in that folder: not empty, `.` or `..`,
/// and with no drive, root or separator.
fn is_plain_name(name: &str) -> bool {
  let mut parts = Path::new(name).components();
  matches!((parts.next(), parts.next()), (Some(Component::Normal(part)), None) if part == name)
}

fn is_part(path: &Path) -> bool {
  path.is_file() && path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(PART))
}

/// Empties a folder the app made: the files `names` lists, their `.part`s, every other `.part`, and the receipt. The
/// folder goes too if nothing else is in it. A name that isn't a plain file name (an edited or damaged receipt) is
/// skipped, so nothing outside `dir` is deleted.
fn empty_pack_dir(dir: &Path, names: &[String]) -> std::io::Result<()> {
  for name in names.iter().filter(|n| is_plain_name(n)) {
    delete(&dir.join(name))?;
    delete(&dir.join(format!("{name}{PART}")))?;
  }
  for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
    if is_part(&entry.path()) {
      delete(&entry.path())?;
    }
  }
  delete(&dir.join(format!("{RECEIPT}.tmp")))?;
  delete(&dir.join(RECEIPT))?;
  let _ = std::fs::remove_dir(dir);
  Ok(())
}

/// Deletes the folders other packs or versions left under `root` (decision 5: once the new files are in).
pub fn remove_other_packs(root: &Path, def: &PackDef) -> std::io::Result<()> {
  for dir in other_pack_dirs(root, def).collect::<Vec<_>>() {
    let names: Vec<String> =
      read_receipt(&dir).map(|r| r.files.into_iter().map(|f| f.file).collect()).unwrap_or_default();
    empty_pack_dir(&dir, &names)?;
  }
  Ok(())
}

/// **Remove** in Settings: this pack's files, its partial files and receipt, and other packs' folders. Nothing that
/// neither the list nor a receipt names is touched, and the root goes too if it is then empty.
pub fn remove(root: &Path, def: &PackDef) -> std::io::Result<()> {
  let dir = root.join(&def.id);
  if dir.is_dir() {
    let mut names: Vec<String> = def.models.iter().map(|m| m.file.clone()).collect();
    if let Some(receipt) = read_receipt(&dir) {
      names.extend(receipt.files.into_iter().map(|f| f.file));
    }
    empty_pack_dir(&dir, &names)?;
  }
  remove_other_packs(root, def)?;
  let _ = std::fs::remove_dir(root);
  Ok(())
}

/// At start: partial files this build won't finish. In this pack's folder, a `.part` of a file the list doesn't have,
/// or longer than the list says; in other packs' folders, every `.part`.
pub fn clean_stale_parts(root: &Path, def: &PackDef) {
  for entry in std::fs::read_dir(root.join(&def.id)).into_iter().flatten().flatten() {
    let path = entry.path();
    if !is_part(&path) {
      continue;
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_owned();
    let listed = def.models.iter().find(|m| format!("{}{PART}", m.file) == name);
    let keep = listed.is_some_and(|m| std::fs::metadata(&path).is_ok_and(|meta| meta.len() <= m.bytes));
    if !keep {
      let _ = delete(&path);
    }
  }
  for other in other_pack_dirs(root, def).collect::<Vec<_>>() {
    for entry in std::fs::read_dir(&other).into_iter().flatten().flatten() {
      if is_part(&entry.path()) {
        let _ = delete(&entry.path());
      }
    }
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

  pub fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
  }

  pub const WORDS: &[u8] = b"pretend words model";
  pub const SPEAKERS: &[u8] = b"pretend speakers model, a little longer";

  pub fn model(role: Role, file: &str, content: &[u8]) -> ModelDef {
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

  pub fn test_def(version: &str) -> PackDef {
    PackDef {
      id: "test-pack".into(),
      version: version.into(),
      languages: vec!["en".into()],
      max_speakers: 8,
      models: vec![model(Role::Words, "words.gguf", WORDS), model(Role::Speakers, "speakers.gguf", SPEAKERS)],
    }
  }

  pub fn install(root: &Path, def: &PackDef) -> PathBuf {
    let dir = root.join(&def.id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("words.gguf"), WORDS).unwrap();
    std::fs::write(dir.join("speakers.gguf"), SPEAKERS).unwrap();
    dir
  }

  #[test]
  fn the_builds_pack_is_valid_and_every_url_pinned() {
    let def = &compiled();
    assert!(is_plain_name(&def.id) && !def.version.is_empty());
    assert!(def.model(Role::Words).is_some() && def.model(Role::Speakers).is_some());
    assert_eq!(def.models.len(), 2);
    for m in &def.models {
      assert!(is_plain_name(&m.file), "not a plain file name: {}", m.file);
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
  fn a_wrong_size_or_a_wrong_hash_is_damaged() {
    let def = test_def("1.0.0");

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

  #[test]
  fn a_partly_downloaded_pack_is_missing_not_damaged() {
    let def = test_def("1.0.0");
    let root = TempDir::new("pack-partial");
    let dir = install(&root.0, &def);
    std::fs::remove_file(dir.join("speakers.gguf")).unwrap();
    std::fs::write(dir.join("speakers.gguf.part"), &SPEAKERS[..5]).unwrap();
    assert_eq!(check(&root.0, &def), PackState::Missing);
    // The file that is there was checked and remembered, so a download needn't hash it again.
    assert_eq!(read_receipt(&dir).unwrap().files.len(), 1);
    // A wrong file beside a missing one is still damaged.
    std::fs::write(dir.join("words.gguf"), b"short").unwrap();
    assert_eq!(check(&root.0, &def), PackState::Unusable(Unusable::Damaged));
  }

  #[test]
  fn record_verified_keeps_one_entry_per_file_and_takes_the_new_version() {
    let def = test_def("1.0.0");
    let root = TempDir::new("pack-record");
    let dir = install(&root.0, &def);
    let FileState::Verified(entry) = file_state(&dir, &def.models[0], None) else { panic!("not verified") };
    record_verified(&dir, &def, entry.clone());
    record_verified(&dir, &def, entry);
    let receipt = read_receipt(&dir).unwrap();
    assert_eq!((receipt.files.len(), receipt.version.as_str()), (1, "1.0.0"));
    let newer = test_def("1.1.0");
    claim(&dir, &newer).unwrap();
    assert_eq!(read_receipt(&dir).unwrap().version, "1.1.0");
    assert_eq!(read_receipt(&dir).unwrap().files.len(), 1, "the unchanged file's entry is kept");
  }

  #[test]
  fn remove_deletes_only_what_it_named() {
    let def = test_def("1.0.0");
    let root = TempDir::new("pack-remove");
    let dir = install(&root.0, &def);
    assert!(matches!(check(&root.0, &def), PackState::Ready(_)));
    std::fs::write(dir.join("words.gguf.part"), b"partial").unwrap();
    std::fs::write(dir.join("notes.txt"), b"not ours").unwrap();
    let old = root.0.join("old-pack");
    std::fs::create_dir_all(&old).unwrap();
    std::fs::write(old.join("receipt.json"), r#"{"packId":"old-pack","version":"0.1.0","files":[{"file":"a.gguf","bytes":1,"modifiedMs":0,"sha256":"x"}]}"#).unwrap();
    std::fs::write(old.join("a.gguf"), b"a").unwrap();
    let stranger = root.0.join("someone-elses");
    std::fs::create_dir_all(&stranger).unwrap();
    std::fs::write(stranger.join("b.gguf"), b"b").unwrap();

    remove(&root.0, &def).unwrap();
    assert!(!dir.join("words.gguf").exists() && !dir.join("speakers.gguf").exists());
    assert!(!dir.join("words.gguf.part").exists() && !dir.join("receipt.json").exists());
    assert!(dir.join("notes.txt").exists(), "a file nothing names is left");
    assert!(!old.exists(), "another version's folder goes");
    assert!(stranger.join("b.gguf").exists(), "a folder without a receipt isn't touched");
    assert_eq!(check(&root.0, &def), PackState::Missing);
  }

  #[test]
  fn only_one_plain_file_name_counts_as_plain() {
    for ok in ["words.gguf", "a", "with space.gguf", "..gguf", "words.gguf.part"] {
      assert!(is_plain_name(ok), "{ok:?} should be plain");
    }
    for bad in ["", ".", "..", "../x", "..\\x", "sub/x", "x/", "/x", "\\x", "C:x", "C:\\x", "./x"] {
      if bad.contains('\\') && !cfg!(windows) {
        continue; // A backslash is an ordinary character elsewhere.
      }
      assert!(!is_plain_name(bad), "{bad:?} shouldn't be plain");
    }
  }

  #[test]
  fn a_receipt_cannot_name_a_file_outside_its_folder() {
    let def = test_def("1.0.0");
    let parent = TempDir::new("pack-escape");
    let root = parent.0.join("speech-pack");
    let outside = parent.0.join("outside.txt");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(&outside, b"not ours").unwrap();
    std::fs::write(root.join("beside.txt"), b"not ours either").unwrap();
    let names = [
      outside.to_string_lossy().into_owned(),
      "../../outside.txt".into(),
      "..\\..\\outside.txt".into(),
      "../beside.txt".into(),
      "\\outside.txt".into(),
      "sub/x".into(),
      String::new(),
      "..".into(),
    ];
    let files: Vec<_> = names
      .iter()
      .map(|f| serde_json::json!({ "file": f, "bytes": 1, "modifiedMs": 0, "sha256": "x" }))
      .collect();
    let receipt = |id: &str| serde_json::json!({ "packId": id, "version": "0.1.0", "files": files }).to_string();
    // This pack's folder, under an older version's receipt, and another pack's folder.
    let dir = install(&root, &def);
    std::fs::write(dir.join("receipt.json"), receipt(&def.id)).unwrap();
    let old = root.join("old-pack");
    std::fs::create_dir_all(old.join("sub")).unwrap();
    std::fs::write(old.join("sub").join("x"), b"x").unwrap();
    std::fs::write(old.join("receipt.json"), receipt("old-pack")).unwrap();

    remove(&root, &def).unwrap();
    assert!(outside.exists(), "a file outside the speech pack is left");
    assert!(root.join("beside.txt").exists(), "a file beside the packs' folders is left");
    assert!(old.join("sub").join("x").exists(), "a file in a subfolder isn't named by a plain name");
    assert!(!dir.join("words.gguf").exists() && !dir.join("receipt.json").exists());
    assert!(!old.join("receipt.json").exists());
  }

  #[test]
  fn remove_with_nothing_there_is_fine() {
    let root = TempDir::new("pack-remove-empty");
    remove(&root.0.join("never-made"), &test_def("1.0.0")).unwrap();
  }

  #[test]
  fn stale_parts_are_cleaned_at_start() {
    let def = test_def("1.0.0");
    let root = TempDir::new("pack-stale");
    let dir = root.0.join(&def.id);
    claim(&dir, &def).unwrap();
    std::fs::write(dir.join("words.gguf.part"), &WORDS[..4]).unwrap();
    std::fs::write(dir.join("speakers.gguf.part"), [SPEAKERS, b"too long"].concat()).unwrap();
    std::fs::write(dir.join("unlisted.gguf.part"), b"x").unwrap();
    let old = root.0.join("old-pack");
    claim(&old, &test_def("0.9.0")).unwrap();
    std::fs::write(old.join("words.gguf.part"), b"x").unwrap();

    clean_stale_parts(&root.0, &def);
    assert!(dir.join("words.gguf.part").exists(), "a part this build can finish is kept");
    assert!(!dir.join("speakers.gguf.part").exists());
    assert!(!dir.join("unlisted.gguf.part").exists());
    assert!(!old.join("words.gguf.part").exists());
  }

  #[test]
  fn loopback_http_is_recognised_and_nothing_else() {
    assert!(is_loopback_http("http://127.0.0.1:8765/words.gguf"));
    assert!(!is_loopback_http("https://127.0.0.1:8765/words.gguf"));
    assert!(!is_loopback_http("http://localhost:8765/words.gguf"));
    assert!(!is_loopback_http("http://127.0.0.1.example.com/words.gguf"));
  }
}
