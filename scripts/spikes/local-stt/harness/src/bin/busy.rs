//! busy: keeps N logical processors fully busy, standing in for other work on the laptop (M11).
//!
//!   busy [--lps N] [--seconds S]
//!
//! Takes the N highest processors of its own affinity (under pinrun: of the profile's twelve) and runs one spinning
//! thread pinned to each, until S seconds have passed (default: until killed).

use local_stt_harness::sys;
use std::hint::black_box;
use std::time::{Duration, Instant};
use windows::Win32::System::Threading::{GetCurrentThread, SetThreadAffinityMask};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let get = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let n: usize = get("--lps").and_then(|v| v.parse().ok()).unwrap_or(2);
    let seconds: Option<f64> = get("--seconds").and_then(|v| v.parse().ok());
    let (mask, _) = sys::own_affinity();
    let mut lps = sys::mask_to_list(mask);
    lps.reverse();
    lps.truncate(n);
    eprintln!("busy: spinning on logical processors {lps:?}");
    let deadline = seconds.map(|s| Instant::now() + Duration::from_secs_f64(s));
    let threads: Vec<_> = lps
        .into_iter()
        .map(|lp| {
            std::thread::spawn(move || {
                unsafe { SetThreadAffinityMask(GetCurrentThread(), 1usize << lp) };
                let mut x = 1.000_001f64;
                loop {
                    for _ in 0..1_000_000 {
                        x = black_box(x * 1.000_000_1 + 1e-9);
                    }
                    if deadline.is_some_and(|d| Instant::now() >= d) {
                        break;
                    }
                }
                black_box(x);
            })
        })
        .collect();
    for t in threads {
        let _ = t.join();
    }
}
