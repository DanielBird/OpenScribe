//! Decoding a recording to mono samples with Windows' Media Foundation (DECISIONS.md D51): any format Windows plays,
//! in constant memory, with nothing to ship or licence. From Phase 33's `harness/src/decode.rs`, which wrote a WAV
//! file; here the samples go straight to the engine, so nothing is written to disk.
//!
//! The reader is asked for 16 kHz mono 16-bit PCM, which it converts to itself. If it refuses, it gives floats at the
//! file's own rate, mixed down to mono here; the engine resamples any rate from 8 to 96 kHz itself.

/// A decoding failure: the stage, Media Foundation's HRESULT (0 for others) and its message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeError {
  pub stage: &'static str,
  pub hresult: i32,
  pub message: String,
}

impl DecodeError {
  /// Media Foundation can't read this kind of file (MF_E_UNSUPPORTED_BYTESTREAM_TYPE), as for Ogg Opus.
  pub const UNSUPPORTED_BYTESTREAM: i32 = 0xC00D36C4_u32 as i32;

  /// A detail for D41's Technical details.
  pub fn detail(&self) -> String {
    format!("{} failed: 0x{:08X} {}", self.stage, self.hresult as u32, self.message.trim())
  }
}

#[cfg(windows)]
pub use native::Decoder;

#[cfg(windows)]
mod native {
  use super::DecodeError;
  use std::path::Path;
  use windows::Win32::Media::MediaFoundation::*;
  use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
  use windows::Win32::System::Variant::VT_UI8;
  use windows::core::HSTRING;

  const STREAM: u32 = MF_SOURCE_READER_FIRST_AUDIO_STREAM.0 as u32;
  const MEDIA_SOURCE: u32 = MF_SOURCE_READER_MEDIASOURCE.0 as u32;

  fn wrap(stage: &'static str) -> impl Fn(windows::core::Error) -> DecodeError {
    move |e| DecodeError { stage, hresult: e.code().0, message: e.message() }
  }

  /// An open recording. Use it on the thread that opened it (Media Foundation and COM are set up per thread).
  pub struct Decoder {
    /// Always `Some` until Drop, which releases it before shutting Media Foundation down.
    reader: Option<IMFSourceReader>,
    rate: u32,
    channels: u32,
    float: bool,
    duration_sec: Option<f64>,
    finished: bool,
    com: bool,
  }

  impl Decoder {
    pub fn open(path: &Path) -> Result<Self, DecodeError> {
      // SAFETY: COM and Media Foundation are started for this thread and stopped in Drop.
      unsafe {
        let com = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        if let Err(e) = MFStartup(MF_VERSION, MFSTARTUP_FULL) {
          if com {
            CoUninitialize();
          }
          return Err(wrap("starting Media Foundation (MFStartup)")(e));
        }
        match Self::open_reader(path) {
          Ok((reader, rate, channels, float, duration_sec)) => {
            Ok(Self { reader: Some(reader), rate, channels, float, duration_sec, finished: false, com })
          }
          Err(e) => {
            let _ = MFShutdown();
            if com {
              CoUninitialize();
            }
            Err(e)
          }
        }
      }
    }

    unsafe fn open_reader(path: &Path) -> Result<(IMFSourceReader, u32, u32, bool, Option<f64>), DecodeError> {
      // SAFETY: plain Media Foundation calls on objects this function owns.
      unsafe {
        let url = HSTRING::from(path.as_os_str());
        let reader: IMFSourceReader =
          MFCreateSourceReaderFromURL(&url, None).map_err(wrap("opening the file (MFCreateSourceReaderFromURL)"))?;
        reader.SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS.0 as u32, false).map_err(wrap("SetStreamSelection"))?;
        reader.SetStreamSelection(STREAM, true).map_err(wrap("selecting the audio stream"))?;
        let native = reader.GetNativeMediaType(STREAM, 0).map_err(wrap("reading the audio format"))?;
        let native_channels = native.GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS).unwrap_or(0);
        let native_rate = native.GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND).unwrap_or(0);

        let direct = pcm_type(&MFAudioFormat_PCM, Some((16_000, 1, 16)))
          .and_then(|mt| reader.SetCurrentMediaType(STREAM, None, &mt))
          .is_ok();
        if !direct {
          let mt = pcm_type(&MFAudioFormat_Float, None).map_err(wrap("MFCreateMediaType"))?;
          reader.SetCurrentMediaType(STREAM, None, &mt).map_err(wrap("asking for PCM (SetCurrentMediaType)"))?;
        }
        let current = reader.GetCurrentMediaType(STREAM).map_err(wrap("GetCurrentMediaType"))?;
        let rate = current.GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND).unwrap_or(native_rate);
        let channels = current.GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS).unwrap_or(native_channels);
        if rate == 0 || channels == 0 {
          return Err(DecodeError { stage: "reading the output format", hresult: 0, message: "no rate or channels".into() });
        }
        let duration_sec = reader.GetPresentationAttribute(MEDIA_SOURCE, &MF_PD_DURATION).ok().and_then(|value| {
          let inner = &value.Anonymous.Anonymous;
          (inner.vt == VT_UI8).then(|| inner.Anonymous.uhVal as f64 / 10_000_000.0)
        });
        Ok((reader, rate, channels, !direct, duration_sec.filter(|d| *d > 0.0)))
      }
    }

    /// Samples a second, of what `next_block` returns.
    pub fn rate(&self) -> u32 {
      self.rate
    }

    /// The recording's length as the file states it, if it does.
    pub fn duration_sec(&self) -> Option<f64> {
      self.duration_sec
    }

    /// Appends the next decoded samples (mono, -1..1) to `out`. Returns false at the end of the recording.
    pub fn next_block(&mut self, out: &mut Vec<f32>) -> Result<bool, DecodeError> {
      let Some(reader) = self.reader.as_ref().filter(|_| !self.finished) else { return Ok(false) };
      // SAFETY: the buffer is locked while it is read and unlocked before the sample is dropped.
      unsafe {
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
          let channels = self.channels as usize;
          if self.float {
            let all = std::slice::from_raw_parts(bytes.as_ptr() as *const f32, bytes.len() / 4);
            out.extend(all.chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32));
          } else {
            let all = std::slice::from_raw_parts(bytes.as_ptr() as *const i16, bytes.len() / 2);
            out.extend(
              all.chunks_exact(channels).map(|f| f.iter().map(|&s| s as f32).sum::<f32>() / (channels as f32 * 32768.0)),
            );
          }
          buffer.Unlock().map_err(wrap("Unlock"))?;
        }
        if flags & (MF_SOURCE_READERF_ENDOFSTREAM.0 as u32) != 0 {
          self.finished = true;
        }
        Ok(true)
      }
    }
  }

  impl Drop for Decoder {
    fn drop(&mut self) {
      self.reader = None;
      // SAFETY: matches open(), after the reader is released.
      unsafe {
        let _ = MFShutdown();
        if self.com {
          CoUninitialize();
        }
      }
    }
  }

  unsafe fn pcm_type(subtype: &windows::core::GUID, format: Option<(u32, u32, u32)>) -> windows::core::Result<IMFMediaType> {
    // SAFETY: a new media type, owned by the caller.
    unsafe {
      let mt = MFCreateMediaType()?;
      mt.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
      mt.SetGUID(&MF_MT_SUBTYPE, subtype)?;
      if let Some((rate, channels, bits)) = format {
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
}

#[cfg(all(test, windows))]
mod tests {
  use super::*;
  use std::path::PathBuf;

  fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("fixtures").join("audio").join(name)
  }

  #[test]
  fn decodes_the_test_recording_to_16_khz_mono_of_the_right_length() {
    let mut decoder = Decoder::open(&fixture("tone-5s.wav")).unwrap();
    assert_eq!(decoder.rate(), 16_000);
    let stated = decoder.duration_sec().unwrap();
    assert!((stated - 5.0).abs() < 0.05, "stated {stated}");
    let mut samples = Vec::new();
    while decoder.next_block(&mut samples).unwrap() {}
    let seconds = samples.len() as f64 / 16_000.0;
    assert!((seconds - 5.0).abs() < 0.05, "decoded {seconds} s");
    assert!(samples.iter().all(|s| (-1.0..=1.0).contains(s)));
    assert!(samples.iter().any(|s| s.abs() > 0.1), "the tone is audible");
  }

  #[test]
  fn a_file_that_isnt_audio_fails_with_its_stage() {
    let not_audio = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let error = Decoder::open(&not_audio).err().unwrap();
    assert!(error.hresult != 0);
    assert!(error.detail().contains("failed: 0x"));
  }
}
