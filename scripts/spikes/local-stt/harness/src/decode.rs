//! Task 4: from any recording Windows can play to a 16-bit PCM WAV file, in constant memory, with Media
//! Foundation's source reader (`mfreadwrite.dll`, part of Windows: no code to ship or licence).
//!
//! It first asks the reader for 16 kHz mono PCM directly. If the reader refuses, it takes float PCM at the file's
//! own rate, downmixes to mono itself and keeps that rate: nemo-speech resamples 8–96 kHz input to the model's
//! 16 kHz (as does its C API). The report says which happened.

use crate::wav::Pcm16Writer;
use serde::Serialize;
use std::path::Path;
use std::time::Instant;
use windows::Win32::Media::MediaFoundation::{
    IMFMediaType, IMFSourceReader, MF_MT_AUDIO_AVG_BYTES_PER_SECOND, MF_MT_AUDIO_BITS_PER_SAMPLE,
    MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_MAJOR_TYPE,
    MF_MT_SUBTYPE, MF_SOURCE_READER_ALL_STREAMS, MF_SOURCE_READER_FIRST_AUDIO_STREAM, MF_SOURCE_READERF_ENDOFSTREAM,
    MF_VERSION, MFAudioFormat_Float, MFAudioFormat_PCM, MFCreateMediaType, MFCreateSourceReaderFromURL,
    MFMediaType_Audio, MFSTARTUP_FULL, MFShutdown, MFStartup,
};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
use windows::core::HSTRING;

#[derive(Debug, Clone, Serialize)]
pub struct DecodeReport {
    pub decoder: String,
    pub input: String,
    pub input_bytes: u64,
    pub native_channels: u32,
    pub native_sample_rate: u32,
    /// "media-foundation": the reader produced 16 kHz mono itself. "native-rate": it refused, and the output keeps
    /// the file's rate (downmixed here), left to the engine to resample.
    pub resampled_by: String,
    pub output_sample_rate: u32,
    pub output_samples: u64,
    pub duration_sec: f64,
    pub wall_sec: f64,
}

#[derive(Debug)]
pub struct DecodeError {
    pub stage: &'static str,
    pub hresult: i32,
    pub message: String,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} failed: 0x{:08X} {}", self.stage, self.hresult as u32, self.message)
    }
}

fn wrap(stage: &'static str) -> impl Fn(windows::core::Error) -> DecodeError {
    move |e| DecodeError { stage, hresult: e.code().0, message: e.message() }
}

fn io(stage: &'static str) -> impl Fn(std::io::Error) -> DecodeError {
    move |e| DecodeError { stage, hresult: 0, message: e.to_string() }
}

const STREAM: u32 = MF_SOURCE_READER_FIRST_AUDIO_STREAM.0 as u32;

unsafe fn pcm_type(subtype: &windows::core::GUID, rate: Option<u32>, channels: Option<u32>, bits: Option<u32>) -> windows::core::Result<IMFMediaType> {
    unsafe {
        let mt = MFCreateMediaType()?;
        mt.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        mt.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        if let (Some(rate), Some(channels), Some(bits)) = (rate, channels, bits) {
            let block = channels * bits / 8;
            mt.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, channels)?;
            mt.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate)?;
            mt.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, bits)?;
            mt.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, block)?;
            mt.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, rate * block)?;
        }
        Ok(mt)
    }
}

/// Decodes `input` into a 16-bit mono WAV at `output`. Set `force_native` to skip asking for 16 kHz.
pub fn decode_to_wav(input: &Path, output: &Path, force_native: bool) -> Result<DecodeReport, DecodeError> {
    let started = Instant::now();
    let input_bytes = std::fs::metadata(input).map(|m| m.len()).unwrap_or(0);
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(wrap("MFStartup"))?;
    }
    let result = unsafe { decode_inner(input, output, force_native) };
    unsafe {
        let _ = MFShutdown();
    }
    let (native_channels, native_sample_rate, resampled_by, output_sample_rate, output_samples) = result?;
    Ok(DecodeReport {
        decoder: "media-foundation".into(),
        input: input.display().to_string(),
        input_bytes,
        native_channels,
        native_sample_rate,
        resampled_by,
        output_sample_rate,
        output_samples,
        duration_sec: output_samples as f64 / output_sample_rate.max(1) as f64,
        wall_sec: started.elapsed().as_secs_f64(),
    })
}

unsafe fn decode_inner(input: &Path, output: &Path, force_native: bool) -> Result<(u32, u32, String, u32, u64), DecodeError> {
    unsafe {
        let url = HSTRING::from(input.as_os_str());
        let reader: IMFSourceReader =
            MFCreateSourceReaderFromURL(&url, None).map_err(wrap("opening the file (MFCreateSourceReaderFromURL)"))?;
        reader
            .SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS.0 as u32, false)
            .map_err(wrap("SetStreamSelection"))?;
        reader.SetStreamSelection(STREAM, true).map_err(wrap("selecting the audio stream"))?;
        let native = reader.GetNativeMediaType(STREAM, 0).map_err(wrap("reading the audio format"))?;
        let native_channels = native.GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS).unwrap_or(0);
        let native_rate = native.GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND).unwrap_or(0);

        // First choice: 16 kHz mono 16-bit, converted by the reader.
        let direct = !force_native
            && pcm_type(&MFAudioFormat_PCM, Some(16_000), Some(1), Some(16))
                .and_then(|mt| reader.SetCurrentMediaType(STREAM, None, &mt))
                .is_ok();
        let (rate, channels, float) = if direct {
            let current = reader.GetCurrentMediaType(STREAM).map_err(wrap("GetCurrentMediaType"))?;
            let rate = current.GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND).unwrap_or(0);
            let channels = current.GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS).unwrap_or(0);
            (rate, channels, false)
        } else {
            let mt = pcm_type(&MFAudioFormat_Float, None, None, None).map_err(wrap("MFCreateMediaType"))?;
            reader.SetCurrentMediaType(STREAM, None, &mt).map_err(wrap("asking for PCM (SetCurrentMediaType)"))?;
            let current = reader.GetCurrentMediaType(STREAM).map_err(wrap("GetCurrentMediaType"))?;
            let rate = current.GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND).unwrap_or(native_rate);
            let channels = current.GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS).unwrap_or(native_channels);
            (rate, channels, true)
        };
        if rate == 0 || channels == 0 {
            return Err(DecodeError { stage: "reading the output format", hresult: 0, message: "no rate or channels".into() });
        }
        let direct_ok = direct && rate == 16_000 && channels == 1;
        let mut writer = Pcm16Writer::create(output, 1, rate).map_err(io("creating the WAV file"))?;
        let mut frames: u64 = 0;
        loop {
            let mut flags = 0u32;
            let mut sample = None;
            reader
                .ReadSample(STREAM, 0, None, Some(&mut flags), None, Some(&mut sample))
                .map_err(wrap("decoding (ReadSample)"))?;
            if let Some(sample) = sample {
                let buffer = sample.ConvertToContiguousBuffer().map_err(wrap("ConvertToContiguousBuffer"))?;
                let mut ptr = std::ptr::null_mut();
                let mut len = 0u32;
                buffer.Lock(&mut ptr, None, Some(&mut len)).map_err(wrap("Lock"))?;
                let bytes = std::slice::from_raw_parts(ptr, len as usize);
                let result = if float {
                    let all = std::slice::from_raw_parts(bytes.as_ptr() as *const f32, bytes.len() / 4);
                    let mono: Vec<f32> = all
                        .chunks_exact(channels as usize)
                        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                        .collect();
                    frames += mono.len() as u64;
                    writer.write_f32(&mono)
                } else {
                    let all = std::slice::from_raw_parts(bytes.as_ptr() as *const i16, bytes.len() / 2);
                    if channels == 1 {
                        frames += all.len() as u64;
                        writer.write_i16(all)
                    } else {
                        let mono: Vec<i16> = all
                            .chunks_exact(channels as usize)
                            .map(|f| (f.iter().map(|&s| s as i32).sum::<i32>() / channels as i32) as i16)
                            .collect();
                        frames += mono.len() as u64;
                        writer.write_i16(&mono)
                    }
                };
                buffer.Unlock().map_err(wrap("Unlock"))?;
                result.map_err(io("writing the WAV file"))?;
            }
            if flags & (MF_SOURCE_READERF_ENDOFSTREAM.0 as u32) != 0 {
                break;
            }
        }
        writer.finish().map_err(io("finishing the WAV file"))?;
        let how = if direct_ok { "media-foundation" } else { "native-rate" };
        Ok((native_channels, native_rate, how.into(), rate, frames))
    }
}
