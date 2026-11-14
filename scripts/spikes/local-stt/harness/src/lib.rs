//! Phase 33 spike: shared pieces of the harness binaries (`pinrun`, `stt-bench`, `busy`, `decode-probe`, `hf-fetch`).
//! Nothing here is app code. See docs/phases/33-local-stt-spike.md and docs/reference/local-stt.md.

pub mod decode;
pub mod pty;
pub mod sampler;
pub mod sys;
pub mod wav;

use std::path::{Path, PathBuf};

/// `scripts/spikes/local-stt/`, found from the executable (`harness/target/<profile>/<bin>.exe`) or the cwd.
pub fn spike_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        for dir in exe.ancestors() {
            if dir.join("models.json").is_file() && dir.join("harness").is_dir() {
                return dir.to_path_buf();
            }
        }
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for dir in cwd.ancestors() {
        let candidate = dir.join("scripts").join("spikes").join("local-stt");
        if candidate.join("models.json").is_file() {
            return candidate;
        }
        if dir.join("models.json").is_file() && dir.join("harness").is_dir() {
            return dir.to_path_buf();
        }
    }
    cwd
}

pub fn out_dir() -> PathBuf {
    let dir = spike_dir().join("out");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// The profiles file: the calibrated mask, scheme names and caps (written by pinrun topology and calibrate.ps1).
pub fn profiles_path() -> PathBuf {
    spike_dir().join("profiles.json")
}

pub fn read_json(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn now_iso() -> String {
    // Seconds since the epoch, UTC, as ISO 8601, without a date crate.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}
