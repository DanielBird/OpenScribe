//! Minimal PCM WAV: read the header of a file, and write 16-bit PCM in constant memory.

use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WavInfo {
    pub format: u16, // 1 = PCM, 3 = IEEE float
    pub channels: u16,
    pub sample_rate: u32,
    pub bits: u16,
    pub data_bytes: u64,
    /// Where the samples start in the file.
    pub data_offset: u64,
}

impl WavInfo {
    pub fn duration_sec(&self) -> f64 {
        let frame = self.channels as u64 * (self.bits as u64 / 8);
        if frame == 0 || self.sample_rate == 0 {
            return 0.0;
        }
        (self.data_bytes / frame) as f64 / self.sample_rate as f64
    }

    /// What nemo-speech's file CLI reads directly: PCM16 or float32, mono or stereo, 8–96 kHz.
    pub fn readable_by_cli(&self) -> bool {
        let ok_format = (self.format == 1 && self.bits == 16) || (self.format == 3 && self.bits == 32);
        ok_format && (1..=2).contains(&self.channels) && (8_000..=96_000).contains(&self.sample_rate)
    }
}

/// The `fmt ` and `data` chunks of a RIFF/WAVE file, or `None` if it isn't one.
pub fn read_info(path: &Path) -> Option<WavInfo> {
    let mut f = File::open(path).ok()?;
    let mut riff = [0u8; 12];
    f.read_exact(&mut riff).ok()?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return None;
    }
    let mut fmt: Option<(u16, u16, u32, u16)> = None;
    loop {
        let mut header = [0u8; 8];
        if f.read_exact(&mut header).is_err() {
            return None;
        }
        let size = u32::from_le_bytes(header[4..8].try_into().ok()?) as u64;
        match &header[0..4] {
            b"fmt " => {
                let mut body = vec![0u8; size as usize];
                f.read_exact(&mut body).ok()?;
                let mut format = u16::from_le_bytes([body[0], body[1]]);
                if format == 0xFFFE && body.len() >= 26 {
                    // WAVE_FORMAT_EXTENSIBLE: the sub-format GUID starts with the real format code.
                    format = u16::from_le_bytes([body[24], body[25]]);
                }
                let channels = u16::from_le_bytes([body[2], body[3]]);
                let rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
                let bits = u16::from_le_bytes([body[14], body[15]]);
                fmt = Some((format, channels, rate, bits));
                if size % 2 == 1 {
                    f.seek(SeekFrom::Current(1)).ok()?;
                }
            }
            b"data" => {
                let (format, channels, sample_rate, bits) = fmt?;
                let data_offset = f.stream_position().ok()?;
                // Some writers leave 0 or 0xFFFFFFFF for a stream of unknown length: take the rest of the file.
                let file_len = f.metadata().ok()?.len();
                let data_bytes = if size == 0 || data_offset + size > file_len { file_len - data_offset } else { size };
                return Some(WavInfo { format, channels, sample_rate, bits, data_bytes, data_offset });
            }
            _ => {
                f.seek(SeekFrom::Current((size + size % 2) as i64)).ok()?;
            }
        }
    }
}

/// Writes mono or stereo 16-bit PCM, patching the sizes into the header at the end.
pub struct Pcm16Writer {
    out: BufWriter<File>,
    channels: u16,
    sample_rate: u32,
    data_bytes: u64,
}

impl Pcm16Writer {
    pub fn create(path: &Path, channels: u16, sample_rate: u32) -> std::io::Result<Pcm16Writer> {
        let mut out = BufWriter::with_capacity(1 << 20, File::create(path)?);
        out.write_all(&[0u8; 44])?;
        Ok(Pcm16Writer { out, channels, sample_rate, data_bytes: 0 })
    }

    pub fn write_i16(&mut self, samples: &[i16]) -> std::io::Result<()> {
        // Little-endian on every target this runs on.
        let bytes = unsafe { std::slice::from_raw_parts(samples.as_ptr() as *const u8, samples.len() * 2) };
        self.out.write_all(bytes)?;
        self.data_bytes += bytes.len() as u64;
        Ok(())
    }

    pub fn write_f32(&mut self, samples: &[f32]) -> std::io::Result<()> {
        let converted: Vec<i16> =
            samples.iter().map(|s| (s.clamp(-1.0, 1.0) * 32767.0).round() as i16).collect();
        self.write_i16(&converted)
    }

    pub fn finish(mut self) -> std::io::Result<u64> {
        self.out.flush()?;
        let mut f = self.out.into_inner().map_err(|e| e.into_error())?;
        let block = self.channels as u32 * 2;
        let data = self.data_bytes.min(u32::MAX as u64 - 36) as u32;
        let mut h = Vec::with_capacity(44);
        h.extend_from_slice(b"RIFF");
        h.extend_from_slice(&(36 + data).to_le_bytes());
        h.extend_from_slice(b"WAVEfmt ");
        h.extend_from_slice(&16u32.to_le_bytes());
        h.extend_from_slice(&1u16.to_le_bytes());
        h.extend_from_slice(&self.channels.to_le_bytes());
        h.extend_from_slice(&self.sample_rate.to_le_bytes());
        h.extend_from_slice(&(self.sample_rate * block).to_le_bytes());
        h.extend_from_slice(&(block as u16).to_le_bytes());
        h.extend_from_slice(&16u16.to_le_bytes());
        h.extend_from_slice(b"data");
        h.extend_from_slice(&data.to_le_bytes());
        f.seek(SeekFrom::Start(0))?;
        f.write_all(&h)?;
        Ok(self.data_bytes)
    }
}

/// Copies samples [start, start + count) of a 16-bit PCM WAV into a new WAV file, reading only that range.
pub fn copy_range(src: &Path, info: &WavInfo, start: u64, count: u64, dst: &Path) -> std::io::Result<u64> {
    let frame = info.channels as u64 * 2;
    let total = info.data_bytes / frame;
    let start = start.min(total);
    let count = count.min(total - start);
    let mut f = File::open(src)?;
    f.seek(SeekFrom::Start(info.data_offset + start * frame))?;
    let mut writer = Pcm16Writer::create(dst, info.channels, info.sample_rate)?;
    let mut left = count * frame;
    let mut buf = vec![0u8; 1 << 20];
    while left > 0 {
        let n = (left as usize).min(buf.len());
        f.read_exact(&mut buf[..n])?;
        let samples: Vec<i16> = buf[..n].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
        writer.write_i16(&samples)?;
        left -= n as u64;
    }
    writer.finish()?;
    Ok(count)
}
