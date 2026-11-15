//! Keeping Windows awake while a run is going (Phase 34, Task 4): a 40-minute transcription mustn't die because the
//! laptop went to sleep. A power request held for the run and released when it ends, however it ends. It doesn't stop
//! the user closing the lid or choosing Sleep.

#[cfg(windows)]
pub struct KeepAwake(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl KeepAwake {
  pub fn new() -> Option<Self> {
    use windows::Win32::System::Power::{PowerCreateRequest, PowerRequestSystemRequired, PowerSetRequest};
    use windows::Win32::System::Threading::{POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0};
    let mut reason: Vec<u16> = "DeScribe is transcribing a recording".encode_utf16().chain([0]).collect();
    let context = REASON_CONTEXT {
      Version: 0, // POWER_REQUEST_CONTEXT_VERSION
      Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
      Reason: REASON_CONTEXT_0 { SimpleReasonString: windows::core::PWSTR(reason.as_mut_ptr()) },
    };
    // SAFETY: the reason string outlives the call (Windows copies it); the handle is closed in Drop.
    unsafe {
      let request = PowerCreateRequest(&context).ok()?;
      let held = Self(request);
      PowerSetRequest(request, PowerRequestSystemRequired).ok()?;
      Some(held)
    }
  }
}

#[cfg(windows)]
impl Drop for KeepAwake {
  fn drop(&mut self) {
    use windows::Win32::System::Power::{PowerClearRequest, PowerRequestSystemRequired};
    // SAFETY: created in new(), released once.
    unsafe {
      let _ = PowerClearRequest(self.0, PowerRequestSystemRequired);
      let _ = windows::Win32::Foundation::CloseHandle(self.0);
    }
  }
}

#[cfg(not(windows))]
pub struct KeepAwake;

#[cfg(not(windows))]
impl KeepAwake {
  pub fn new() -> Option<Self> {
    None
  }
}

#[cfg(all(test, windows))]
mod tests {
  #[test]
  fn a_request_can_be_held_and_released() {
    let held = super::KeepAwake::new();
    assert!(held.is_some());
    drop(held);
  }
}
