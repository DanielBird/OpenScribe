//! Closing the window while DeScribe is working asks first (Phase 34, Task 10). WebView2's `beforeunload` doesn't
//! stop the window closing, so the page tells Rust whether anything is running (`set_close_guard`: a transcription,
//! a translation, the pipeline), and Rust asks with a native dialog before it lets the window close. A local run counts
//! too, whatever the page says. A page load clears the page's flag, since the page that set it is gone.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Runtime, WebviewWindow};

pub struct CloseGuard {
  /// The page says something is running.
  page: AtomicBool,
  /// A dialog is up, so a second close request doesn't open another.
  asking: AtomicBool,
  /// The user said Close: the next close request goes through.
  confirmed: AtomicBool,
}

/// The app's one guard.
pub static CLOSE_GUARD: CloseGuard = CloseGuard::new();

impl CloseGuard {
  pub const fn new() -> Self {
    Self { page: AtomicBool::new(false), asking: AtomicBool::new(false), confirmed: AtomicBool::new(false) }
  }

  pub fn set(&self, active: bool) {
    self.page.store(active, Ordering::SeqCst);
  }

  pub fn page_active(&self) -> bool {
    self.page.load(Ordering::SeqCst)
  }

  /// Called for a close request. Returns true if the window should stay open (and a dialog is on its way).
  pub fn should_hold<R: Runtime>(&'static self, window: &WebviewWindow<R>, run_active: bool) -> bool {
    if self.confirmed.load(Ordering::SeqCst) || !(self.page_active() || run_active) {
      return false;
    }
    if !self.asking.swap(true, Ordering::SeqCst) {
      let window = window.clone();
      std::thread::spawn(move || {
        let close = ask(&window);
        self.asking.store(false, Ordering::SeqCst);
        if close {
          self.confirmed.store(true, Ordering::SeqCst);
          let _ = window.close();
        }
      });
    }
    true
  }
}

/// Asks whether to close anyway. A dialog that can't open counts as Keep open.
#[cfg(windows)]
fn ask<R: Runtime>(window: &WebviewWindow<R>) -> bool {
  use windows::Win32::UI::Controls::{
    TASKDIALOG_BUTTON, TASKDIALOGCONFIG, TASKDIALOGCONFIG_0, TD_WARNING_ICON, TDF_ALLOW_DIALOG_CANCELLATION,
    TDF_POSITION_RELATIVE_TO_WINDOW, TaskDialogIndirect,
  };
  use windows::core::{HSTRING, PCWSTR};
  const CLOSE: i32 = 100;
  const KEEP: i32 = 101;
  let (title, main, content) = (
    HSTRING::from("DeScribe"),
    HSTRING::from("DeScribe is still working"),
    HSTRING::from("If you close it now, the work in progress stops."),
  );
  let (close, keep) = (HSTRING::from("Close"), HSTRING::from("Keep open"));
  let buttons = [
    TASKDIALOG_BUTTON { nButtonID: KEEP, pszButtonText: PCWSTR(keep.as_ptr()) },
    TASKDIALOG_BUTTON { nButtonID: CLOSE, pszButtonText: PCWSTR(close.as_ptr()) },
  ];
  let owner = window.hwnd().ok();
  let config = TASKDIALOGCONFIG {
    cbSize: size_of::<TASKDIALOGCONFIG>() as u32,
    hwndParent: owner.unwrap_or_default(),
    dwFlags: TDF_ALLOW_DIALOG_CANCELLATION | TDF_POSITION_RELATIVE_TO_WINDOW,
    pszWindowTitle: PCWSTR(title.as_ptr()),
    Anonymous1: TASKDIALOGCONFIG_0 { pszMainIcon: TD_WARNING_ICON },
    pszMainInstruction: PCWSTR(main.as_ptr()),
    pszContent: PCWSTR(content.as_ptr()),
    cButtons: buttons.len() as u32,
    pButtons: buttons.as_ptr(),
    nDefaultButton: KEEP,
    ..Default::default()
  };
  let mut pressed = 0i32;
  // SAFETY: the strings and buttons outlive the modal call.
  let shown = unsafe { TaskDialogIndirect(&config, Some(&mut pressed), None, None) };
  shown.is_ok() && pressed == CLOSE
}

#[cfg(not(windows))]
fn ask<R: Runtime>(_window: &WebviewWindow<R>) -> bool {
  true
}
