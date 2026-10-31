use std::path::PathBuf;
use tauri::webview::{NewWindowResponse, PermissionKind, PermissionResponse, WebviewWindowBuilder};

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
  tauri::Builder::default()
    .setup(|app| {
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
      window
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
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
