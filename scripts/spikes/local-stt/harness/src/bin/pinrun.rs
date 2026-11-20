//! pinrun: runs a command the way the emulated laptop runs it (Phase 33, *The emulated laptop*).
//!
//!   pinrun topology [--write]
//!       The cores, their efficiency classes and the 12-processor mask (six of the fastest cores and both of their
//!       hyper-threads). --write stores the mask in profiles.json.
//!
//!   pinrun --profile laptop|throttled|uncapped|unpinned [--memory-limit-mb N] [--cpu-rate PCT] [--report PATH]
//!          -- CMD ARGS…
//!       Puts itself in a job object whose affinity is the mask, so CMD and all its children are pinned from their
//!       first instruction. `laptop` and `throttled` refuse to start unless the active power scheme is that
//!       profile's (profiles.json); `uncapped` runs under whatever scheme is active and says so. `unpinned` (Phase
//!       37: measuring the graphics cards, not the laptop) uses the same job without an affinity. Samples the
//!       processors' clock and, per graphics adapter, the processes' GPU engine use and GPU memory (dedicated and
//!       shared) once a second, and reports the job's CPU time. Writes a JSON report (default out/pinrun-last.json)
//!       and exits with CMD's exit code.
//!       --memory-limit-mb: a commit limit per process (M8). --cpu-rate: a hard cap on the job's CPU time as a
//!       percentage of the pinned processors (the calibration fallback if the frequency cap is ignored).
//!       --capture-console FILE: runs CMD on a pseudo console and saves what it prints there (Cinebench prints its
//!       score only to an attached console).
//!
//! It changes no system setting: the job only affects the processes in it, and ends with them.

use local_stt_harness::{out_dir, profiles_path, read_json, sampler::Sampler, sys};
use serde_json::{Value, json};
use std::process::{Command, ExitCode};
use std::time::Instant;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("topology") {
        return topology(args.iter().any(|a| a == "--write"));
    }
    match run(&args) {
        Ok(code) => ExitCode::from(code),
        Err(message) => {
            eprintln!("pinrun: {message}");
            ExitCode::from(3)
        }
    }
}

fn topology(write: bool) -> ExitCode {
    let cores = match sys::cores() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("pinrun: GetLogicalProcessorInformationEx failed: {e}");
            return ExitCode::from(3);
        }
    };
    let mask = sys::laptop_mask(&cores);
    let report = json!({
        "cores": cores,
        "logicalProcessors": cores.iter().map(|c| c.logical.len()).sum::<usize>(),
        "cpuFeatures": sys::cpu_features(),
        "laptopMask": mask.as_ref().map(|m| format!("0x{m:x}")).ok(),
        "laptopLogicalProcessors": mask.as_ref().map(|m| sys::mask_to_list(*m)).ok(),
        "error": mask.as_ref().err(),
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
    if write {
        let Ok(mask) = mask else { return ExitCode::from(3) };
        let path = profiles_path();
        let mut profiles = read_json(&path).unwrap_or_else(default_profiles);
        profiles["mask"] = json!(format!("0x{mask:x}"));
        profiles["logicalProcessors"] = json!(sys::mask_to_list(mask));
        let text = serde_json::to_string_pretty(&profiles).unwrap_or_default() + "\n";
        if let Err(e) = std::fs::write(&path, text) {
            eprintln!("pinrun: writing {}: {e}", path.display());
            return ExitCode::from(3);
        }
        eprintln!("pinrun: wrote the mask to {}", path.display());
    }
    ExitCode::SUCCESS
}

fn default_profiles() -> Value {
    json!({
        "note": "Phase 33's emulated laptop. The mask comes from `pinrun topology --write`; each profile's cap and scores from calibrate.ps1.",
        "mask": null,
        "logicalProcessors": [],
        "profiles": {
            "laptop": { "scheme": "DeScribe laptop emulation", "targetCinebench2024Multi": 557, "targetCinebenchR23Multi": 10036 },
            "throttled": { "scheme": "DeScribe laptop emulation (throttled)", "targetCinebench2024Multi": 334, "targetCinebenchR23Multi": 6022 }
        }
    })
}

fn run(args: &[String]) -> Result<u8, String> {
    let split = args.iter().position(|a| a == "--").ok_or("usage: pinrun --profile NAME [options] -- CMD ARGS…")?;
    let (opts, command) = (&args[..split], &args[split + 1..]);
    if command.is_empty() {
        return Err("no command after --".into());
    }
    let mut profile = None;
    let mut memory_limit_mb: Option<u64> = None;
    let mut cpu_rate: Option<f64> = None;
    let mut report_path = out_dir().join("pinrun-last.json");
    let mut capture: Option<std::path::PathBuf> = None;
    let mut i = 0;
    while i < opts.len() {
        let value = || opts.get(i + 1).cloned().ok_or(format!("{} needs a value", opts[i]));
        match opts[i].as_str() {
            "--profile" => profile = Some(value()?),
            "--memory-limit-mb" => memory_limit_mb = Some(value()?.parse().map_err(|_| "bad --memory-limit-mb")?),
            "--cpu-rate" => cpu_rate = Some(value()?.parse().map_err(|_| "bad --cpu-rate")?),
            "--report" => report_path = value()?.into(),
            "--capture-console" => capture = Some(value()?.into()),
            other => return Err(format!("unknown option {other}")),
        }
        i += 2;
    }
    let profile = profile.ok_or("--profile laptop|throttled|uncapped|unpinned is required")?;
    let profiles = read_json(&profiles_path()).unwrap_or_else(default_profiles);
    let mask = match profiles["mask"].as_str().and_then(sys::parse_mask) {
        Some(m) => m,
        None => sys::laptop_mask(&sys::cores().map_err(|e| e.to_string())?)?,
    };
    let scheme = sys::active_scheme();
    let scheme_name = scheme.as_ref().map(|s| s.name.clone()).unwrap_or_default();
    let capped = match profile.as_str() {
        "laptop" | "throttled" => {
            let wanted = profiles["profiles"][&profile]["scheme"].as_str().unwrap_or_default();
            if scheme_name != wanted {
                return Err(format!(
                    "profile {profile} needs the power scheme \"{wanted}\" to be active, but \"{scheme_name}\" is. \
                     Switch to it first (see docs/phases/33-maintainer-guide.md)."
                ));
            }
            true
        }
        "uncapped" | "unpinned" => false,
        other => return Err(format!("unknown profile {other}")),
    };
    let pinned = profile != "unpinned";
    if !pinned && cpu_rate.is_some() {
        return Err("--cpu-rate needs a pinned profile".into());
    }

    let total_lps = sys::cores().map(|c| c.iter().map(|c| c.logical.len()).sum::<usize>()).unwrap_or(24).max(1);
    let job = sys::Job::new(pinned.then_some(mask), memory_limit_mb.map(|mb| mb * 1024 * 1024))
        .map_err(|e| format!("job object: {e}"))?;
    let lps = if pinned { sys::mask_to_list(mask) } else { (0..total_lps as u32).collect() };
    if let Some(pct) = cpu_rate {
        // Windows' rate is a share of every logical processor on the machine, in hundredths of a percent.
        let rate = (pct / 100.0 * lps.len() as f64 / total_lps as f64 * 10_000.0).round() as u32;
        job.set_cpu_rate(rate).map_err(|e| format!("CPU rate cap: {e}"))?;
    }
    job.assign_self().map_err(|e| format!("putting pinrun in the job: {e}"))?;
    let raw = job.raw();
    let own_pid = std::process::id();
    let sampler = Sampler::start(
        lps.clone(),
        Box::new(move || sys::job_pids(raw).into_iter().filter(|p| *p != own_pid).collect()),
    );

    let started = Instant::now();
    let started_at = local_stt_harness::now_iso();
    let (exit_code, error) = match &capture {
        Some(path) => match local_stt_harness::pty::run(command, path) {
            Ok(code) => (Some(code as i32), None),
            Err(e) => (None, Some(format!("could not start {} on a pseudo console: {e}", command[0]))),
        },
        None => match Command::new(&command[0]).args(&command[1..]).status() {
            Ok(s) => (s.code(), None),
            Err(e) => (None, Some(format!("could not start {}: {e}", command[0]))),
        },
    };
    let wall = started.elapsed().as_secs_f64();
    let samples = sampler.finish();
    let peaks = job.peaks();
    let (user_sec, kernel_sec) = job.cpu_seconds();
    let report = json!({
        "tool": "pinrun",
        "startedAt": started_at,
        "profile": profile,
        "capped": capped,
        "pinned": pinned,
        "mask": pinned.then(|| format!("0x{mask:x}")),
        "logicalProcessors": lps,
        "scheme": scheme,
        "command": command,
        "memoryLimitMb": memory_limit_mb,
        "cpuRatePercentOfPinned": cpu_rate,
        "wallSec": wall,
        "exitCode": exit_code,
        "error": error,
        "peakProcessCommitBytes": peaks.peak_process_commit_bytes,
        "peakJobCommitBytes": peaks.peak_job_commit_bytes,
        // CPU time of every process in the job, so "the processor mostly free" is a number: cpuSec / wallSec is the
        // average number of logical processors kept busy.
        "cpuUserSec": user_sec,
        "cpuKernelSec": kernel_sec,
        "samples": samples,
    });
    if let Some(dir) = report_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&report_path, serde_json::to_string_pretty(&report).unwrap_or_default() + "\n");
    eprintln!(
        "pinrun: {profile} ({}), {} LPs, {wall:.1} s, exit {:?}, peak commit {:.0} MB, CPU {:.1} s, clock {:?} MHz, \
         GPU max {:.1} %",
        if capped { "capped" } else { "uncapped" },
        lps.len(),
        exit_code,
        peaks.peak_process_commit_bytes as f64 / 1e6,
        user_sec + kernel_sec,
        samples.clock_mean_mhz,
        samples.gpu_max_percent,
    );
    for a in &samples.gpu_adapters {
        eprintln!(
            "pinrun:   GPU {}: engine max {:.1} % / mean {:.1} %, dedicated peak {:.0} MB, shared peak {:.0} MB",
            a.luid,
            a.engine_max_percent,
            a.engine_mean_percent,
            a.dedicated_peak_bytes as f64 / 1e6,
            a.shared_peak_bytes as f64 / 1e6,
        );
    }
    if let Some(e) = error {
        return Err(e);
    }
    Ok(exit_code.map(|c| c.clamp(0, 255) as u8).unwrap_or(1))
}
