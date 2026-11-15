//! hf-fetch: the model download prototype (Phase 33, Task 6: D6, D8, D9). Not app code.
//!
//!   hf-fetch URL --out FILE [--stack winhttp|reqwest] [--bytes N] [--sha256 HEX] [--report PATH]
//!            [--user-agent UA] [--fail-at-bytes N] [--timeout-sec S]
//!
//! - Follows redirects itself, over HTTPS only, and logs each hop's status and host: Hugging Face's `resolve` URL
//!   answers with a redirect to a delivery host that changes over time, so the app trusts the file's hash, not a
//!   host list.
//! - Writes to FILE.part and resumes it with a Range request; a 200 to a ranged request starts over.
//! - Checks the Content-Type (a filter's block page can come with status 200), the size and the SHA-256, and only
//!   then renames FILE.part to FILE. A mismatch deletes the file.
//! - Reports a failure as one kind the app could tell apart: offline, dns, cannot-connect, timeout,
//!   connection-dropped, tls, blocked (403/451), not-found, rate-limited (429, with Retry-After), http-NNN,
//!   not-the-file (HTML or a wrong size), disk-full, hash-mismatch.
//! - `--fail-at-bytes` stops writing after N bytes with the disk-full kind, to simulate a full disk.
//! - `--test-local` also allows plain http://127.0.0.1:PORT/, for the failure tests' local server (test-server.mjs).
//! - WinHTTP (`--stack winhttp`, the default) is Windows' own HTTP client: it uses Windows' certificate store, so a
//!   company's inspecting certificate is trusted as it is by Edge and curl.exe, and WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY
//!   uses the system's proxy settings, PAC and WPAD included. reqwest (`--features reqwest`) uses native-tls (Schannel,
//!   the same store) and reads the proxy from the registry and environment, without PAC.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

const DEFAULT_UA: &str = "DeScribe-spike/0.1";

#[derive(Debug, Clone)]
struct Failure {
    kind: String,
    detail: String,
    retry_after: Option<String>,
}

fn fail(kind: &str, detail: impl Into<String>) -> Failure {
    Failure { kind: kind.into(), detail: detail.into(), retry_after: None }
}

struct Head {
    status: u16,
    location: Option<String>,
    content_type: Option<String>,
    content_length: Option<u64>,
    retry_after: Option<String>,
}

trait Stack {
    fn name(&self) -> &'static str;
    fn get(&mut self, url: &str, range_from: Option<u64>) -> Result<(Head, Box<dyn Read>), Failure>;
}

struct Options {
    url: String,
    out: PathBuf,
    stack: String,
    bytes: Option<u64>,
    sha256: Option<String>,
    report: Option<PathBuf>,
    user_agent: String,
    fail_at: Option<u64>,
    timeout_sec: u32,
    test_local: bool,
}

fn parse() -> Result<Options, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut o = Options {
        url: String::new(),
        out: PathBuf::new(),
        stack: "winhttp".into(),
        bytes: None,
        sha256: None,
        report: None,
        user_agent: DEFAULT_UA.into(),
        fail_at: None,
        timeout_sec: 60,
        test_local: false,
    };
    let mut i = 0;
    while i < args.len() {
        let a = args[i].clone();
        let mut value = || {
            i += 1;
            args.get(i).cloned().ok_or(format!("{a} needs a value"))
        };
        match a.as_str() {
            "--out" => o.out = value()?.into(),
            "--stack" => o.stack = value()?,
            "--bytes" => o.bytes = Some(value()?.parse().map_err(|_| "bad --bytes")?),
            "--sha256" => o.sha256 = Some(value()?.to_lowercase()),
            "--report" => o.report = Some(value()?.into()),
            "--user-agent" => o.user_agent = value()?,
            "--fail-at-bytes" => o.fail_at = Some(value()?.parse().map_err(|_| "bad --fail-at-bytes")?),
            "--timeout-sec" => o.timeout_sec = value()?.parse().map_err(|_| "bad --timeout-sec")?,
            "--test-local" => o.test_local = true,
            s if s.starts_with("--") => return Err(format!("unknown option {s}")),
            _ => o.url = a,
        }
        i += 1;
    }
    if o.url.is_empty() || o.out.as_os_str().is_empty() {
        return Err("usage: hf-fetch URL --out FILE [--stack winhttp|reqwest] [--bytes N] [--sha256 HEX]".into());
    }
    Ok(o)
}

fn host_of(url: &str) -> String {
    url.split("://").nth(1).and_then(|r| r.split('/').next()).unwrap_or("").to_string()
}

fn resolve(base: &str, location: &str) -> String {
    if location.contains("://") {
        return location.to_string();
    }
    let origin = base.splitn(4, '/').take(3).collect::<Vec<_>>().join("/");
    if location.starts_with('/') { format!("{origin}{location}") } else { format!("{origin}/{location}") }
}

fn main() -> ExitCode {
    let o = match parse() {
        Ok(o) => o,
        Err(e) => {
            eprintln!("hf-fetch: {e}");
            return ExitCode::from(2);
        }
    };
    let mut stack: Box<dyn Stack> = match o.stack.as_str() {
        "winhttp" => match winhttp::WinHttp::new(&o.user_agent, o.timeout_sec) {
            Ok(s) => Box::new(s),
            Err(f) => return finish(&o, "winhttp", json!([]), Err(f), None, 0.0, 0),
        },
        #[cfg(feature = "reqwest")]
        "reqwest" => Box::new(reqwest_stack::Reqwest::new(&o.user_agent, o.timeout_sec)),
        other => {
            eprintln!("hf-fetch: unknown stack {other} (reqwest needs --features reqwest)");
            return ExitCode::from(2);
        }
    };
    let name = stack.name();
    let started = Instant::now();
    let mut hops = Vec::new();
    let result = download(&o, stack.as_mut(), &mut hops);
    let seconds = started.elapsed().as_secs_f64();
    let (resumed_from, written) = match &result {
        Ok((r, w)) => (Some(*r), *w),
        Err(_) => (None, 0),
    };
    let outcome = result.map(|_| ());
    finish(&o, name, Value::Array(hops), outcome, resumed_from, seconds, written)
}

/// Returns (resumed from byte, bytes written in this run).
fn download(o: &Options, stack: &mut dyn Stack, hops: &mut Vec<Value>) -> Result<(u64, u64), Failure> {
    let part = PathBuf::from(format!("{}.part", o.out.display()));
    if let Some(dir) = o.out.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let range = (have > 0 && o.bytes.is_none_or(|b| have < b)).then_some(have);
    let mut url = o.url.clone();
    let (head, mut body) = loop {
        // --test-local: plain HTTP to 127.0.0.1 only, for the failure tests' local server.
        let local = o.test_local && url.starts_with("http://127.0.0.1");
        if !url.starts_with("https://") && !local {
            return Err(fail("insecure-redirect", format!("refusing to follow a non-HTTPS URL to {}", host_of(&url))));
        }
        let (head, body) = stack.get(&url, range)?;
        hops.push(json!({ "status": head.status, "host": host_of(&url) }));
        if (300..400).contains(&head.status) {
            let Some(location) = head.location.clone() else {
                return Err(fail("http-3xx", "a redirect without a Location"));
            };
            if hops.len() >= 10 {
                return Err(fail("too-many-redirects", "more than 10"));
            }
            url = resolve(&url, &location);
            continue;
        }
        break (head, body);
    };
    match head.status {
        200 | 206 => {}
        403 | 451 => return Err(fail("blocked", format!("HTTP {}", head.status))),
        404 => return Err(fail("not-found", "HTTP 404")),
        429 => {
            let mut f = fail("rate-limited", "HTTP 429");
            f.retry_after = head.retry_after.clone();
            return Err(f);
        }
        s => return Err(fail(&format!("http-{s}"), format!("HTTP {s}"))),
    }
    if head.content_type.as_deref().is_some_and(|t| t.starts_with("text/html")) {
        return Err(fail("not-the-file", format!("an HTML page ({})", head.content_type.unwrap_or_default())));
    }
    let resumed = head.status == 206 && range.is_some();
    let start = if resumed { have } else { 0 };
    if let (Some(expected), Some(len)) = (o.bytes, head.content_length) {
        if start + len != expected {
            return Err(fail("not-the-file", format!("{} bytes on offer, expected {expected}", start + len)));
        }
    }
    let mut file = if resumed {
        OpenOptions::new().append(true).open(&part)
    } else {
        File::create(&part)
    }
    .map_err(|e| fail("disk", e.to_string()))?;
    let mut buf = vec![0u8; 1 << 20];
    let mut written = 0u64;
    let started = Instant::now();
    let mut last = Instant::now();
    loop {
        let n = body.read(&mut buf).map_err(|e| classify_io(&e))?;
        if n == 0 {
            break;
        }
        if o.fail_at.is_some_and(|limit| start + written + n as u64 > limit) {
            return Err(fail("disk-full", "simulated (--fail-at-bytes); Windows reports ERROR_DISK_FULL (112)"));
        }
        file.write_all(&buf[..n]).map_err(|e| {
            if e.raw_os_error() == Some(112) { fail("disk-full", e.to_string()) } else { fail("disk", e.to_string()) }
        })?;
        written += n as u64;
        if last.elapsed().as_secs_f64() > 2.0 {
            last = Instant::now();
            let rate = written as f64 / 1e6 / started.elapsed().as_secs_f64();
            eprintln!("hf-fetch: {:.1} MB, {rate:.1} MB/s", (start + written) as f64 / 1e6);
        }
    }
    file.flush().map_err(|e| fail("disk", e.to_string()))?;
    drop(file);
    let size = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if let Some(expected) = o.bytes {
        // Short: the connection ended early (WinHTTP reports a cut connection as the end of the body). Keep the
        // .part file so the next run resumes. Long: it isn't the file.
        if size < expected {
            return Err(fail("connection-dropped", format!("the body ended at {size} of {expected} bytes; {part:?} is kept to resume")));
        }
        if size > expected {
            let _ = std::fs::remove_file(&part);
            return Err(fail("not-the-file", format!("{size} bytes, expected {expected}")));
        }
    }
    if o.out.exists() {
        let _ = std::fs::remove_file(&o.out);
    }
    std::fs::rename(&part, &o.out).map_err(|e| fail("disk", e.to_string()))?;
    Ok((start, written))
}

fn classify_io(e: &std::io::Error) -> Failure {
    // WinHTTP's errors reach Read as io::Error with the Win32 code.
    match e.raw_os_error() {
        Some(code) => winhttp::classify(code as u32, &e.to_string()),
        None => fail("connection-dropped", e.to_string()),
    }
}

fn finish(o: &Options, stack: &str, hops: Value, outcome: Result<(), Failure>, resumed_from: Option<u64>, seconds: f64, written: u64) -> ExitCode {
    let mut report = json!({
        "tool": "hf-fetch",
        "stack": stack,
        "url": o.url,
        "userAgent": o.user_agent,
        "hops": hops,
        "resumedFrom": resumed_from,
        "bytesThisRun": written,
        "seconds": seconds,
        "mbPerSec": if seconds > 0.0 { written as f64 / 1e6 / seconds } else { 0.0 },
    });
    let mut ok = outcome.is_ok();
    match outcome {
        Ok(()) => {
            let hash_started = Instant::now();
            let hash = File::open(&o.out).ok().and_then(|mut f| {
                let mut hasher = Sha256::new();
                let mut buf = vec![0u8; 1 << 20];
                loop {
                    match f.read(&mut buf) {
                        Ok(0) => break Some(format!("{:x}", hasher.finalize())),
                        Ok(n) => hasher.update(&buf[..n]),
                        Err(_) => break None,
                    }
                }
            });
            report["hashSec"] = json!(hash_started.elapsed().as_secs_f64());
            report["sha256"] = json!(hash);
            report["bytes"] = json!(std::fs::metadata(&o.out).map(|m| m.len()).ok());
            if let (Some(expected), Some(actual)) = (&o.sha256, &hash) {
                if expected != actual {
                    ok = false;
                    let _ = std::fs::remove_file(&o.out);
                    report["error"] = json!({ "kind": "hash-mismatch", "detail": format!("got {actual}") });
                }
            }
        }
        Err(f) => {
            report["error"] = json!({ "kind": f.kind, "detail": f.detail, "retryAfter": f.retry_after });
        }
    }
    report["ok"] = json!(ok);
    let text = serde_json::to_string_pretty(&report).unwrap_or_default();
    println!("{text}");
    if let Some(path) = &o.report {
        let _ = std::fs::write(path, text + "\n");
    }
    if ok { ExitCode::SUCCESS } else { ExitCode::from(1) }
}

mod winhttp {
    use super::{Failure, Head, Stack, fail};
    use std::io::Read;
    use windows::Win32::Networking::WinHttp::*;
    use windows::core::{HSTRING, PCWSTR};

    pub fn classify(code: u32, text: &str) -> Failure {
        // HRESULT_FROM_WIN32 wraps Win32 codes as 0x8007xxxx.
        let code = if code & 0xFFFF_0000 == 0x8007_0000 { code & 0xFFFF } else { code };
        let kind = match code {
            12007 => "dns",                 // ERROR_WINHTTP_NAME_NOT_RESOLVED (offline, or a blocked name)
            12029 => "cannot-connect",      // ERROR_WINHTTP_CANNOT_CONNECT
            12002 => "timeout",             // ERROR_WINHTTP_TIMEOUT
            12030 | 12152 => "connection-dropped", // CONNECTION_ERROR, INVALID_SERVER_RESPONSE
            12175 | 12045 | 12038 | 12037 | 12057 | 12169 => "tls", // SECURE_FAILURE, INVALID_CA, CN, DATE, REVOCATION
            12017 => "cancelled",           // OPERATION_CANCELLED
            _ => "network",
        };
        fail(kind, format!("WinHTTP error {code}: {text}"))
    }

    fn last(stage: &str) -> Failure {
        let e = windows::core::Error::from_thread();
        let mut f = classify(e.code().0 as u32, &e.message());
        f.detail = format!("{stage}: {}", f.detail);
        f
    }

    pub struct WinHttp {
        session: *mut core::ffi::c_void,
        ua: String,
    }

    impl WinHttp {
        pub fn new(ua: &str, timeout_sec: u32) -> Result<WinHttp, Failure> {
            let session = unsafe {
                WinHttpOpen(&HSTRING::from(ua), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, PCWSTR::null(), PCWSTR::null(), 0)
            };
            if session.is_null() {
                return Err(last("WinHttpOpen"));
            }
            let ms = (timeout_sec * 1000) as i32;
            let _ = unsafe { WinHttpSetTimeouts(session, ms, ms, ms, ms) };
            Ok(WinHttp { session, ua: ua.to_string() })
        }
    }

    struct Body {
        connect: *mut core::ffi::c_void,
        request: *mut core::ffi::c_void,
    }

    impl Read for Body {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let mut read = 0u32;
            unsafe { WinHttpReadData(self.request, buf.as_mut_ptr() as *mut _, buf.len() as u32, &mut read) }
                .map_err(|e| std::io::Error::from_raw_os_error((e.code().0 as u32 & 0xFFFF) as i32))?;
            Ok(read as usize)
        }
    }

    impl Drop for Body {
        fn drop(&mut self) {
            unsafe {
                let _ = WinHttpCloseHandle(self.request);
                let _ = WinHttpCloseHandle(self.connect);
            }
        }
    }

    unsafe fn header(request: *mut core::ffi::c_void, level: u32) -> Option<String> {
        let mut len = 0u32;
        let mut index = 0u32;
        let _ = unsafe { WinHttpQueryHeaders(request, level, PCWSTR::null(), None, &mut len, &mut index) };
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize / 2 + 1];
        let mut index = 0u32;
        unsafe { WinHttpQueryHeaders(request, level, PCWSTR::null(), Some(buf.as_mut_ptr() as *mut _), &mut len, &mut index) }
            .ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize / 2]))
    }

    impl Stack for WinHttp {
        fn name(&self) -> &'static str {
            "winhttp"
        }

        fn get(&mut self, url: &str, range_from: Option<u64>) -> Result<(Head, Box<dyn Read>), Failure> {
            let _ = &self.ua;
            // HTTPS, or plain HTTP to 127.0.0.1 (the caller allows that only with --test-local).
            let (secure, rest) = match url.strip_prefix("https://") {
                Some(rest) => (true, rest),
                None => (false, url.strip_prefix("http://127.0.0.1").map(|r| r.trim_start_matches(':')).ok_or_else(|| fail("insecure-redirect", "not HTTPS"))?),
            };
            let (authority, path) = rest.split_once('/').map(|(h, p)| (h, format!("/{p}"))).unwrap_or((rest, "/".into()));
            let (host, port) = if secure {
                (authority.to_string(), INTERNET_DEFAULT_HTTPS_PORT)
            } else {
                ("127.0.0.1".to_string(), authority.parse::<u16>().unwrap_or(80))
            };
            let connect = unsafe { WinHttpConnect(self.session, &HSTRING::from(host.as_str()), port, 0) };
            if connect.is_null() {
                return Err(last("WinHttpConnect"));
            }
            let request = unsafe {
                WinHttpOpenRequest(
                    connect,
                    &HSTRING::from("GET"),
                    &HSTRING::from(path.as_str()),
                    PCWSTR::null(),
                    PCWSTR::null(),
                    std::ptr::null(),
                    if secure { WINHTTP_FLAG_SECURE } else { WINHTTP_OPEN_REQUEST_FLAGS(0) },
                )
            };
            if request.is_null() {
                unsafe {
                    let _ = WinHttpCloseHandle(connect);
                }
                return Err(last("WinHttpOpenRequest"));
            }
            let body = Body { connect, request };
            // Redirects are followed by the caller, which logs each hop and refuses anything but HTTPS.
            let disable = WINHTTP_DISABLE_REDIRECTS.to_le_bytes();
            let _ = unsafe { WinHttpSetOption(Some(request as *const _), WINHTTP_OPTION_DISABLE_FEATURE, Some(&disable)) };
            if let Some(from) = range_from {
                let h: Vec<u16> = format!("Range: bytes={from}-").encode_utf16().collect();
                unsafe { WinHttpAddRequestHeaders(request, &h, WINHTTP_ADDREQ_FLAG_ADD) }.map_err(|_| last("Range"))?;
            }
            unsafe { WinHttpSendRequest(request, None, None, 0, 0, 0) }.map_err(|_| last("WinHttpSendRequest"))?;
            unsafe { WinHttpReceiveResponse(request, std::ptr::null_mut()) }.map_err(|_| last("WinHttpReceiveResponse"))?;
            let head = unsafe {
                Head {
                    status: header(request, WINHTTP_QUERY_STATUS_CODE).and_then(|s| s.trim().parse().ok()).unwrap_or(0),
                    location: header(request, WINHTTP_QUERY_LOCATION),
                    content_type: header(request, WINHTTP_QUERY_CONTENT_TYPE),
                    content_length: header(request, WINHTTP_QUERY_CONTENT_LENGTH).and_then(|s| s.trim().parse().ok()),
                    retry_after: header(request, WINHTTP_QUERY_RETRY_AFTER),
                }
            };
            Ok((head, Box::new(body)))
        }
    }

    impl Drop for WinHttp {
        fn drop(&mut self) {
            unsafe {
                let _ = WinHttpCloseHandle(self.session);
            }
        }
    }
}

#[cfg(feature = "reqwest")]
mod reqwest_stack {
    use super::{Failure, Head, Stack, fail};
    use std::io::Read;

    pub struct Reqwest {
        client: reqwest::blocking::Client,
    }

    impl Reqwest {
        pub fn new(ua: &str, timeout_sec: u32) -> Reqwest {
            let client = reqwest::blocking::Client::builder()
                .user_agent(ua)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(std::time::Duration::from_secs(timeout_sec as u64))
                .timeout(None)
                .build()
                .expect("reqwest client");
            Reqwest { client }
        }
    }

    fn classify(e: &reqwest::Error) -> Failure {
        let text = format!("{e:?}");
        let kind = if e.is_timeout() {
            "timeout"
        } else if text.contains("dns error") || text.contains("No such host") {
            "dns"
        } else if text.to_lowercase().contains("certificate") || text.to_lowercase().contains("tls") {
            "tls"
        } else if e.is_connect() {
            "cannot-connect"
        } else {
            "network"
        };
        fail(kind, text)
    }

    impl Stack for Reqwest {
        fn name(&self) -> &'static str {
            "reqwest"
        }

        fn get(&mut self, url: &str, range_from: Option<u64>) -> Result<(Head, Box<dyn Read>), Failure> {
            let mut request = self.client.get(url);
            if let Some(from) = range_from {
                request = request.header(reqwest::header::RANGE, format!("bytes={from}-"));
            }
            let response = request.send().map_err(|e| classify(&e))?;
            let get = |name: reqwest::header::HeaderName| {
                response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
            };
            let head = Head {
                status: response.status().as_u16(),
                location: get(reqwest::header::LOCATION),
                content_type: get(reqwest::header::CONTENT_TYPE),
                content_length: get(reqwest::header::CONTENT_LENGTH).and_then(|s| s.parse().ok()),
                retry_after: get(reqwest::header::RETRY_AFTER),
            };
            Ok((head, Box::new(response)))
        }
    }
}
