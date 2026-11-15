//! Downloading the speech models (DECISIONS.md D50, D51, D54), only when the user clicks **Download speech models**.
//!
//! - Only the URLs in the pack's list, each pinned to a commit on huggingface.co (`pack::is_pinned`). Hugging Face
//!   hands the file on to a delivery host whose name changes, so redirects are followed by hand, over HTTPS only, and
//!   the file's size and SHA-256 decide whether it is accepted, not the host it came from.
//! - WinHTTP (Phase 33's D6): Windows' proxy settings, PAC included (`WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY`), and
//!   Windows' certificate store, where a company's inspecting CA lives. Revocation isn't checked
//!   (`WINHTTP_ENABLE_SSL_REVOCATION` is never set): the work laptop's network can't answer it (D5), and the pinned
//!   hash is the guarantee.
//! - Each file is written as `<file>.part`, checked, and only then given its name (decision 2). A `.part` is resumed
//!   with a Range request; a server that answers `200` starts the file again (decision 3, D5).
//! - One attempt: a failure ends it with a kind the page can word. No retries.
//! - Nothing about the user is sent. The request carries `DeScribe/<version>` as its user agent, and a detail names
//!   hosts and statuses, never a whole (signed) URL or a folder.

use super::error::without_path;
use super::pack::{self, FileState, ModelDef, PART, PackDef};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Free space wanted beyond the files themselves.
const MARGIN: u64 = 100 * 1_000_000;
/// More redirects than this is not a file server.
const MAX_HOPS: usize = 10;
/// Progress goes to the page at most this often.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadErrorKind {
  /// The network refused: 401, 403, 407, 451, an untrusted certificate, a web page or the wrong size, plain HTTP.
  Blocked,
  /// No connection, no name, a timeout, or the connection ended early (the `.part` is kept).
  Offline,
  /// 429 or a server error: try again later.
  Busy,
  /// Not enough space, or a write failed.
  Disk,
  /// A complete file with the wrong hash (it is deleted).
  Mismatch,
  /// 404 or 410: this build's files aren't there any more.
  Gone,
  /// The user cancelled.
  Cancelled,
  /// A transcription or another download is running.
  InUse,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DownloadError {
  pub kind: DownloadErrorKind,
  pub detail: String,
}

impl DownloadError {
  pub fn new(kind: DownloadErrorKind, detail: impl Into<String>) -> Self {
    Self { kind, detail: detail.into() }
  }
}

impl std::fmt::Display for DownloadError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{:?}: {}", self.kind, self.detail)
  }
}

impl std::error::Error for DownloadError {}

use DownloadErrorKind as Kind;

/// The download going now (or a removal, which holds the same place), as cancel and the status see it.
#[derive(Debug)]
pub struct Downloading {
  cancelled: AtomicBool,
  /// The WinHTTP request handle being read, so cancel can close it and a stalled read returns at once (0 if none).
  request: AtomicIsize,
  received: AtomicU64,
  total: u64,
  removal: bool,
}

impl Downloading {
  pub fn new(total: u64) -> Self {
    Self { cancelled: AtomicBool::new(false), request: AtomicIsize::new(0), received: AtomicU64::new(0), total, removal: false }
  }

  /// A removal: refuses runs and downloads while it lasts, and is never reported as downloading.
  pub fn removal() -> Self {
    Self { removal: true, ..Self::new(0) }
  }

  pub fn is_removal(&self) -> bool {
    self.removal
  }

  /// Bytes of the whole download so far, and its total.
  pub fn progress(&self) -> (u64, u64) {
    (self.received.load(Ordering::SeqCst), self.total)
  }

  pub fn is_cancelled(&self) -> bool {
    self.cancelled.load(Ordering::SeqCst)
  }

  /// Stops the download: the flag ends the read loop, and closing the request ends a read that is waiting.
  pub fn cancel(&self) {
    self.cancelled.store(true, Ordering::SeqCst);
    let handle = self.request.swap(0, Ordering::SeqCst);
    if handle != 0 {
      http::close(handle);
    }
  }
}

pub struct Options<'a> {
  pub user_agent: String,
  /// Plain HTTP to 127.0.0.1: tests, and a debug build's test list. Never in a release.
  pub allow_loopback_http: bool,
  /// Free bytes on the drive that holds a folder (or the nearest one that exists).
  pub free_bytes: &'a dyn Fn(&Path) -> Option<u64>,
}

/// Progress as bytes of the whole download, at most every `PROGRESS_EVERY`.
struct Progress<'a> {
  state: &'a Downloading,
  last: Option<Instant>,
  on_progress: &'a mut dyn FnMut(u64, u64),
}

impl Progress<'_> {
  fn report(&mut self, received: u64, force: bool) {
    self.state.received.store(received, Ordering::SeqCst);
    if force || self.last.is_none_or(|t| t.elapsed() >= PROGRESS_EVERY) {
      self.last = Some(Instant::now());
      (self.on_progress)(received, self.state.total);
    }
  }
}

/// Downloads every file of `def` that isn't already in `<root>/<id>/` and verified, then deletes other packs' folders.
pub fn download(
  def: &PackDef,
  root: &Path,
  state: &Downloading,
  opts: &Options<'_>,
  on_progress: &mut dyn FnMut(u64, u64),
) -> Result<(), DownloadError> {
  let dir = root.join(&def.id);
  let disk = |what: &str, e: std::io::Error| disk_error(root, what, &e);
  pack::claim(&dir, def).map_err(|e| disk("making the folder", e))?;

  let receipt = pack::read_receipt(&dir);
  let mut todo = Vec::new();
  let mut done = 0u64;
  for model in &def.models {
    match pack::file_state(&dir, model, receipt.as_ref()) {
      FileState::Verified(entry) => {
        pack::record_verified(&dir, def, entry);
        done += model.bytes;
      }
      FileState::Wrong => {
        pack::delete(&dir.join(&model.file)).map_err(|e| disk("deleting a damaged file", e))?;
        todo.push(model);
      }
      FileState::Absent => todo.push(model),
    }
  }
  let mut progress = Progress { state, last: None, on_progress };
  progress.report(done, true);

  if !todo.is_empty() {
    let needed = todo.iter().map(|m| m.bytes).sum::<u64>() + MARGIN;
    if let Some(free) = (opts.free_bytes)(&dir)
      && free < needed
    {
      return Err(DownloadError::new(Kind::Disk, format!("{needed} bytes needed, {free} free")));
    }
    let session = http::Session::open(&opts.user_agent)?;
    for model in todo {
      if state.is_cancelled() {
        return Err(cancelled());
      }
      fetch(&session, def, model, &dir, root, state, opts, done, &mut progress)?;
      done += model.bytes;
    }
  }
  // Decision 5: another version's files go once these are in. Failing to delete them doesn't undo the download.
  let _ = pack::remove_other_packs(root, def);
  progress.report(done, true);
  Ok(())
}

fn cancelled() -> DownloadError {
  DownloadError::new(Kind::Cancelled, "cancelled")
}

fn disk_error(root: &Path, what: &str, e: &std::io::Error) -> DownloadError {
  let full = e.raw_os_error() == Some(112); // ERROR_DISK_FULL
  let text = if full { format!("{what}: the disk is full") } else { format!("{what}: {e}") };
  DownloadError::new(Kind::Disk, without_path(&text, root, "<speech-pack>"))
}

fn part_of(dir: &Path, model: &ModelDef) -> PathBuf {
  dir.join(format!("{}{PART}", model.file))
}

fn len_of(path: &Path) -> u64 {
  std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// One file: the rest of its `.part`, then the checks, then its real name and its line in the receipt.
#[allow(clippy::too_many_arguments)]
fn fetch(
  session: &http::Session,
  def: &PackDef,
  model: &ModelDef,
  dir: &Path,
  root: &Path,
  state: &Downloading,
  opts: &Options<'_>,
  before: u64,
  progress: &mut Progress<'_>,
) -> Result<(), DownloadError> {
  let part = part_of(dir, model);
  let disk = |what: &str, e: std::io::Error| disk_error(root, what, &e);
  let mut have = len_of(&part);
  if have > model.bytes {
    pack::delete(&part).map_err(|e| disk("deleting a partial file", e))?;
    have = 0;
  }
  if have < model.bytes {
    receive(session, model, &part, have, root, state, opts, before, progress)?;
  }

  let size = len_of(&part);
  if size < model.bytes {
    // WinHTTP reports a cut connection as the end of the body. The part is kept for the next attempt.
    return Err(DownloadError::new(Kind::Offline, format!("{}: the download stopped at {size} of {} bytes", model.file, model.bytes)));
  }
  if size > model.bytes {
    let _ = pack::delete(&part);
    return Err(DownloadError::new(Kind::Blocked, format!("{}: {size} bytes, expected {}", model.file, model.bytes)));
  }
  let sha256 = pack::sha256_of(&part).map_err(|e| disk("reading the download", e))?;
  if !sha256.eq_ignore_ascii_case(&model.sha256) {
    let _ = pack::delete(&part);
    return Err(DownloadError::new(Kind::Mismatch, format!("{}: SHA-256 {sha256}", model.file)));
  }
  let target = dir.join(&model.file);
  pack::delete(&target).map_err(|e| disk("replacing the old file", e))?;
  std::fs::rename(&part, &target).map_err(|e| disk("naming the file", e))?;
  if let Some(entry) = pack::entry_for(dir, model, sha256) {
    pack::record_verified(dir, def, entry);
  }
  progress.report(before + model.bytes, true);
  Ok(())
}

fn host_of(url: &tauri::Url) -> String {
  url.host_str().unwrap_or("?").to_owned()
}

/// Whether the app may request `url`: the listed URL first, and then any HTTPS URL a redirect names.
fn allowed(url: &tauri::Url, model: &ModelDef, opts: &Options<'_>, first: bool) -> Result<(), DownloadError> {
  let loopback = opts.allow_loopback_http && pack::is_loopback_http(url.as_str());
  if first {
    if pack::is_pinned(url.as_str(), &model.file) || loopback {
      return Ok(());
    }
    return Err(DownloadError::new(Kind::Gone, format!("{}: the list's URL isn't pinned", model.file)));
  }
  if url.scheme() == "https" || loopback {
    return Ok(());
  }
  Err(DownloadError::new(Kind::Blocked, format!("a redirect to plain HTTP at {}", host_of(url))))
}

/// The request and its redirects, then the body appended to (or replacing) the `.part`.
#[allow(clippy::too_many_arguments)]
fn receive(
  session: &http::Session,
  model: &ModelDef,
  part: &Path,
  have: u64,
  root: &Path,
  state: &Downloading,
  opts: &Options<'_>,
  before: u64,
  progress: &mut Progress<'_>,
) -> Result<(), DownloadError> {
  let range = (have > 0).then_some(have);
  let mut url = tauri::Url::parse(&model.url)
    .map_err(|_| DownloadError::new(Kind::Gone, format!("{}: the list's URL can't be read", model.file)))?;
  let mut hops: Vec<String> = Vec::new();
  let mut response = loop {
    if state.is_cancelled() {
      return Err(cancelled());
    }
    allowed(&url, model, opts, hops.is_empty())?;
    let response = session.get(&url, range, state).map_err(|e| e.at(&hops, &host_of(&url), state))?;
    hops.push(format!("{} {}", host_of(&url), response.head.status));
    if (300..400).contains(&response.head.status) {
      let Some(location) = response.head.location.clone() else {
        return Err(DownloadError::new(Kind::Blocked, format!("a redirect without a Location ({})", hops.join(" → "))));
      };
      if hops.len() >= MAX_HOPS {
        return Err(DownloadError::new(Kind::Blocked, format!("more than {MAX_HOPS} redirects")));
      }
      url = url
        .join(location.trim())
        .map_err(|_| DownloadError::new(Kind::Blocked, format!("an unreadable redirect ({})", hops.join(" → "))))?;
      continue;
    }
    break response;
  };
  let trail = hops.join(" → ");
  let head = &response.head;
  let fail = |kind, why: String| DownloadError::new(kind, format!("{}: {why} ({trail})", model.file));
  match head.status {
    200 | 206 => {}
    401 | 403 | 407 | 451 => return Err(fail(Kind::Blocked, format!("HTTP {}", head.status))),
    404 | 410 => return Err(fail(Kind::Gone, format!("HTTP {}", head.status))),
    429 | 500..=599 => {
      let wait = head.retry_after.as_deref().map(|r| format!(", Retry-After {}", r.trim())).unwrap_or_default();
      return Err(fail(Kind::Busy, format!("HTTP {}{wait}", head.status)));
    }
    s => return Err(fail(Kind::Blocked, format!("HTTP {s}"))),
  }
  if let Some(kind) = head.content_type.as_deref().filter(|t| t.trim().to_ascii_lowercase().starts_with("text/html")) {
    return Err(fail(Kind::Blocked, format!("a web page ({}), not the file", kind.trim())));
  }
  let resumed = head.status == 206;
  if resumed {
    let expected_start = format!("bytes {have}-");
    let expected_end = format!("/{}", model.bytes);
    let fits = range.is_some()
      && head.content_range.as_deref().is_some_and(|r| r.trim().starts_with(&expected_start) && r.trim().ends_with(&expected_end));
    if !fits {
      let _ = pack::delete(part);
      return Err(fail(Kind::Blocked, format!("a partial answer that doesn't fit ({:?})", head.content_range.as_deref().unwrap_or(""))));
    }
  }
  let start = if resumed { have } else { 0 };
  if let Some(length) = head.content_length
    && start + length != model.bytes
  {
    return Err(fail(Kind::Blocked, format!("{} bytes on offer, expected {}", start + length, model.bytes)));
  }

  let disk = |what: &str, e: std::io::Error| disk_error(root, what, &e);
  let mut file = if resumed {
    std::fs::OpenOptions::new().append(true).open(part)
  } else {
    std::fs::File::create(part)
  }
  .map_err(|e| disk("opening the download", e))?;
  let mut buffer = vec![0u8; 1 << 20];
  let mut written = 0u64;
  progress.report(before + start, false);
  loop {
    if state.is_cancelled() {
      return Err(cancelled());
    }
    let n = match response.read(&mut buffer) {
      Ok(n) => n,
      Err(_) if state.is_cancelled() => return Err(cancelled()),
      Err(e) => return Err(http::classify_io(&e).at(&hops, "", state)),
    };
    if n == 0 {
      break;
    }
    if start + written + n as u64 > model.bytes {
      drop(file);
      let _ = pack::delete(part);
      return Err(fail(Kind::Blocked, format!("more than the {} bytes listed", model.bytes)));
    }
    file.write_all(&buffer[..n]).map_err(|e| disk("writing the download", e))?;
    written += n as u64;
    progress.report(before + start + written, false);
  }
  file.flush().map_err(|e| disk("writing the download", e))?;
  Ok(())
}

/// A failure inside WinHTTP, before it is placed in the trail of hosts.
#[derive(Debug)]
pub struct NetError {
  kind: Kind,
  detail: String,
}

impl NetError {
  fn at(self, hops: &[String], host: &str, state: &Downloading) -> DownloadError {
    if state.is_cancelled() {
      return cancelled();
    }
    let trail = hops.join(" → ");
    let place = match (host.is_empty(), hops.is_empty()) {
      (false, true) => format!(" at {host}"),
      (false, false) => format!(" at {host}, after {trail}"),
      (true, false) => format!(" ({trail})"),
      (true, true) => String::new(),
    };
    DownloadError::new(self.kind, format!("{}{place}", self.detail))
  }
}

/// The response's head: what the download decides on.
#[derive(Debug, Default)]
pub struct Head {
  pub status: u16,
  pub location: Option<String>,
  pub content_type: Option<String>,
  pub content_length: Option<u64>,
  pub content_range: Option<String>,
  pub retry_after: Option<String>,
}

/// Free bytes on the drive of `path`, or of its nearest folder that exists.
pub fn free_bytes(path: &Path) -> Option<u64> {
  let existing = path.ancestors().find(|p| p.exists())?;
  http::free_bytes(existing)
}

#[cfg(windows)]
mod http {
  use super::{Downloading, Head, Kind, NetError};
  use std::io::Read;
  use std::path::Path;
  use std::sync::atomic::Ordering;
  use windows::Win32::Networking::WinHttp::*;
  use windows::core::{HSTRING, PCWSTR};

  /// Win32 codes as WinHTTP reports them (sometimes wrapped as HRESULTs, 0x8007xxxx).
  fn code_of(raw: u32) -> u32 {
    if raw & 0xFFFF_0000 == 0x8007_0000 { raw & 0xFFFF } else { raw }
  }

  pub fn classify(raw: u32, stage: &str) -> NetError {
    let code = code_of(raw);
    let kind = match code {
      // No name, no connection, a timeout, a connection that broke.
      12007 | 12029 | 12002 | 12030 | 12152 => Kind::Offline,
      // A certificate that isn't trusted, is for another name, has expired, or a client certificate is asked for.
      12175 | 12045 | 12038 | 12037 | 12057 | 12169 | 12044 => Kind::Blocked,
      // Anything else, 12017 included (closed by cancel, which `NetError::at` reports as cancelled).
      _ => Kind::Offline,
    };
    NetError { kind, detail: format!("{stage}: WinHTTP error {code}") }
  }

  fn last(stage: &str) -> NetError {
    classify(windows::core::Error::from_thread().code().0 as u32, stage)
  }

  pub fn classify_io(e: &std::io::Error) -> NetError {
    match e.raw_os_error() {
      Some(code) => classify(code as u32, "reading"),
      None => NetError { kind: Kind::Offline, detail: format!("reading: {e}") },
    }
  }

  pub fn close(handle: isize) {
    // SAFETY: a WinHTTP handle this module opened, closed once (whoever swaps it out of `Downloading::request`).
    unsafe {
      let _ = WinHttpCloseHandle(handle as *mut core::ffi::c_void);
    }
  }

  pub fn free_bytes(path: &Path) -> Option<u64> {
    let mut free = 0u64;
    // SAFETY: the out pointer is valid for the call.
    unsafe {
      windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(&HSTRING::from(path.as_os_str()), Some(&mut free), None, None)
    }
    .ok()?;
    Some(free)
  }

  pub struct Session(*mut core::ffi::c_void);

  impl Session {
    pub fn open(user_agent: &str) -> Result<Session, super::DownloadError> {
      // SAFETY: plain WinHTTP calls; the handle is closed in Drop.
      let session = unsafe {
        WinHttpOpen(&HSTRING::from(user_agent), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, PCWSTR::null(), PCWSTR::null(), 0)
      };
      if session.is_null() {
        let e = last("WinHttpOpen");
        return Err(super::DownloadError::new(e.kind, e.detail));
      }
      // Resolve, connect and send: 30 s; a receive that waits 60 s with nothing arriving ends the attempt.
      let _ = unsafe { WinHttpSetTimeouts(session, 30_000, 30_000, 30_000, 60_000) };
      Ok(Session(session))
    }

    /// One GET, no redirects followed. The request is registered in `state`, so cancel can close it.
    pub fn get<'a>(&self, url: &tauri::Url, range: Option<u64>, state: &'a Downloading) -> Result<Response<'a>, NetError> {
      let secure = url.scheme() == "https";
      let host = url.host_str().unwrap_or_default();
      let port = url.port_or_known_default().unwrap_or(if secure { 443 } else { 80 });
      let mut target = url.path().to_owned();
      if let Some(query) = url.query() {
        target.push('?');
        target.push_str(query);
      }
      // SAFETY: plain WinHTTP calls on handles this function owns until Response takes them.
      unsafe {
        let connect = WinHttpConnect(self.0, &HSTRING::from(host), port, 0);
        if connect.is_null() {
          return Err(last("connecting"));
        }
        let request = WinHttpOpenRequest(
          connect,
          &HSTRING::from("GET"),
          &HSTRING::from(target.as_str()),
          PCWSTR::null(),
          PCWSTR::null(),
          std::ptr::null(),
          if secure { WINHTTP_FLAG_SECURE } else { WINHTTP_OPEN_REQUEST_FLAGS(0) },
        );
        if request.is_null() {
          let e = last("opening the request");
          let _ = WinHttpCloseHandle(connect);
          return Err(e);
        }
        state.request.store(request as isize, Ordering::SeqCst);
        let response = Response { connect, state, head: Head::default() };
        if state.is_cancelled() {
          return Err(NetError { kind: Kind::Offline, detail: "cancelled".into() });
        }
        // Redirects are followed by the caller, which refuses anything but HTTPS and logs only each hop's host.
        let disable = WINHTTP_DISABLE_REDIRECTS.to_le_bytes();
        let _ = WinHttpSetOption(Some(request as *const _), WINHTTP_OPTION_DISABLE_FEATURE, Some(&disable));
        if let Some(from) = range {
          let header: Vec<u16> = format!("Range: bytes={from}-").encode_utf16().collect();
          WinHttpAddRequestHeaders(request, &header, WINHTTP_ADDREQ_FLAG_ADD).map_err(|_| last("the Range header"))?;
        }
        WinHttpSendRequest(request, None, None, 0, 0, 0).map_err(|_| last("sending"))?;
        WinHttpReceiveResponse(request, std::ptr::null_mut()).map_err(|_| last("waiting for the answer"))?;
        let mut response = response;
        response.head = Head {
          status: header(request, WINHTTP_QUERY_STATUS_CODE).and_then(|s| s.trim().parse().ok()).unwrap_or(0),
          location: header(request, WINHTTP_QUERY_LOCATION),
          content_type: header(request, WINHTTP_QUERY_CONTENT_TYPE),
          content_length: header(request, WINHTTP_QUERY_CONTENT_LENGTH).and_then(|s| s.trim().parse().ok()),
          content_range: header(request, WINHTTP_QUERY_CONTENT_RANGE),
          retry_after: header(request, WINHTTP_QUERY_RETRY_AFTER),
        };
        Ok(response)
      }
    }
  }

  impl Drop for Session {
    fn drop(&mut self) {
      close(self.0 as isize);
    }
  }

  /// A header as text, or `None` if the response has none.
  unsafe fn header(request: *mut core::ffi::c_void, level: u32) -> Option<String> {
    let mut len = 0u32;
    let mut index = 0u32;
    let _ = unsafe { WinHttpQueryHeaders(request, level, PCWSTR::null(), None, &mut len, &mut index) };
    if len == 0 {
      return None;
    }
    let mut buffer = vec![0u16; len as usize / 2 + 1];
    let mut index = 0u32;
    unsafe {
      WinHttpQueryHeaders(request, level, PCWSTR::null(), Some(buffer.as_mut_ptr() as *mut _), &mut len, &mut index)
    }
    .ok()?;
    Some(String::from_utf16_lossy(&buffer[..len as usize / 2]))
  }

  /// An answer whose body can be read. The request handle lives in `state`, so cancel can close it from another
  /// thread; whoever swaps it out closes it.
  pub struct Response<'a> {
    connect: *mut core::ffi::c_void,
    state: &'a Downloading,
    pub head: Head,
  }

  impl Read for Response<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
      let request = self.state.request.load(Ordering::SeqCst);
      if request == 0 {
        return Err(std::io::Error::from_raw_os_error(12017)); // ERROR_WINHTTP_OPERATION_CANCELLED
      }
      let failed = |e: windows::core::Error| std::io::Error::from_raw_os_error(code_of(e.code().0 as u32) as i32);
      // A synchronous WinHttpReadData waits until the whole buffer is full, so progress would move a megabyte at a
      // time and a cancel would lose what had arrived. Ask what has arrived (waiting for some), and read only that.
      let mut available = 0u32;
      // SAFETY: the out pointer is valid; a handle closed by cancel makes the call fail, not crash.
      unsafe { WinHttpQueryDataAvailable(request as *mut _, &mut available) }.map_err(failed)?;
      if available == 0 {
        return Ok(0); // the end of the body
      }
      let wanted = buffer.len().min(available as usize) as u32;
      let mut read = 0u32;
      // SAFETY: the buffer is valid for `wanted` bytes; a handle closed by cancel makes the call fail, not crash.
      unsafe { WinHttpReadData(request as *mut _, buffer.as_mut_ptr() as *mut _, wanted, &mut read) }.map_err(failed)?;
      Ok(read as usize)
    }
  }

  impl Drop for Response<'_> {
    fn drop(&mut self) {
      let request = self.state.request.swap(0, Ordering::SeqCst);
      if request != 0 {
        close(request);
      }
      close(self.connect as isize);
    }
  }
}

#[cfg(not(windows))]
mod http {
  use super::{Downloading, Head, Kind, NetError};
  use std::path::Path;

  pub fn classify_io(e: &std::io::Error) -> NetError {
    NetError { kind: Kind::Offline, detail: e.to_string() }
  }

  pub fn close(_handle: isize) {}

  pub fn free_bytes(_path: &Path) -> Option<u64> {
    None
  }

  pub struct Session;

  impl Session {
    pub fn open(_user_agent: &str) -> Result<Session, super::DownloadError> {
      Err(super::DownloadError::new(Kind::Offline, "downloading needs Windows"))
    }

    pub fn get<'a>(&self, _url: &tauri::Url, _range: Option<u64>, _state: &'a Downloading) -> Result<Response<'a>, NetError> {
      Err(NetError { kind: Kind::Offline, detail: "downloading needs Windows".into() })
    }
  }

  pub struct Response<'a> {
    pub head: Head,
    _state: std::marker::PhantomData<&'a ()>,
  }

  impl std::io::Read for Response<'_> {
    fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
      Ok(0)
    }
  }
}
