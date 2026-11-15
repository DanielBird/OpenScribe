//! diar-stream: the speakers model through NeMo-Speech.cpp's C API, the way Phase 34's engine would call it
//! (M4, M8, M10): open a stream, push the recording in pieces as a decoder would deliver them, finish, read the
//! segments. The CLI's `diarize` loads the whole file and diarizes it in one call; this checks whether pushing pieces
//! keeps memory flat for three hours.
//!
//!   diar-stream WAV16K --model GGUF [--preset v3-offline] [--push-sec 30] [--cancel-after-sec S] [--bin DIR]
//!               [--label NAME]
//!
//! The DLL is loaded at run time from the runtime's bin folder, so the harness builds without it. The C API has no
//! thread setting: the diarizer runs on its fixed default. It has no cancel either: --cancel-after-sec stops pushing,
//! closes the stream and destroys the model, and reports how long that took and the memory afterwards.
//! Writes out/runs/<label>.json in stt-bench's shape (result.speakerSegments), so compare.mjs --segments reads it.

use local_stt_harness::{out_dir, spike_dir, sys, wav};
use serde_json::json;
use std::ffi::{CStr, CString, c_char, c_void};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;
use windows::Win32::System::LibraryLoader::{GetProcAddress, LOAD_WITH_ALTERED_SEARCH_PATH, LoadLibraryExW};
use windows::Win32::System::Threading::GetCurrentProcess;
use windows::core::{HSTRING, PCSTR};

#[repr(C)]
struct ModelConfig {
    size: usize,
    model_path: *const c_char,
    gpu: i32,
    preset: *const c_char,
    chunk_frames: i32,
    right_context_frames: i32,
    left_context_frames: i32,
    fifo_frames: i32,
    spkcache_frames: i32,
    update_period_frames: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Segment {
    start_time: f64,
    end_time: f64,
    speaker: i32,
}

type Create = unsafe extern "C" fn(*const ModelConfig, *mut *mut c_void) -> i32;
type Destroy = unsafe extern "C" fn(*mut c_void);
type Open = unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> i32;
type Push = unsafe extern "C" fn(*mut c_void, *const f32, usize, i32) -> i32;
type Finish = unsafe extern "C" fn(*mut c_void) -> i32;
type Close = unsafe extern "C" fn(*mut c_void);
type Segments = unsafe extern "C" fn(*const c_void, *const c_void, *mut Segment, usize, *mut usize) -> i32;
type LastError = unsafe extern "C" fn() -> *const c_char;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("diar-stream: {e}");
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let get = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let wav_path = PathBuf::from(args.first().filter(|a| !a.starts_with("--")).ok_or("usage: diar-stream WAV16K --model GGUF …")?);
    let model = get("--model").ok_or("--model is required")?;
    let preset = get("--preset").unwrap_or_else(|| "v3-offline".into());
    let push_sec: f64 = get("--push-sec").and_then(|v| v.parse().ok()).unwrap_or(30.0);
    let cancel_after: Option<f64> = get("--cancel-after-sec").and_then(|v| v.parse().ok());
    let bin = get("--bin").map(PathBuf::from).unwrap_or_else(|| spike_dir().join("vendor").join("build-cpu-asr").join("bin"));
    let label = get("--label").unwrap_or_else(|| {
        format!("{}.diarstream.{}", wav_path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), preset)
    });

    let info = wav::read_info(&wav_path).ok_or("not a WAV file")?;
    if info.format != 1 || info.bits != 16 || info.channels != 1 {
        return Err("needs a 16-bit mono WAV (stt-bench's out/cache/*.wav)".into());
    }
    let audio_sec = info.duration_sec();

    let dll = bin.join("nemo_speech_asr_c.dll");
    let module = unsafe { LoadLibraryExW(&HSTRING::from(dll.as_os_str()), None, LOAD_WITH_ALTERED_SEARCH_PATH) }
        .map_err(|e| format!("loading {}: {e}", dll.display()))?;
    macro_rules! sym {
        ($name:literal, $ty:ty) => {{
            let p = unsafe { GetProcAddress(module, PCSTR(concat!($name, "\0").as_ptr())) }.ok_or(concat!("missing ", $name))?;
            unsafe { std::mem::transmute::<_, $ty>(p) }
        }};
    }
    let create: Create = sym!("nemo_speech_diar_create", Create);
    let destroy: Destroy = sym!("nemo_speech_diar_destroy", Destroy);
    let open: Open = sym!("nemo_speech_diar_stream_open", Open);
    let push: Push = sym!("nemo_speech_diar_stream_push_f32", Push);
    let finish: Finish = sym!("nemo_speech_diar_stream_finish", Finish);
    let close: Close = sym!("nemo_speech_diar_stream_close", Close);
    let segments_fn: Segments = sym!("nemo_speech_diar_segments", Segments);
    let last_error: LastError = sym!("nemo_speech_asr_last_error", LastError);
    let err = |what: &str, status: i32| {
        let msg = unsafe { CStr::from_ptr(last_error()) }.to_string_lossy().into_owned();
        format!("{what} failed (status {status}): {msg}")
    };

    let memory = || sys::process_memory(unsafe { GetCurrentProcess() });
    let base = memory();
    let started = Instant::now();
    let model_c = CString::new(model.clone()).map_err(|e| e.to_string())?;
    let preset_c = CString::new(preset.clone()).map_err(|e| e.to_string())?;
    let cfg = ModelConfig {
        size: std::mem::size_of::<ModelConfig>(),
        model_path: model_c.as_ptr(),
        gpu: -1,
        preset: preset_c.as_ptr(),
        chunk_frames: 0,
        right_context_frames: 0,
        left_context_frames: -1,
        fifo_frames: 0,
        spkcache_frames: 0,
        update_period_frames: 0,
    };
    let mut handle: *mut c_void = std::ptr::null_mut();
    let status = unsafe { create(&cfg, &mut handle) };
    if status != 0 {
        return Err(err("nemo_speech_diar_create", status));
    }
    let load_sec = started.elapsed().as_secs_f64();
    let mut stream: *mut c_void = std::ptr::null_mut();
    let status = unsafe { open(handle, &mut stream) };
    if status != 0 {
        return Err(err("nemo_speech_diar_stream_open", status));
    }

    let mut file = std::fs::File::open(&wav_path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(info.data_offset)).map_err(|e| e.to_string())?;
    let piece = (push_sec * info.sample_rate as f64) as usize;
    let mut bytes = vec![0u8; piece * 2];
    let mut pushed = 0u64;
    let mut curve = Vec::new();
    let mut next_mark = 600.0;
    let mut cancelled = None;
    let total = info.data_bytes / 2;
    let process_started = Instant::now();
    while pushed < total {
        if cancel_after.is_some_and(|s| started.elapsed().as_secs_f64() >= s) {
            cancelled = Some(pushed as f64 / info.sample_rate as f64);
            break;
        }
        let n = (piece as u64).min(total - pushed) as usize;
        file.read_exact(&mut bytes[..n * 2]).map_err(|e| e.to_string())?;
        let samples: Vec<f32> = bytes[..n * 2].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
        let status = unsafe { push(stream, samples.as_ptr(), samples.len(), info.sample_rate as i32) };
        if status != 0 {
            return Err(err("nemo_speech_diar_stream_push_f32", status));
        }
        pushed += n as u64;
        let done_sec = pushed as f64 / info.sample_rate as f64;
        if done_sec >= next_mark {
            let m = memory();
            curve.push(json!({ "audioSec": done_sec, "wallSec": started.elapsed().as_secs_f64(), "peakWorkingSetBytes": m.peak_working_set_bytes, "peakPrivateBytes": m.peak_private_bytes }));
            next_mark += 600.0;
        }
    }
    let mut segments = Vec::new();
    let cancel_report = if let Some(at) = cancelled {
        let t = Instant::now();
        unsafe {
            close(stream);
            destroy(handle);
        }
        let freed_ms = t.elapsed().as_secs_f64() * 1000.0;
        let now = sys::process_memory(unsafe { GetCurrentProcess() });
        Some(json!({ "stoppedAtAudioSec": at, "closeAndDestroyMs": freed_ms, "peakWorkingSetBytes": now.peak_working_set_bytes }))
    } else {
        let status = unsafe { finish(stream) };
        if status != 0 {
            return Err(err("nemo_speech_diar_stream_finish", status));
        }
        let mut count = 0usize;
        unsafe { segments_fn(stream, std::ptr::null(), std::ptr::null_mut(), 0, &mut count) };
        let mut buf = vec![Segment::default(); count];
        let status = unsafe { segments_fn(stream, std::ptr::null(), buf.as_mut_ptr(), count, &mut count) };
        if status != 0 {
            return Err(err("nemo_speech_diar_segments", status));
        }
        segments = buf[..count].iter().map(|s| json!({ "start": s.start_time, "end": s.end_time, "speaker": s.speaker })).collect();
        unsafe {
            close(stream);
            destroy(handle);
        }
        None
    };
    let wall = started.elapsed().as_secs_f64();
    let process_sec = process_started.elapsed().as_secs_f64();
    let peak = memory();
    let report = json!({
        "tool": "stt-bench",
        "driver": "c-api diar-stream",
        "label": label,
        "createdAt": local_stt_harness::now_iso(),
        "audio": { "wav": wav_path.display().to_string(), "durationSec": audio_sec },
        "models": { "diar": model, "diarPreset": preset },
        "pushSec": push_sec,
        "pinning": { "mask": format!("0x{:x}", sys::own_affinity().0), "logicalProcessors": sys::mask_to_list(sys::own_affinity().0), "laptopEstimate": false },
        "runs": [{
            "kind": "speakers", "wallSec": wall, "loadSec": load_sec, "processSec": process_sec,
            "peakWorkingSetBytes": peak.peak_working_set_bytes, "peakPrivateBytes": peak.peak_private_bytes,
            "baseWorkingSetBytes": base.peak_working_set_bytes, "memoryCurve": curve, "cancel": cancel_report,
        }],
        "timing": { "totalSec": wall, "xRealtime": if wall > 0.0 { audio_sec / wall } else { 0.0 } },
        "result": { "words": [], "speakerSegments": { "segments": segments } },
    });
    let out = out_dir().join("runs").join(format!("{label}.json"));
    let _ = std::fs::create_dir_all(out.parent().unwrap_or(&out_dir()));
    std::fs::write(&out, serde_json::to_string_pretty(&report).unwrap_or_default() + "\n").map_err(|e| e.to_string())?;
    eprintln!(
        "diar-stream: {audio_sec:.0} s in {wall:.1} s ({:.1}× real time), peak working set {:.0} MB, {} segments. {}",
        audio_sec / wall.max(1e-9),
        peak.peak_working_set_bytes as f64 / 1e6,
        report["result"]["speakerSegments"]["segments"].as_array().map(|a| a.len()).unwrap_or(0),
        out.display()
    );
    Ok(())
}
