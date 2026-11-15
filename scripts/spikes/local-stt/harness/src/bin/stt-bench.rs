//! stt-bench: one local transcription of one recording, measured (Phase 33, Task 2; M2–M10).
//!
//!   stt-bench RECORDING --asr MODEL [--diar MODEL] [--threads N] [--mode combined|words|speakers|all]
//!             [--label NAME] [--out PATH] [--bin DIR] [--diar-preset NAME] [--language CODE]
//!             [--cancel-after SECONDS] [--reuse-wav]
//!
//! MODEL is a GGUF path or an id from models.json. The driver is NeMo-Speech.cpp's own CLI (`nemo-speech`), run as a
//! child process with local model paths only (it then makes no network requests) and NEMO_SPEECH_MODEL_DIR pointed
//! at an empty folder, so a missing model can never be fetched.
//!
//! Modes:
//!   combined  `transcribe --diar-model`: words with a speaker each, one process (the speed that counts).
//!   words     `transcribe` alone: the words model's share of the time.
//!   speakers  `diarize --format json`: the speaker segments alone (NeMo-Speech.cpp fixes this at 4 threads).
//!   all       words, speakers and combined, one after the other.
//!
//! The recording is decoded first with Media Foundation into a 16-bit mono WAV in out/cache/ (unless it already is a
//! WAV the CLI reads), and that time counts. The JSON written to out/runs/ holds the words and segments (transcript
//! text: out/ is gitignored), the timings, the memory, and how the process was pinned. It is a laptop estimate only
//! when pinned to the profile's twelve logical processors under one of the emulation schemes; otherwise it says
//! "uncapped" and must not be reported as one.

use local_stt_harness::{decode, out_dir, profiles_path, read_json, spike_dir, sys, wav};
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Threading::GetCurrentProcess;

struct Options {
    recording: PathBuf,
    asr: Option<PathBuf>,
    diar: Option<PathBuf>,
    threads: u32,
    mode: String,
    label: Option<String>,
    out: Option<PathBuf>,
    bin: Option<PathBuf>,
    diar_preset: Option<String>,
    language: Option<String>,
    cancel_after: Option<f64>,
    reuse_wav: bool,
    chunk_sec: f64,
    overlap_sec: f64,
    parallel: bool,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("stt-bench: {e}");
            ExitCode::from(2)
        }
    }
}

fn parse() -> Result<Options, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut o = Options {
        recording: PathBuf::new(),
        asr: None,
        diar: None,
        threads: 8,
        mode: "combined".into(),
        label: None,
        out: None,
        bin: None,
        diar_preset: None,
        language: None,
        cancel_after: None,
        reuse_wav: false,
        chunk_sec: 0.0,
        overlap_sec: 2.0,
        parallel: false,
    };
    let mut i = 0;
    let mut positional = Vec::new();
    while i < args.len() {
        let a = args[i].as_str();
        let mut value = || {
            i += 1;
            args.get(i).cloned().ok_or(format!("{a} needs a value"))
        };
        match a {
            "--asr" => o.asr = Some(model_path(&value()?)?),
            "--diar" => o.diar = Some(model_path(&value()?)?),
            "--threads" => o.threads = value()?.parse().map_err(|_| "bad --threads")?,
            "--mode" => o.mode = value()?,
            "--label" => o.label = Some(value()?),
            "--out" => o.out = Some(value()?.into()),
            "--bin" => o.bin = Some(value()?.into()),
            "--diar-preset" => o.diar_preset = Some(value()?),
            "--language" => o.language = Some(value()?),
            "--cancel-after" => o.cancel_after = Some(value()?.parse().map_err(|_| "bad --cancel-after")?),
            "--reuse-wav" => o.reuse_wav = true,
            "--chunk-sec" => o.chunk_sec = value()?.parse().map_err(|_| "bad --chunk-sec")?,
            "--overlap-sec" => o.overlap_sec = value()?.parse().map_err(|_| "bad --overlap-sec")?,
            "--parallel" => o.parallel = true,
            _ if a.starts_with("--") => return Err(format!("unknown option {a}")),
            _ => positional.push(args[i].clone()),
        }
        i += 1;
    }
    o.recording = positional.first().ok_or("usage: stt-bench RECORDING --asr MODEL [--diar MODEL] …")?.into();
    if !["combined", "words", "speakers", "pipeline", "all"].contains(&o.mode.as_str()) {
        return Err(format!("unknown --mode {}", o.mode));
    }
    let needs_asr = o.mode != "speakers";
    let needs_diar = o.mode != "words";
    if needs_asr && o.asr.is_none() {
        return Err("--asr is required for this mode".into());
    }
    if needs_diar && o.diar.is_none() {
        return Err("--diar is required for this mode (without it nemo-speech would download a default model)".into());
    }
    Ok(o)
}

/// A GGUF path as given, or the file of a models.json id in models/.
fn model_path(text: &str) -> Result<PathBuf, String> {
    let as_path = PathBuf::from(text);
    if as_path.is_file() {
        return Ok(as_path);
    }
    let models = read_json(&spike_dir().join("models.json")).ok_or("models.json missing")?;
    let file = models["models"]
        .as_array()
        .and_then(|m| m.iter().find(|m| m["id"] == text))
        .and_then(|m| m["file"].as_str())
        .ok_or(format!("{text} is neither a file nor an id in models.json"))?;
    let path = spike_dir().join("models").join(file);
    if !path.is_file() {
        return Err(format!("{} is missing: run fetch-models.mjs", path.display()));
    }
    Ok(path)
}

fn default_bin() -> PathBuf {
    let built = spike_dir().join("vendor").join("build-cpu-asr").join("bin");
    if built.join("nemo-speech.exe").is_file() {
        return built;
    }
    spike_dir().join("vendor/prebuilt/extracted/nemo-speech-0.3.0-windows-x86_64-cpu/bin")
}

fn stem(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "recording".into())
}

/// Cuts the 16 kHz WAV into pieces of `chunk_sec` that overlap by `overlap_sec`: c00000.wav, c00001.wav, …
/// Returns each piece's (start, length) in seconds.
fn make_chunks(
    wav_path: &Path,
    info: &wav::WavInfo,
    dir: &Path,
    chunk_sec: f64,
    overlap_sec: f64,
) -> Result<Vec<(f64, f64)>, String> {
    if info.format != 1 || info.bits != 16 {
        return Err("chunking needs a 16-bit PCM WAV".into());
    }
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let rate = info.sample_rate as f64;
    let total = info.data_bytes / (info.channels as u64 * 2);
    let step = ((chunk_sec - overlap_sec).max(1.0) * rate) as u64;
    let len = (chunk_sec * rate) as u64;
    let mut list = Vec::new();
    let mut start = 0u64;
    loop {
        let count = len.min(total - start);
        let path = dir.join(format!("c{:05}.wav", list.len()));
        wav::copy_range(wav_path, info, start, count, &path).map_err(|e| e.to_string())?;
        list.push((start as f64 / rate, count as f64 / rate));
        if start + count >= total {
            break;
        }
        start += step;
    }
    Ok(list)
}

/// Joins the pieces' words: each piece keeps the words whose middle falls in its own part (half of each overlap
/// goes to each neighbour), shifted to the recording's time.
fn merge_chunks(out_dir: &Path, chunks: &[(f64, f64)], overlap_sec: f64) -> Value {
    let mut words = Vec::new();
    let mut languages = Vec::new();
    let mut missing = 0;
    let last = chunks.len().saturating_sub(1);
    for (k, (start, len)) in chunks.iter().enumerate() {
        let Some(doc) = read_json(&out_dir.join(format!("c{k:05}.json"))) else {
            missing += 1;
            continue;
        };
        let own_start = if k == 0 { f64::MIN } else { start + overlap_sec / 2.0 };
        let own_end = if k == last { f64::MAX } else { start + len - overlap_sec / 2.0 };
        if let Some(list) = doc["languages"].as_array() {
            languages.extend(list.iter().cloned());
        }
        for w in doc["words"].as_array().into_iter().flatten() {
            let (Some(s), Some(e)) = (w["start"].as_f64(), w["end"].as_f64()) else { continue };
            let mid = start + (s + e) / 2.0;
            if mid >= own_start && mid < own_end {
                let mut w = w.clone();
                w["start"] = json!(s + start);
                w["end"] = json!(e + start);
                words.push(w);
            }
        }
    }
    json!({ "words": words, "languages": languages, "mergedFromChunks": chunks.len(), "missingChunks": missing })
}

struct Run {
    report: Value,
    output: Option<Value>,
}

/// Runs one nemo-speech command, timestamping its stderr lines as they arrive.
fn run_cli(bin: &Path, kind: &str, args: &[String], log_path: &Path, cancel_after: Option<f64>) -> Result<Run, String> {
    let exe = bin.join("nemo-speech.exe");
    let empty_models = out_dir().join("empty-model-dir");
    let _ = std::fs::create_dir_all(&empty_models);
    let started = Instant::now();
    let mut child = Command::new(&exe)
        .args(args)
        .env("NEMO_SPEECH_MODEL_DIR", &empty_models)
        .env("NEMO_SPEECH_TIMING", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("starting {}: {e}", exe.display()))?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let lines: Arc<Mutex<Vec<(f64, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let (lines2, t0) = (Arc::clone(&lines), started);
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut l) = lines2.lock() {
                l.push((t0.elapsed().as_secs_f64(), line));
            }
        }
    });
    let mut cancel = None;
    if let Some(after) = cancel_after {
        // Poll so a run that ends before the deadline isn't waited on for nothing.
        let deadline = started + Duration::from_secs_f64(after);
        while Instant::now() < deadline {
            if child.try_wait().ok().flatten().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if child.try_wait().ok().flatten().is_none() {
            let killed_at = Instant::now();
            let _ = child.kill();
            let _ = child.wait();
            cancel = Some(json!({ "requestedAfterSec": after, "exitedAfterKillMs": killed_at.elapsed().as_secs_f64() * 1000.0 }));
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let wall = started.elapsed().as_secs_f64();
    let memory = sys::process_memory(HANDLE(child.as_raw_handle()));
    let _ = reader.join();
    let lines = lines.lock().map(|l| l.clone()).unwrap_or_default();

    let mut log = std::fs::File::create(log_path).map_err(|e| e.to_string())?;
    for (t, line) in &lines {
        let _ = writeln!(log, "[+{t:9.3}s] {line}");
    }
    // The engine is loaded and warmed up when it prints its mode line (transcribe) or starts on the input.
    let ready = lines
        .iter()
        // `diarize` prints nothing between loading and its result, so it has no such marker.
        .find(|(_, l)| l.starts_with("[asr] mode="))
        .map(|(t, _)| *t);
    let after_ready = |pred: &dyn Fn(&str) -> bool| -> f64 {
        lines
            .iter()
            .filter(|(t, l)| ready.is_none_or(|r| *t >= r) && pred(l))
            .filter_map(|(_, l)| l.rsplit_once('=').and_then(|(_, v)| v.trim().trim_end_matches("ms").trim().parse::<f64>().ok()))
            .sum()
    };
    let encoder_ms: f64 = lines
        .iter()
        .filter(|(t, l)| ready.is_none_or(|r| *t >= r) && l.contains("offline-transducer frames="))
        .filter_map(|(_, l)| {
            l.split("encoder+encproj=").nth(1).and_then(|v| v.trim().trim_end_matches("ms").trim().parse::<f64>().ok())
        })
        .sum();
    let decoder_ms = after_ready(&|l: &str| l.contains("offline-transducer decode frames="));
    let output_path = args.iter().position(|a| a == "--output").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let output = output_path.as_ref().and_then(|p| read_json(p));
    Ok(Run {
        report: json!({
            "kind": kind,
            "args": args,
            "exitCode": status.code(),
            "wallSec": wall,
            "loadAndWarmupSec": ready,
            "processSec": ready.map(|r| wall - r),
            "encoderMs": encoder_ms,
            "decoderMs": decoder_ms,
            "peakWorkingSetBytes": memory.peak_working_set_bytes,
            "peakPrivateBytes": memory.peak_private_bytes,
            "cancel": cancel,
            "log": log_path.display().to_string(),
            "stderrTail": lines.iter().rev().take(5).rev().map(|(_, l)| l.clone()).collect::<Vec<_>>(),
        }),
        output,
    })
}

fn run() -> Result<(), String> {
    let o = parse()?;
    let bin = o.bin.clone().unwrap_or_else(default_bin);
    let label = o.label.clone().unwrap_or_else(|| {
        let asr = o.asr.as_deref().map(stem).unwrap_or_else(|| "none".into());
        let diar = o.diar.as_deref().map(stem).unwrap_or_else(|| "none".into());
        format!("{}.{}.{}.{}.t{}", stem(&o.recording), o.mode, asr, diar, o.threads)
    });
    let runs_dir = out_dir().join("runs");
    std::fs::create_dir_all(&runs_dir).map_err(|e| e.to_string())?;

    // How this process is pinned, and under which scheme.
    let (mask, system_mask) = sys::own_affinity();
    let profiles = read_json(&profiles_path()).unwrap_or(Value::Null);
    let profile_mask = profiles["mask"].as_str().and_then(sys::parse_mask);
    let scheme = sys::active_scheme();
    let scheme_name = scheme.as_ref().map(|s| s.name.clone()).unwrap_or_default();
    let profile = ["laptop", "throttled"]
        .into_iter()
        .find(|p| profiles["profiles"][p]["scheme"].as_str() == Some(scheme_name.as_str()));
    let pinned_to_profile = profile_mask == Some(mask) && sys::mask_to_list(mask).len() == 12;
    let estimate = pinned_to_profile && profile.is_some();

    // Decoding (Task 4): the WAV the CLI reads.
    let info = wav::read_info(&o.recording);
    let (wav_path, decode_report) = if info.is_some_and(|i| i.readable_by_cli()) {
        (o.recording.clone(), None)
    } else {
        let size = std::fs::metadata(&o.recording).map(|m| m.len()).unwrap_or(0);
        let cache = out_dir().join("cache");
        std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let target = cache.join(format!("{}.{size}.wav", stem(&o.recording)));
        if o.reuse_wav && target.is_file() {
            (target, Some(json!({ "reused": true })))
        } else {
            let report = decode::decode_to_wav(&o.recording, &target, false).map_err(|e| format!("decoding: {e}"))?;
            let memory = sys::process_memory(unsafe { GetCurrentProcess() });
            let mut value = serde_json::to_value(&report).unwrap_or(Value::Null);
            value["peakWorkingSetBytesOfSttBench"] = json!(memory.peak_working_set_bytes);
            (target, Some(value))
        }
    };
    let audio = wav::read_info(&wav_path).ok_or("the decoded WAV can't be read")?;
    let audio_sec = audio.duration_sec();
    let decode_sec = decode_report.as_ref().and_then(|d| d["wall_sec"].as_f64()).unwrap_or(0.0);

    let wav_arg = wav_path.display().to_string();
    let threads = o.threads.to_string();
    let transcribe_args = |input: &str, with_diar: bool, out_flag: &str, out: &Path| {
        let mut a = vec![
            "transcribe".to_string(),
            input.to_string(),
            "--model".into(),
            o.asr.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
            "--device".into(),
            "cpu".into(),
            "--format".into(),
            "json".into(),
            "--asr.backend.threads".into(),
            threads.clone(),
            "--force".into(),
            out_flag.to_string(),
            out.display().to_string(),
        ];
        if let Some(lang) = &o.language {
            a.extend(["--language".into(), lang.clone()]);
        }
        if with_diar {
            a.extend(["--diar-model".into(), o.diar.as_ref().map(|p| p.display().to_string()).unwrap_or_default()]);
            if let Some(preset) = &o.diar_preset {
                a.extend(["--diar-preset".into(), preset.clone()]);
            }
        }
        a
    };
    let diarize_args = |out: &Path| {
        let mut a = vec![
            "diarize".to_string(),
            wav_arg.clone(),
            "--model".into(),
            o.diar.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
            "--device".into(),
            "cpu".into(),
            "--format".into(),
            "json".into(),
            "--force".into(),
            "--output".into(),
            out.display().to_string(),
        ];
        if let Some(preset) = &o.diar_preset {
            a.extend(["--preset".into(), preset.clone()]);
        }
        a
    };

    // Words in caller-made chunks (M4): 16 kHz WAV pieces with an overlap, one CLI process for all of them.
    let chunks = if o.chunk_sec > 0.0 && o.mode != "speakers" && o.mode != "combined" {
        let dir = out_dir().join("cache").join("chunks").join(&label);
        let started = Instant::now();
        let list = make_chunks(&wav_path, &audio, &dir, o.chunk_sec, o.overlap_sec)?;
        Some((dir, list, started.elapsed().as_secs_f64()))
    } else {
        None
    };
    let chunk_sec_spent = chunks.as_ref().map(|c| c.2).unwrap_or(0.0);

    let kinds: Vec<&str> = match o.mode.as_str() {
        "all" => vec!["words", "speakers", "combined"],
        "pipeline" => vec!["words", "speakers"],
        m => vec![m],
    };
    let plan: Vec<(&str, Vec<String>, PathBuf)> = kinds
        .iter()
        .map(|kind| {
            let out = runs_dir.join(format!("{label}.{kind}.engine.json"));
            let log = runs_dir.join(format!("{label}.{kind}.log"));
            let args = match *kind {
                "words" => match &chunks {
                    Some((dir, _, _)) => {
                        let chunk_out = runs_dir.join(format!("{label}.words.chunks"));
                        transcribe_args(&dir.display().to_string(), false, "--output-dir", &chunk_out)
                    }
                    None => transcribe_args(&wav_arg, false, "--output", &out),
                },
                "combined" => transcribe_args(&wav_arg, true, "--output", &out),
                _ => diarize_args(&out),
            };
            (*kind, args, log)
        })
        .collect();
    let mut results: Vec<(String, Run)> = Vec::new();
    if o.parallel && plan.len() > 1 {
        eprintln!("stt-bench: {} in parallel …", kinds.join(" and "));
        let outcomes: Vec<Result<Run, String>> = std::thread::scope(|scope| {
            let handles: Vec<_> = plan
                .iter()
                .map(|(kind, args, log)| scope.spawn(|| run_cli(&bin, kind, args, log, o.cancel_after)))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("thread panicked".into()))).collect()
        });
        for ((kind, ..), outcome) in plan.iter().zip(outcomes) {
            results.push((kind.to_string(), outcome?));
        }
    } else {
        for (kind, args, log) in &plan {
            eprintln!("stt-bench: {kind} …");
            results.push((kind.to_string(), run_cli(&bin, kind, args, log, o.cancel_after)?));
        }
    }
    let mut runs = Vec::new();
    let mut outputs = serde_json::Map::new();
    for (kind, run) in results {
        eprintln!(
            "stt-bench: {kind}: {:.1} s (exit {:?})",
            run.report["wallSec"].as_f64().unwrap_or(0.0),
            run.report["exitCode"]
        );
        if let Some(output) = run.output {
            outputs.insert(kind.clone(), output);
        }
        runs.push(run.report);
    }
    if let Some((_, list, _)) = &chunks {
        let chunk_out = runs_dir.join(format!("{label}.words.chunks"));
        outputs.insert("words".into(), merge_chunks(&chunk_out, list, o.overlap_sec));
    }

    // The words (with speakers when diarized) and the segments, as the engine gave them.
    let words_source = outputs.get("combined").or_else(|| outputs.get("words"));
    let words: Vec<Value> = words_source
        .and_then(|o| o["words"].as_array())
        .map(|w| {
            w.iter()
                .map(|w| {
                    json!({
                        "text": w["word"], "start": w["start"], "end": w["end"],
                        "confidence": w["confidence"], "speaker": w.get("speaker").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let languages = words_source.map(|o| o["languages"].clone()).unwrap_or(Value::Null);
    let segments = outputs.get("speakers").cloned().unwrap_or(Value::Null);

    let wall_of = |kind: &str| runs.iter().find(|r| r["kind"] == kind).and_then(|r| r["wallSec"].as_f64());
    let engine_sec = match o.mode.as_str() {
        "pipeline" => {
            let (w, s) = (wall_of("words").unwrap_or(0.0), wall_of("speakers").unwrap_or(0.0));
            chunk_sec_spent + if o.parallel { w.max(s) } else { w + s }
        }
        "all" => wall_of("combined").unwrap_or(0.0),
        _ => chunk_sec_spent + runs.last().and_then(|r| r["wallSec"].as_f64()).unwrap_or(0.0),
    };
    let total_sec = decode_sec + engine_sec;
    let report = json!({
        "tool": "stt-bench",
        "version": 1,
        "label": label,
        "createdAt": local_stt_harness::now_iso(),
        "driver": "cli",
        "runtime": { "bin": bin.display().to_string() },
        "recording": { "path": o.recording.display().to_string(), "bytes": std::fs::metadata(&o.recording).map(|m| m.len()).ok() },
        "audio": { "wav": wav_arg, "sampleRate": audio.sample_rate, "channels": audio.channels, "durationSec": audio_sec },
        "decode": decode_report,
        "models": { "asr": o.asr.as_ref().map(|p| p.display().to_string()), "diar": o.diar.as_ref().map(|p| p.display().to_string()), "diarPreset": o.diar_preset },
        "threads": o.threads,
        "mode": o.mode,
        "parallel": o.parallel,
        "chunking": chunks.as_ref().map(|(dir, list, sec)| json!({
            "chunkSec": o.chunk_sec, "overlapSec": o.overlap_sec, "chunks": list.len(), "makeSec": sec,
            "dir": dir.display().to_string(),
        })),
        "language": o.language,
        "pinning": {
            "mask": format!("0x{mask:x}"),
            "systemMask": format!("0x{system_mask:x}"),
            "logicalProcessors": sys::mask_to_list(mask),
            "profileMask": profile_mask.map(|m| format!("0x{m:x}")),
            "pinnedToProfile": pinned_to_profile,
            "scheme": scheme,
            "profile": profile,
            "laptopEstimate": estimate,
            "label": if estimate { "Estimated for the work laptop" } else { "uncapped: not a laptop estimate" },
        },
        "runs": runs,
        "timing": {
            "decodeSec": decode_sec,
            "engineSec": engine_sec,
            "totalSec": total_sec,
            "xRealtime": if total_sec > 0.0 { audio_sec / total_sec } else { 0.0 },
        },
        "result": { "languages": languages, "words": words, "speakerSegments": segments },
    });
    let out = o.out.clone().unwrap_or_else(|| runs_dir.join(format!("{label}.json")));
    std::fs::write(&out, serde_json::to_string_pretty(&report).unwrap_or_default() + "\n").map_err(|e| e.to_string())?;
    eprintln!(
        "stt-bench: {label}: {:.0} s of audio in {:.1} s = {:.1}× real time ({}). {}",
        audio_sec,
        total_sec,
        report["timing"]["xRealtime"].as_f64().unwrap_or(0.0),
        report["pinning"]["label"].as_str().unwrap_or_default(),
        out.display()
    );
    Ok(())
}
