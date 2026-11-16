//! The downloader against a small HTTP server on 127.0.0.1 (no real downloads in tests). Plain HTTP to the loopback
//! address is allowed here only through `Options::allow_loopback_http`, as a debug build's test list allows it.

use super::download::*;
use super::pack::tests::{SPEAKERS, TempDir, WORDS, hash, install, model, test_def};
use super::pack::{self, PackDef, PackState, Role, Unusable};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// A request the server saw.
#[derive(Debug, Clone)]
struct Seen {
  path: String,
  range: Option<u64>,
  user_agent: Option<String>,
}

enum Length {
  Body,
  Value(u64),
  Omit,
}

/// What the server answers.
struct Reply {
  status: u16,
  headers: Vec<(&'static str, String)>,
  body: Vec<u8>,
  length: Length,
  /// Send this many bytes of the body, then close the connection.
  cut_after: Option<usize>,
  /// Send this many bytes of the body, then wait without closing.
  stall_after: Option<usize>,
  /// Send the body in pieces of this many bytes, 300 ms apart.
  drip: Option<usize>,
}

impl Reply {
  fn status(status: u16) -> Self {
    Reply {
      status,
      headers: vec![],
      body: b"no".to_vec(),
      length: Length::Body,
      cut_after: None,
      stall_after: None,
      drip: None,
    }
  }

  fn file(body: &[u8]) -> Self {
    Reply { body: body.to_vec(), headers: vec![("Content-Type", "application/octet-stream".into())], ..Self::status(200) }
  }

  /// The file, honouring a Range request as Hugging Face's delivery host does.
  fn ranged(body: &[u8], seen: &Seen) -> Self {
    match seen.range {
      Some(from) if (from as usize) < body.len() => Reply {
        status: 206,
        headers: vec![
          ("Content-Type", "application/octet-stream".into()),
          ("Content-Range", format!("bytes {from}-{}/{}", body.len() - 1, body.len())),
        ],
        body: body[from as usize..].to_vec(),
        ..Self::status(206)
      },
      _ => Self::file(body),
    }
  }

  fn redirect(to: &str) -> Self {
    Reply { headers: vec![("Location", to.into())], body: vec![], ..Self::status(302) }
  }
}

struct Server {
  port: u16,
  seen: Arc<Mutex<Vec<Seen>>>,
}

impl Server {
  fn start(route: impl Fn(&Seen) -> Reply + Send + Sync + 'static) -> Self {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (log, route) = (Arc::clone(&seen), Arc::new(route));
    std::thread::spawn(move || {
      for stream in listener.incoming().flatten() {
        let (log, route) = (Arc::clone(&log), Arc::clone(&route));
        std::thread::spawn(move || answer(stream, &log, route.as_ref()));
      }
    });
    Server { port, seen }
  }

  fn url(&self, path: &str) -> String {
    format!("http://127.0.0.1:{}{path}", self.port)
  }

  fn requests(&self) -> Vec<Seen> {
    self.seen.lock().unwrap().clone()
  }
}

fn answer(mut stream: TcpStream, log: &Mutex<Vec<Seen>>, route: &dyn Fn(&Seen) -> Reply) {
  let mut reader = BufReader::new(stream.try_clone().unwrap());
  let mut first = String::new();
  if reader.read_line(&mut first).is_err() {
    return;
  }
  let path = first.split_whitespace().nth(1).unwrap_or("/").to_owned();
  let (mut range, mut user_agent) = (None, None);
  loop {
    let mut line = String::new();
    if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
      break;
    }
    let (name, value) = line.split_once(':').unwrap_or((&line, ""));
    match name.trim().to_ascii_lowercase().as_str() {
      "range" => range = value.trim().strip_prefix("bytes=").and_then(|r| r.trim_end_matches('-').parse().ok()),
      "user-agent" => user_agent = Some(value.trim().to_owned()),
      _ => {}
    }
  }
  let seen = Seen { path, range, user_agent };
  log.lock().unwrap().push(seen.clone());
  let reply = route(&seen);
  let mut head = format!("HTTP/1.1 {} X\r\nConnection: close\r\n", reply.status);
  for (name, value) in &reply.headers {
    head.push_str(&format!("{name}: {value}\r\n"));
  }
  match reply.length {
    Length::Body => head.push_str(&format!("Content-Length: {}\r\n", reply.body.len())),
    Length::Value(n) => head.push_str(&format!("Content-Length: {n}\r\n")),
    Length::Omit => {}
  }
  head.push_str("\r\n");
  let _ = stream.write_all(head.as_bytes());
  if let Some(n) = reply.stall_after {
    let _ = stream.write_all(&reply.body[..n]);
    let _ = stream.flush();
    std::thread::sleep(Duration::from_secs(20));
    return;
  }
  if let Some(piece) = reply.drip {
    for chunk in reply.body.chunks(piece) {
      let _ = stream.write_all(chunk);
      let _ = stream.flush();
      std::thread::sleep(Duration::from_millis(300));
    }
    let _ = stream.shutdown(std::net::Shutdown::Both);
    return;
  }
  let body = match reply.cut_after {
    Some(n) => &reply.body[..n],
    None => &reply.body[..],
  };
  let _ = stream.write_all(body);
  let _ = stream.flush();
  let _ = stream.shutdown(std::net::Shutdown::Both);
}

/// The test pack, its files served by `server` at /words.gguf and /speakers.gguf.
fn served(server: &Server, version: &str) -> PackDef {
  let mut def = test_def(version);
  for m in &mut def.models {
    m.url = server.url(&format!("/{}", m.file));
  }
  def
}

fn plenty(_: &Path) -> Option<u64> {
  Some(u64::MAX)
}

fn run(def: &PackDef, root: &Path) -> (Result<(), DownloadError>, Vec<(u64, u64)>) {
  let state = Downloading::new(def.info().download_bytes);
  run_with(def, root, &state, &plenty)
}

fn run_with(
  def: &PackDef,
  root: &Path,
  state: &Downloading,
  free: &dyn Fn(&Path) -> Option<u64>,
) -> (Result<(), DownloadError>, Vec<(u64, u64)>) {
  let opts = Options { user_agent: "DeScribe/0.0.0-test".into(), allow_loopback_http: true, free_bytes: free };
  let mut reports = Vec::new();
  let result = download(def, root, state, &opts, &mut |r, t| reports.push((r, t)));
  (result, reports)
}

/// Serves both files properly, with Range support.
fn good_server() -> Server {
  Server::start(|seen| match seen.path.as_str() {
    "/words.gguf" => Reply::ranged(WORDS, seen),
    "/speakers.gguf" => Reply::ranged(SPEAKERS, seen),
    _ => Reply::status(404),
  })
}

fn kind(result: Result<(), DownloadError>) -> DownloadErrorKind {
  result.expect_err("the download should fail").kind
}

#[test]
fn a_whole_download_is_ready_with_its_receipt_and_progress() {
  let server = good_server();
  let root = TempDir::new("dl-whole");
  let def = served(&server, "1.0.0");
  let (result, reports) = run(&def, &root.0);
  result.unwrap();
  assert!(matches!(pack::check(&root.0, &def), PackState::Ready(_)));
  let total = def.info().download_bytes;
  assert_eq!(reports.first(), Some(&(0, total)));
  assert_eq!(reports.last(), Some(&(total, total)));
  assert!(reports.windows(2).all(|w| w[0].0 <= w[1].0), "progress only grows: {reports:?}");
  let requests = server.requests();
  assert_eq!(requests.len(), 2);
  assert!(requests.iter().all(|r| r.user_agent.as_deref() == Some("DeScribe/0.0.0-test")));
  // The receipt vouches for both files, so the status check that follows hashes nothing (S6).
  assert_eq!(pack::read_receipt(&root.0.join(&def.id)).map(|r| serde_json::to_value(r).unwrap()["files"].as_array().unwrap().len()), Some(2));
  assert!(!root.0.join(&def.id).join("words.gguf.part").exists());
}

#[test]
fn a_redirect_is_followed_and_the_file_decides() {
  let server = Server::start(|seen| match seen.path.as_str() {
    "/words.gguf" => Reply::redirect("/cdn/words.gguf?signature=secret"),
    "/cdn/words.gguf?signature=secret" => Reply::file(WORDS),
    "/speakers.gguf" => Reply::file(SPEAKERS),
    _ => Reply::status(404),
  });
  let root = TempDir::new("dl-redirect");
  let def = served(&server, "1.0.0");
  run(&def, &root.0).0.unwrap();
  assert!(matches!(pack::check(&root.0, &def), PackState::Ready(_)));
}

#[test]
fn a_redirect_to_plain_http_is_refused() {
  let server = Server::start(|_| Reply::redirect("http://example.invalid/words.gguf"));
  let root = TempDir::new("dl-to-http");
  let (result, _) = run(&served(&server, "1.0.0"), &root.0);
  let error = result.unwrap_err();
  assert_eq!(error.kind, DownloadErrorKind::Blocked);
  assert!(error.detail.contains("example.invalid"), "{}", error.detail);
}

#[test]
fn details_name_hosts_never_a_signed_url() {
  let server = Server::start(|seen| match seen.path.as_str() {
    "/words.gguf" => Reply::redirect("/cdn/words.gguf?signature=secret"),
    _ => Reply::status(403),
  });
  let root = TempDir::new("dl-detail");
  let error = run(&served(&server, "1.0.0"), &root.0).0.unwrap_err();
  assert_eq!(error.kind, DownloadErrorKind::Blocked);
  assert!(!error.detail.contains("secret"), "{}", error.detail);
  assert!(error.detail.contains("127.0.0.1 302") && error.detail.contains("HTTP 403"), "{}", error.detail);
}

#[test]
fn a_part_file_is_resumed_with_a_range() {
  let server = good_server();
  let root = TempDir::new("dl-resume");
  let def = served(&server, "1.0.0");
  let dir = root.0.join(&def.id);
  pack::claim(&dir, &def).unwrap();
  std::fs::write(dir.join("words.gguf.part"), &WORDS[..7]).unwrap();
  let (result, reports) = run(&def, &root.0);
  result.unwrap();
  assert!(matches!(pack::check(&root.0, &def), PackState::Ready(_)));
  let words = server.requests().into_iter().find(|r| r.path == "/words.gguf").unwrap();
  assert_eq!(words.range, Some(7));
  assert!(reports.iter().any(|(r, _)| *r >= 7), "progress counts the part already there");
}

#[test]
fn a_server_that_ignores_the_range_starts_the_file_again() {
  // The work laptop's network (Phase 33's D5): a Range request comes back 200 with the whole file.
  let server = Server::start(|seen| match seen.path.as_str() {
    "/words.gguf" => Reply::file(WORDS),
    _ => Reply::file(SPEAKERS),
  });
  let root = TempDir::new("dl-no-range");
  let def = served(&server, "1.0.0");
  let dir = root.0.join(&def.id);
  pack::claim(&dir, &def).unwrap();
  std::fs::write(dir.join("words.gguf.part"), &WORDS[..7]).unwrap();
  run(&def, &root.0).0.unwrap();
  assert!(matches!(pack::check(&root.0, &def), PackState::Ready(_)));
}

#[test]
fn a_partial_answer_that_does_not_fit_is_refused_and_the_part_dropped() {
  let server = Server::start(|seen| Reply {
    status: 206,
    headers: vec![("Content-Range", format!("bytes 0-{}/{}", WORDS.len() - 1, WORDS.len()))],
    body: WORDS.to_vec(),
    ..Reply::ranged(WORDS, seen)
  });
  let root = TempDir::new("dl-bad-range");
  let def = served(&server, "1.0.0");
  let dir = root.0.join(&def.id);
  pack::claim(&dir, &def).unwrap();
  std::fs::write(dir.join("words.gguf.part"), &WORDS[..7]).unwrap();
  assert_eq!(kind(run(&def, &root.0).0), DownloadErrorKind::Blocked);
  assert!(!dir.join("words.gguf.part").exists());
}

#[test]
fn the_wrong_size_on_offer_is_refused() {
  let server = Server::start(|_| Reply { length: Length::Value(3), body: b"abc".to_vec(), ..Reply::file(b"") });
  let root = TempDir::new("dl-size");
  assert_eq!(kind(run(&served(&server, "1.0.0"), &root.0).0), DownloadErrorKind::Blocked);
}

#[test]
fn a_body_longer_than_listed_is_refused() {
  let long = [WORDS, b" and more"].concat();
  let server = Server::start(move |_| Reply { length: Length::Omit, ..Reply::file(&long) });
  let root = TempDir::new("dl-long");
  let def = served(&server, "1.0.0");
  assert_eq!(kind(run(&def, &root.0).0), DownloadErrorKind::Blocked);
  assert!(!root.0.join(&def.id).join("words.gguf.part").exists());
}

#[test]
fn a_wrong_hash_is_deleted_and_never_named() {
  let mut altered = WORDS.to_vec();
  altered[0] ^= 1;
  let server = Server::start(move |_| Reply::file(&altered));
  let root = TempDir::new("dl-hash");
  let def = served(&server, "1.0.0");
  let error = run(&def, &root.0).0.unwrap_err();
  assert_eq!(error.kind, DownloadErrorKind::Mismatch);
  let dir = root.0.join(&def.id);
  assert!(!dir.join("words.gguf").exists() && !dir.join("words.gguf.part").exists());
  assert_eq!(pack::check(&root.0, &def), PackState::Missing);
}

#[test]
fn a_web_page_where_the_file_should_be_is_blocked() {
  let page = b"<!doctype html><p>Blocked by your organisation</p>".to_vec();
  let server =
    Server::start(move |_| Reply { headers: vec![("Content-Type", "text/html; charset=utf-8".into())], ..Reply::file(&page) });
  let root = TempDir::new("dl-html");
  assert_eq!(kind(run(&served(&server, "1.0.0"), &root.0).0), DownloadErrorKind::Blocked);
}

#[test]
fn each_status_has_its_kind() {
  for (status, expected) in [
    (401, DownloadErrorKind::Blocked),
    (403, DownloadErrorKind::Blocked),
    (407, DownloadErrorKind::Blocked),
    (451, DownloadErrorKind::Blocked),
    (404, DownloadErrorKind::Gone),
    (410, DownloadErrorKind::Gone),
    (429, DownloadErrorKind::Busy),
    (503, DownloadErrorKind::Busy),
  ] {
    let server = Server::start(move |_| Reply { headers: vec![("Retry-After", "120".into())], ..Reply::status(status) });
    let root = TempDir::new("dl-status");
    let error = run(&served(&server, "1.0.0"), &root.0).0.unwrap_err();
    assert_eq!(error.kind, expected, "HTTP {status}");
    if expected == DownloadErrorKind::Busy {
      assert!(error.detail.contains("Retry-After 120"), "{}", error.detail);
    }
  }
}

#[test]
fn a_cut_connection_keeps_the_part_for_next_time() {
  let server = Server::start(|_| Reply { cut_after: Some(6), ..Reply::file(WORDS) });
  let root = TempDir::new("dl-cut");
  let def = served(&server, "1.0.0");
  assert_eq!(kind(run(&def, &root.0).0), DownloadErrorKind::Offline);
  let part = root.0.join(&def.id).join("words.gguf.part");
  assert_eq!(std::fs::read(&part).unwrap(), &WORDS[..6]);
  assert_eq!(pack::check(&root.0, &def), PackState::Missing, "a part file is never loaded");
}

#[test]
fn nothing_listening_is_offline() {
  let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port(); // closed again at once
  let mut def = test_def("1.0.0");
  for m in &mut def.models {
    m.url = format!("http://127.0.0.1:{port}/{}", m.file);
  }
  let root = TempDir::new("dl-offline");
  assert_eq!(kind(run(&def, &root.0).0), DownloadErrorKind::Offline);
}

#[test]
fn cancel_stops_a_stalled_download_at_once_and_keeps_the_part() {
  let server = Server::start(|_| Reply { stall_after: Some(5), ..Reply::file(WORDS) });
  let root = TempDir::new("dl-cancel");
  let def = served(&server, "1.0.0");
  let state = Arc::new(Downloading::new(def.info().download_bytes));
  let canceller = Arc::clone(&state);
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_millis(400));
    canceller.cancel();
  });
  let started = Instant::now();
  let (result, _) = run_with(&def, &root.0, &state, &plenty);
  assert_eq!(kind(result), DownloadErrorKind::Cancelled);
  assert!(started.elapsed() < Duration::from_secs(3), "took {:?}", started.elapsed());
  assert_eq!(std::fs::read(root.0.join(&def.id).join("words.gguf.part")).unwrap(), &WORDS[..5]);
}

#[test]
fn not_enough_disk_space_asks_nothing_of_the_network() {
  let server = good_server();
  let root = TempDir::new("dl-disk");
  let def = served(&server, "1.0.0");
  let state = Downloading::new(def.info().download_bytes);
  let (result, _) = run_with(&def, &root.0, &state, &|_| Some(10));
  let error = result.unwrap_err();
  assert_eq!(error.kind, DownloadErrorKind::Disk);
  assert!(error.detail.contains("10 free"), "{}", error.detail);
  assert!(server.requests().is_empty());
}

#[test]
fn a_file_that_cannot_be_written_is_not_a_full_disk() {
  let server = good_server();
  let root = TempDir::new("dl-write");
  let def = served(&server, "1.0.0");
  // A folder where the `.part` should go: opening it as a file is refused, as a file held by another app would be.
  std::fs::create_dir_all(root.0.join(&def.id).join("words.gguf.part")).unwrap();
  let error = run(&def, &root.0).0.unwrap_err();
  assert_eq!(error.kind, DownloadErrorKind::Write, "{}", error.detail);
  assert!(!error.detail.contains("full"), "{}", error.detail);
  assert!(!error.detail.contains(&*root.0.to_string_lossy()), "{}", error.detail);
}

#[test]
fn only_a_full_disk_is_disk() {
  let root = Path::new("C:\\nowhere");
  let kind_of = |code: i32| io_error(root, "writing", &std::io::Error::from_raw_os_error(code)).kind;
  assert_eq!(kind_of(112), DownloadErrorKind::Disk); // ERROR_DISK_FULL
  assert_eq!(kind_of(39), DownloadErrorKind::Disk); // ERROR_HANDLE_DISK_FULL
  assert_eq!(kind_of(5), DownloadErrorKind::Write); // ERROR_ACCESS_DENIED
  assert_eq!(kind_of(32), DownloadErrorKind::Write); // ERROR_SHARING_VIOLATION
}

#[test]
fn a_verified_file_is_not_fetched_again() {
  let server = good_server();
  let root = TempDir::new("dl-skip");
  let def = served(&server, "1.0.0");
  let dir = install(&root.0, &def);
  std::fs::remove_file(dir.join("speakers.gguf")).unwrap();
  run(&def, &root.0).0.unwrap();
  let paths: Vec<String> = server.requests().into_iter().map(|r| r.path).collect();
  assert_eq!(paths, vec!["/speakers.gguf".to_string()]);
}

#[test]
fn a_damaged_file_is_replaced() {
  let server = good_server();
  let root = TempDir::new("dl-damaged");
  let def = served(&server, "1.0.0");
  let dir = install(&root.0, &def);
  std::fs::write(dir.join("words.gguf"), b"short").unwrap();
  assert_eq!(pack::check(&root.0, &def), PackState::Unusable(Unusable::Damaged));
  run(&def, &root.0).0.unwrap();
  assert!(matches!(pack::check(&root.0, &def), PackState::Ready(_)));
}

#[test]
fn an_outdated_pack_goes_once_the_new_one_is_in() {
  let server = Server::start(|seen| match seen.path.as_str() {
    "/new-words.gguf" => Reply::file(b"the new words model"),
    "/speakers.gguf" => Reply::file(SPEAKERS),
    _ => Reply::status(404),
  });
  let root = TempDir::new("dl-outdated");
  let old = test_def("0.9.0");
  install(&root.0, &old);
  assert!(matches!(pack::check(&root.0, &old), PackState::Ready(_)));
  std::fs::rename(root.0.join(&old.id), root.0.join("older-pack")).unwrap();

  let mut new = served(&server, "1.0.0");
  new.models[0] = model(Role::Words, "new-words.gguf", b"the new words model");
  new.models[0].url = server.url("/new-words.gguf");
  assert_eq!(pack::check(&root.0, &new), PackState::Unusable(Unusable::Outdated));
  run(&new, &root.0).0.unwrap();
  assert!(matches!(pack::check(&root.0, &new), PackState::Ready(_)));
  assert!(!root.0.join("older-pack").exists(), "the old files went once the new ones were in");
}

#[test]
fn a_failed_download_leaves_the_old_pack_alone() {
  let server = Server::start(|_| Reply::status(404));
  let root = TempDir::new("dl-outdated-fail");
  let old = test_def("0.9.0");
  install(&root.0, &old);
  std::fs::rename(root.0.join(&old.id), root.0.join("older-pack")).unwrap();
  let mut new = served(&server, "1.0.0");
  new.id = "newer-pack".into();
  assert_eq!(kind(run(&new, &root.0).0), DownloadErrorKind::Gone);
  assert!(root.0.join("older-pack").join("words.gguf").exists());
}

#[test]
fn an_unpinned_url_is_never_requested() {
  let server = good_server();
  let root = TempDir::new("dl-unpinned");
  let def = served(&server, "1.0.0");
  let state = Downloading::new(def.info().download_bytes);
  let opts = Options { user_agent: "x".into(), allow_loopback_http: false, free_bytes: &plenty };
  let error = download(&def, &root.0, &state, &opts, &mut |_, _| {}).unwrap_err();
  assert_eq!(error.kind, DownloadErrorKind::Gone);
  assert!(server.requests().is_empty());
}

#[test]
fn the_hash_helper_agrees_with_the_pack() {
  assert_eq!(hash(WORDS), test_def("1.0.0").models[0].sha256);
}

#[test]
fn progress_moves_as_bytes_arrive_not_a_buffer_at_a_time() {
  let server = Server::start(|seen| match seen.path.as_str() {
    "/words.gguf" => Reply { drip: Some(5), ..Reply::file(WORDS) },
    _ => Reply::file(SPEAKERS),
  });
  let root = TempDir::new("dl-drip");
  let def = served(&server, "1.0.0");
  let (result, reports) = run(&def, &root.0);
  result.unwrap();
  let words = WORDS.len() as u64;
  let between: Vec<u64> = reports.iter().map(|(r, _)| *r).filter(|r| *r > 0 && *r < words).collect();
  assert!(between.len() >= 2, "progress inside the first file: {reports:?}");
}
