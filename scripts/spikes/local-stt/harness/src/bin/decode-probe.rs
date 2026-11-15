//! decode-probe: Task 4. From a recording to 16 kHz mono PCM, with one decoder, measured.
//!
//!   decode-probe FILE [--decoder mf|symphonia] [--native] [--out DIR] [--compare-ffmpeg]
//!
//! - mf: Windows' Media Foundation source reader (crate::decode), which resamples to 16 kHz itself where it can.
//!   --native asks for the file's own rate instead.
//! - symphonia (build with --features symphonia): the Rust decoder, MPL-2.0. It writes the file's own rate,
//!   downmixed to mono; the engine resamples.
//! - --compare-ffmpeg decodes the same file with ffmpeg (a reference only: it never ships) to 16 kHz mono and
//!   compares the length and the samples (correlation at the best lag within ±100 ms).
//!
//! Writes the WAV and a JSON report into out/decode/ (default), with time and this process's peak memory: run
//! one decoder per process so each peak is its own.

use local_stt_harness::{decode, out_dir, sys, wav};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::time::Instant;
use windows::Win32::System::Threading::GetCurrentProcess;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let get = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let Some(file) = args.iter().find(|a| !a.starts_with("--") && !is_value(&args, a)).cloned() else {
        eprintln!("usage: decode-probe FILE [--decoder mf|symphonia] [--native] [--out DIR] [--compare-ffmpeg]");
        return ExitCode::from(2);
    };
    let input = PathBuf::from(&file);
    let decoder = get("--decoder").unwrap_or_else(|| "mf".into());
    let dir = get("--out").map(PathBuf::from).unwrap_or_else(|| out_dir().join("decode"));
    let _ = std::fs::create_dir_all(&dir);
    let stem = input.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let output = dir.join(format!("{stem}.{decoder}.wav"));
    let started = Instant::now();
    let result: Result<Value, String> = match decoder.as_str() {
        "mf" => decode::decode_to_wav(&input, &output, args.iter().any(|a| a == "--native"))
            .map(|r| serde_json::to_value(r).unwrap_or(Value::Null))
            .map_err(|e| e.to_string()),
        #[cfg(feature = "symphonia")]
        "symphonia" => symphonia_decode::decode(&input, &output),
        other => Err(format!("unknown decoder {other} (symphonia needs --features symphonia)")),
    };
    let wall = started.elapsed().as_secs_f64();
    let memory = sys::process_memory(unsafe { GetCurrentProcess() });
    let mut report = json!({
        "tool": "decode-probe",
        "decoder": decoder,
        "input": input.display().to_string(),
        "inputBytes": std::fs::metadata(&input).map(|m| m.len()).ok(),
        "wallSec": wall,
        "peakWorkingSetBytes": memory.peak_working_set_bytes,
        "peakPrivateBytes": memory.peak_private_bytes,
    });
    match result {
        Ok(r) => {
            report["ok"] = json!(true);
            report["result"] = r;
            if args.iter().any(|a| a == "--compare-ffmpeg") {
                report["ffmpeg"] = compare_ffmpeg(&input, &output, &dir, &stem);
            }
        }
        Err(e) => {
            report["ok"] = json!(false);
            report["error"] = json!(e);
        }
    }
    let text = serde_json::to_string_pretty(&report).unwrap_or_default();
    let _ = std::fs::write(dir.join(format!("{stem}.{decoder}.json")), text.clone() + "\n");
    println!("{text}");
    if report["ok"] == json!(true) { ExitCode::SUCCESS } else { ExitCode::from(1) }
}

fn is_value(args: &[String], a: &String) -> bool {
    args.windows(2).any(|w| (w[0] == "--decoder" || w[0] == "--out") && &w[1] == a)
}

fn read_mono_16k(path: &Path) -> Option<(u32, Vec<f32>)> {
    let info = wav::read_info(path)?;
    let bytes = std::fs::read(path).ok()?;
    let data = &bytes[info.data_offset as usize..(info.data_offset + info.data_bytes) as usize];
    let samples: Vec<f32> = data
        .chunks_exact(2 * info.channels as usize)
        .map(|f| {
            let s: i32 = f.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as i32).sum();
            s as f32 / info.channels as f32 / 32768.0
        })
        .collect();
    Some((info.sample_rate, samples))
}

/// Length and correlation against ffmpeg's 16 kHz mono decode of the same file.
fn compare_ffmpeg(input: &Path, ours: &Path, dir: &Path, stem: &str) -> Value {
    let reference = dir.join(format!("{stem}.ffmpeg.wav"));
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(input)
        .args(["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
        .arg(&reference)
        .status();
    if !status.is_ok_and(|s| s.success()) {
        return json!({ "error": "ffmpeg failed or isn't installed" });
    }
    let (Some((rate_a, a)), Some((rate_b, b))) = (read_mono_16k(ours), read_mono_16k(&reference)) else {
        return json!({ "error": "can't read the WAVs" });
    };
    let mut result = json!({
        "oursRate": rate_a, "ffmpegRate": rate_b,
        "oursSec": a.len() as f64 / rate_a as f64, "ffmpegSec": b.len() as f64 / rate_b as f64,
    });
    if rate_a != rate_b {
        result["note"] = json!("different rates: samples not compared");
        return result;
    }
    // Correlation over a 10 s excerpt from the middle, at the best lag within ±100 ms (an MP3's encoder delay is
    // tens of milliseconds, and decoders differ in whether they trim it).
    let n = a.len().min(b.len());
    let len = (rate_a as usize * 10).min(n / 2);
    let from = n / 2 - len / 2;
    let max_lag = rate_a as i64 / 10;
    let mut best = (0i64, f64::MIN);
    for lag in -max_lag..=max_lag {
        let (mut sab, mut saa, mut sbb) = (0f64, 0f64, 0f64);
        for i in from..from + len {
            let j = i as i64 + lag;
            if j < 0 || j as usize >= b.len() {
                continue;
            }
            let (x, y) = (a[i] as f64, b[j as usize] as f64);
            sab += x * y;
            saa += x * x;
            sbb += y * y;
        }
        let r = if saa > 0.0 && sbb > 0.0 { sab / (saa * sbb).sqrt() } else { 0.0 };
        if r > best.1 {
            best = (lag, r);
        }
    }
    result["correlation"] = json!(best.1);
    result["bestLagSamples"] = json!(best.0);
    result
}

#[cfg(feature = "symphonia")]
mod symphonia_decode {
    use local_stt_harness::wav::Pcm16Writer;
    use serde_json::{Value, json};
    use std::path::Path;
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::{CODEC_TYPE_NULL, DecoderOptions};
    use symphonia::core::errors::Error;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    pub fn decode(input: &Path, output: &Path) -> Result<Value, String> {
        let file = std::fs::File::open(input).map_err(|e| e.to_string())?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = input.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
            .map_err(|e| format!("probe: {e}"))?;
        let mut format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or("no audio track")?
            .clone();
        let rate = track.codec_params.sample_rate.ok_or("no sample rate")?;
        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("codec: {e}"))?;
        let mut writer = Pcm16Writer::create(output, 1, rate).map_err(|e| e.to_string())?;
        let mut frames = 0u64;
        let mut channels_seen = 0usize;
        loop {
            let packet = match format.next_packet() {
                Ok(p) => p,
                Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(Error::ResetRequired) => break,
                Err(e) => return Err(format!("reading: {e}")),
            };
            if packet.track_id() != track.id {
                continue;
            }
            match decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = *decoded.spec();
                    let channels = spec.channels.count().max(1);
                    channels_seen = channels;
                    let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                    buf.copy_interleaved_ref(decoded);
                    let mono: Vec<f32> =
                        buf.samples().chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect();
                    frames += mono.len() as u64;
                    writer.write_f32(&mono).map_err(|e| e.to_string())?;
                }
                Err(Error::DecodeError(_)) => continue,
                Err(e) => return Err(format!("decoding: {e}")),
            }
        }
        writer.finish().map_err(|e| e.to_string())?;
        Ok(json!({
            "decoder": "symphonia", "native_sample_rate": rate, "native_channels": channels_seen,
            "resampled_by": "native-rate", "output_sample_rate": rate, "output_samples": frames,
            "duration_sec": frames as f64 / rate as f64,
        }))
    }
}
