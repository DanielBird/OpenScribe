//! Whether this processor can run the engine. It is built for AVX2, FMA and F16C with no fallback (Phase 33, M1), so
//! on a processor without AVX2 it would stop on its first instruction: the app checks before starting it.

/// A debug build can pretend the processor lacks AVX2 (`DESCRIBE_STT_PRETEND_NO_AVX2=1`), to show that message.
pub fn can_run_engine() -> bool {
  if cfg!(debug_assertions) && std::env::var_os("DESCRIBE_STT_PRETEND_NO_AVX2").is_some_and(|v| v == "1") {
    return false;
  }
  has_avx2()
}

#[cfg(windows)]
fn has_avx2() -> bool {
  use windows::Win32::System::Threading::{IsProcessorFeaturePresent, PF_AVX2_INSTRUCTIONS_AVAILABLE};
  // SAFETY: a plain query.
  unsafe { IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE).as_bool() }
}

#[cfg(not(windows))]
fn has_avx2() -> bool {
  false
}
