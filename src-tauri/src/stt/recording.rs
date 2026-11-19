//! The recording: chosen in Rust, handed to the page as a real `File` (DECISIONS.md D53).
//!
//! The engine needs the recording's path, and the page's `File` has none. So in the desktop app Rust chooses the
//! file, with Windows' own Open dialog or a native drop on the window (`dragDropEnabled: true`). It keeps the path
//! under a token and gives the page the file through WebView2: a read-only `FileSystemFileHandle`
//! (`CreateWebFileSystemFileHandle`) posted with `PostWebMessageAsJsonWithAdditionalObjects`. The page calls
//! `getFile()` on it and has a disk-backed `File` for playback, the duration probe and an ElevenLabs upload, as before.
//! `stt_start` then takes the token, so the page never names a path.
//!
//! WebView2 can refuse the handover (a runtime too old for these calls, or a file it won't open). The Open dialog's
//! command then fails; a drop is reported with a plain message, which every WebView2 runtime can post.
//!
//! (The other way round, the page posting its File to Rust, doesn't work here: wry's message handler runs first and
//! fails on every message that isn't a string, which stops WebView2 calling any later handler. Phase 34, step 2.)

use serde_json::json;
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime};

/// What the page's messages are tagged with.
pub const RECORDING_KIND: &str = "describe.recording";
pub const DRAG_KIND: &str = "describe.drag";
pub const DROP_FAILED_KIND: &str = "describe.drop-failed";
/// How long a chosen recording stays usable by its token.
const KEEP_FOR: Duration = Duration::from_secs(24 * 60 * 60);
/// At most this many recordings are remembered; older ones are dropped.
const MAX_KEPT: usize = 8;

/// The extensions the Open dialog lists first, as `domain/filecheck.ts` `KNOWN_MEDIA_EXTENSIONS` (plus `amr`, which
/// Media Foundation reads). Keep the two in step.
pub const MEDIA_EXTENSIONS: &[&str] =
  &["mp3", "m4a", "wav", "aac", "flac", "ogg", "opus", "webm", "mp4", "mov", "mkv", "wma", "aiff", "amr"];

struct Entry {
  token: String,
  path: PathBuf,
  at: Instant,
}

/// The recordings chosen in this session, by token.
#[derive(Default)]
pub struct Recordings {
  entries: Mutex<Vec<Entry>>,
}

impl Recordings {
  /// Remembers `path` and returns its new token.
  pub fn add(&self, path: PathBuf) -> String {
    let token = new_token();
    let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    entries.retain(|e| now.duration_since(e.at) < KEEP_FOR);
    entries.push(Entry { token: token.clone(), path, at: now });
    let excess = entries.len().saturating_sub(MAX_KEPT);
    entries.drain(..excess);
    token
  }

  /// The path chosen under `token`. A recording can be transcribed again (Try again), so it isn't removed.
  pub fn path(&self, token: &str) -> Option<PathBuf> {
    let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    entries.iter().find(|e| e.token == token && now.duration_since(e.at) < KEEP_FOR).map(|e| e.path.clone())
  }
}

/// 32 hex digits. Not a secret (every script in the page is the app's), only a name for a path the page can't see.
fn new_token() -> String {
  static COUNTER: AtomicU64 = AtomicU64::new(0);
  let n = COUNTER.fetch_add(1, Ordering::Relaxed);
  let t = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
  let state = RandomState::new();
  format!("{:016x}{:016x}", state.hash_one((n, t, 1u8)), state.hash_one((n, t, 2u8)))
}

/// A token as `new_token` makes it.
pub fn is_token(token: &str) -> bool {
  token.len() == 32 && token.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A path the dialog or a drop gave: an existing file, or nothing.
pub fn usable(path: &Path) -> Option<PathBuf> {
  (path.is_absolute() && path.is_file()).then(|| path.to_path_buf())
}

/// The message posted with a chosen recording. `at` is where it was dropped, in CSS pixels, or `None` for the dialog.
pub fn recording_message(token: &str, at: Option<(f64, f64)>) -> String {
  match at {
    Some((x, y)) => json!({ "kind": RECORDING_KIND, "token": token, "via": "drop", "x": x, "y": y }),
    None => json!({ "kind": RECORDING_KIND, "token": token, "via": "dialog" }),
  }
  .to_string()
}

/// The message posted while a file is dragged over the window, and when it leaves.
pub fn drag_message(over: bool) -> String {
  json!({ "kind": DRAG_KIND, "over": over }).to_string()
}

/// The message posted when a dropped file couldn't be handed to the page: where it was dropped, and why.
pub fn drop_failed_message((x, y): (f64, f64), detail: &str) -> String {
  json!({ "kind": DROP_FAILED_KIND, "x": x, "y": y, "detail": detail }).to_string()
}

/// Whether WebView2 took a file `native::post_file` posted: the error's detail if not. The receiver disconnects
/// without a value if the closure never ran (the web view was gone).
pub type Posted = std::sync::mpsc::Receiver<Result<(), String>>;

/// A debug build can name the file the dialog would return (`DESCRIBE_STT_PICK`), so CDP can drive Choose file.
pub fn picked_for_tests() -> Option<PathBuf> {
  if !cfg!(debug_assertions) {
    return None;
  }
  std::env::var_os("DESCRIBE_STT_PICK").map(PathBuf::from)
}

#[cfg(windows)]
pub mod native {
  //! Windows' Open dialog, and WebView2's file handles.
  use super::{MEDIA_EXTENSIONS, Posted};
  use crate::stt::error::without_path;
  use std::path::{Path, PathBuf};
  use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_FILE_SYSTEM_HANDLE_PERMISSION_READ_ONLY, ICoreWebView2_23, ICoreWebView2Environment14,
    ICoreWebView2ObjectCollection, ICoreWebView2ObjectCollectionView,
  };
  use windows::Win32::Foundation::HWND;
  use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
  };
  use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
  use windows::Win32::UI::Shell::{FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FileOpenDialog, IFileOpenDialog, SIGDN_FILESYSPATH};
  use windows::core::{HSTRING, IUnknown, Interface, PCWSTR};

  /// Shows Windows' Open dialog, owned by `owner` (as a raw HWND, so it can cross threads), on a thread of its own
  /// with a single-threaded apartment. `None` if the user cancels.
  pub fn choose(owner: isize) -> windows::core::Result<Option<PathBuf>> {
    std::thread::spawn(move || {
      // SAFETY: COM is initialised for this thread only, and everything it creates is dropped before uninitialising.
      unsafe {
        let initialised = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = show(HWND(owner as *mut core::ffi::c_void));
        if initialised {
          CoUninitialize();
        }
        result
      }
    })
    .join()
    .unwrap_or(Ok(None))
  }

  unsafe fn show(owner: HWND) -> windows::core::Result<Option<PathBuf>> {
    let media = MEDIA_EXTENSIONS.iter().map(|e| format!("*.{e}")).collect::<Vec<_>>().join(";");
    let (media_name, media_spec) = (HSTRING::from("Audio and video files"), HSTRING::from(media));
    let (all_name, all_spec) = (HSTRING::from("All files"), HSTRING::from("*.*"));
    let filters = [
      COMDLG_FILTERSPEC { pszName: PCWSTR(media_name.as_ptr()), pszSpec: PCWSTR(media_spec.as_ptr()) },
      COMDLG_FILTERSPEC { pszName: PCWSTR(all_name.as_ptr()), pszSpec: PCWSTR(all_spec.as_ptr()) },
    ];
    // SAFETY: plain COM calls; the strings outlive the dialog.
    unsafe {
      let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
      dialog.SetFileTypes(&filters)?;
      dialog.SetOptions(dialog.GetOptions()? | FOS_FILEMUSTEXIST | FOS_FORCEFILESYSTEM)?;
      if dialog.Show(Some(owner)).is_err() {
        return Ok(None); // cancelled (or the dialog couldn't open, which Show reports the same way)
      }
      let name = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
      let path = name.to_string().ok().map(PathBuf::from);
      CoTaskMemFree(Some(name.0 as *const core::ffi::c_void));
      Ok(path)
    }
  }

  /// Posts `json` to the page with a read-only handle to `path`, on the main thread (`with_webview`). That runs later
  /// unless this is the main thread, and its result comes back on the receiver, with the path left out of the detail.
  pub fn post_file<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    json: String,
    path: &Path,
  ) -> tauri::Result<Posted> {
    let (done, posted_rx) = std::sync::mpsc::sync_channel(1);
    let recording = path.to_path_buf();
    let path = HSTRING::from(path.as_os_str());
    window.with_webview(move |platform| {
      // SAFETY: the environment and the web view live as long as the window; the handle and collection are COM
      // objects WebView2 makes and keeps.
      let posted = unsafe {
        (|| -> windows::core::Result<()> {
          let environment = platform.environment().cast::<ICoreWebView2Environment14>()?;
          let handle = environment
            .CreateWebFileSystemFileHandle(&path, COREWEBVIEW2_FILE_SYSTEM_HANDLE_PERMISSION_READ_ONLY)?;
          let mut items = [Some(handle.cast::<IUnknown>()?)];
          let mut collection: Option<ICoreWebView2ObjectCollection> = None;
          environment.CreateObjectCollection(1, items.as_mut_ptr(), &mut collection)?;
          let collection = collection.ok_or_else(windows::core::Error::empty)?;
          let core = platform.controller().CoreWebView2()?.cast::<ICoreWebView2_23>()?;
          core.PostWebMessageAsJsonWithAdditionalObjects(
            &HSTRING::from(json),
            &collection.cast::<ICoreWebView2ObjectCollectionView>()?,
          )
        })()
      };
      let _ = done.send(posted.map_err(|error| without_path(&error.to_string(), &recording, "<recording>")));
    })?;
    Ok(posted_rx)
  }

  /// Posts `json` to the page with nothing attached.
  pub fn post<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, json: String) -> tauri::Result<()> {
    window.with_webview(move |platform| {
      // SAFETY: as in post_file.
      let posted = unsafe {
        platform.controller().CoreWebView2().and_then(|core| core.PostWebMessageAsJson(&HSTRING::from(json)))
      };
      if let Err(error) = posted {
        eprintln!("DeScribe: couldn't post to the page: {error}");
      }
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn tokens_are_new_and_well_formed() {
    let (a, b) = (new_token(), new_token());
    assert!(is_token(&a) && is_token(&b));
    assert_ne!(a, b);
    assert!(!is_token("../../etc/passwd"));
    assert!(!is_token(&a[..31]));
  }

  #[test]
  fn a_recording_stays_usable_for_another_run() {
    let recordings = Recordings::default();
    let token = recordings.add(PathBuf::from(r"C:\a.wav"));
    assert_eq!(recordings.path(&token), Some(PathBuf::from(r"C:\a.wav")));
    assert_eq!(recordings.path(&token), Some(PathBuf::from(r"C:\a.wav")));
    assert_eq!(recordings.path(&new_token()), None);
  }

  #[test]
  fn keeps_only_the_latest_few() {
    let recordings = Recordings::default();
    let tokens: Vec<String> = (0..MAX_KEPT + 2).map(|i| recordings.add(PathBuf::from(format!(r"C:\{i}.wav")))).collect();
    assert_eq!(recordings.path(&tokens[0]), None);
    assert_eq!(recordings.path(&tokens[1]), None);
    assert!(recordings.path(tokens.last().unwrap()).is_some());
  }

  #[test]
  fn accepts_only_an_existing_absolute_file() {
    let here = std::env::current_exe().unwrap();
    assert_eq!(usable(&here), Some(here.clone()));
    assert_eq!(usable(Path::new("relative.wav")), None);
    assert_eq!(usable(here.parent().unwrap()), None);
  }

  #[test]
  fn messages_say_how_the_file_came() {
    let token = "0".repeat(32);
    let dialog: serde_json::Value = serde_json::from_str(&recording_message(&token, None)).unwrap();
    assert_eq!(dialog, json!({ "kind": "describe.recording", "token": token, "via": "dialog" }));
    let drop: serde_json::Value = serde_json::from_str(&recording_message(&token, Some((10.5, 20.0)))).unwrap();
    assert_eq!(drop["via"], "drop");
    assert_eq!(drop["x"], 10.5);
    assert_eq!(serde_json::from_str::<serde_json::Value>(&drag_message(true)).unwrap()["over"], true);
    let failed: serde_json::Value = serde_json::from_str(&drop_failed_message((10.5, 20.0), "why")).unwrap();
    assert_eq!(failed, json!({ "kind": "describe.drop-failed", "x": 10.5, "y": 20.0, "detail": "why" }));
  }
}
