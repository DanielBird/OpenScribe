mod close_guard;
mod splash;
pub mod stt;

use splash::Splash;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse, WebviewWindowBuilder};
use tauri::{Manager, Runtime, WebviewWindow, WindowEvent};

/// How long the splash may stay up if the page never reports that it has loaded.
const REVEAL_TIMEOUT: Duration = Duration::from_secs(15);

/// The handover from the splash to the main window, which stays hidden until the page has loaded (DECISIONS.md T20).
struct Launch {
  splash: Option<Splash>,
  shown: AtomicBool,
}

impl Launch {
  /// Shows the main window the first time only (F5 loads the page again), then closes the splash.
  fn reveal<R: Runtime>(&self, window: &WebviewWindow<R>) {
    if !self.shown.swap(true, Ordering::SeqCst) {
      let _ = window.show();
    }
    self.close_splash();
  }

  fn close_splash(&self) {
    if let Some(splash) = &self.splash {
      splash.close();
    }
  }
}

/// The installed (MSIX) app's own data folder, `%LOCALAPPDATA%\Packages\<family name>\LocalState`, which uninstalling
/// removes. `None` without package identity (`tauri dev`, the bare exe): the web view then keeps Tauri's default,
/// `%LOCALAPPDATA%\<identifier>`. WebView2's processes run outside the package, so they would write there too.
#[cfg(windows)]
fn package_data_dir() -> Option<PathBuf> {
  let folder = windows::Storage::ApplicationData::Current().ok()?.LocalFolder().ok()?;
  Some(PathBuf::from(folder.Path().ok()?.to_os_string()))
}

#[cfg(not(windows))]
fn package_data_dir() -> Option<PathBuf> {
  None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let launch = Arc::new(Launch { splash: Splash::show(), shown: AtomicBool::new(false) });
  let stt = Arc::new(stt::Stt::default());
  let dropped = Arc::clone(&stt);
  tauri::Builder::default()
    .manage(stt)
    .invoke_handler(tauri::generate_handler![
      stt::commands::stt_choose_recording,
      stt::commands::stt_status,
      stt::commands::stt_devices,
      stt::commands::stt_start,
      stt::commands::stt_cancel,
      stt::commands::set_close_guard,
      stt::commands::stt_download,
      stt::commands::stt_download_cancel,
      stt::commands::stt_remove_models,
    ])
    .on_window_event(move |window, event| {
      let Some(webview) = window.app_handle().get_webview_window(window.label()) else { return };
      match event {
        WindowEvent::DragDrop(drop) => stt::commands::on_drag_drop(&webview, &dropped, drop),
        // Closing while DeScribe works asks first (close_guard.rs): a run, a download, or work the page reports. The
        // worker dies with the app either way (its job object, or its pipe to the app closing: stt/worker.rs), and a
        // download's .part file is kept for the next attempt.
        WindowEvent::CloseRequested { api, .. } => {
          if close_guard::CLOSE_GUARD.should_hold(&webview, dropped.is_busy()) {
            api.prevent_close();
          }
        }
        _ => {}
      }
    })
    .setup(move |app| {
      // Partial downloads this build won't finish (DECISIONS.md D54), off the main thread.
      std::thread::spawn(|| {
        if let Some(root) = stt::pack::root() {
          stt::pack::clean_stale_parts(&root, stt::pack::definition());
        }
      });
      // The window is made here from tauri.conf.json (where `create` is false) so it can handle new-window requests:
      // a link with target="_blank" opens in the default browser, where WebView2 would otherwise open nothing.
      let config = app
        .config()
        .app
        .windows
        .first()
        .ok_or("tauri.conf.json defines no window")?
        .clone();
      let mut window = WebviewWindowBuilder::from_config(app.handle(), &config)?;
      if let Some(dir) = package_data_dir() {
        window = window.data_directory(dir);
      }
      // Started before build(), which waits for WebView2: a hang there mustn't leave the splash up for good.
      let (handle, label, overdue) = (app.handle().clone(), config.label.clone(), Arc::clone(&launch));
      let reloaded = Arc::clone(app.state::<Arc<stt::Stt>>().inner());
      std::thread::spawn(move || {
        std::thread::sleep(REVEAL_TIMEOUT);
        match handle.get_webview_window(&label) {
          Some(window) => overdue.reveal(&window),
          None => overdue.close_splash(),
        }
      });
      let window = window
        .on_page_load(move |window, payload| match payload.event() {
          PageLoadEvent::Finished => launch.reveal(&window),
          // F5 or a navigation: the page that held the close guard, and owned any local run or download, is gone.
          PageLoadEvent::Started => {
            close_guard::CLOSE_GUARD.set(false);
            reloaded.cancel_any_run();
            reloaded.cancel_any_download();
          }
        })
        // The user chose the folder in Windows' own picker, so the app grants access to it itself: WebView2's prompts
        // would name http://tauri.localhost and ask twice. Every other permission keeps WebView2's default.
        .on_permission_request(|_webview, kind| match kind {
          PermissionKind::FileSystemAccess => PermissionResponse::Allow,
          _ => PermissionResponse::Default,
        })
        .on_new_window(|url, _features| {
          if matches!(url.scheme(), "http" | "https") {
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
          }
          NewWindowResponse::Deny
        })
        .build()?;
      let _ = window;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
