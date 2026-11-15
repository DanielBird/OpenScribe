//! Long recordings in pieces for the words model (Phase 33, M4): 30 s pieces that overlap by 2 s, each keeping the
//! words whose middle falls in its own part, so half of each overlap goes to each neighbour and every word is kept
//! once. 2.5× faster than the engine's own full-context pass. A port of `stt-bench.rs` `merge_chunks`.

pub const PIECE_SEC: f64 = 30.0;
pub const OVERLAP_SEC: f64 = 2.0;

/// One piece of audio and where it sits in the recording.
#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
  pub start_sec: f64,
  pub samples: Vec<f32>,
  pub first: bool,
  pub last: bool,
}

impl Piece {
  pub fn len_sec(&self, rate: u32) -> f64 {
    self.samples.len() as f64 / rate as f64
  }

  /// The part of the recording whose words this piece keeps: from 1 s into it (not for the first) to 1 s before its
  /// end (not for the last). Neighbouring parts meet exactly, so they tile the recording.
  pub fn own_part(&self, rate: u32) -> (f64, f64) {
    let own_start = if self.first { f64::NEG_INFINITY } else { self.start_sec + OVERLAP_SEC / 2.0 };
    let own_end = if self.last { f64::INFINITY } else { self.start_sec + self.len_sec(rate) - OVERLAP_SEC / 2.0 };
    (own_start, own_end)
  }

  /// Whether a word at `start..end` seconds from the piece's start belongs to this piece.
  pub fn keeps(&self, rate: u32, start: f64, end: f64) -> bool {
    let (own_start, own_end) = self.own_part(rate);
    let middle = self.start_sec + (start + end) / 2.0;
    middle >= own_start && middle < own_end
  }
}

/// Cuts a stream of samples into pieces.
pub struct Chunker {
  rate: u32,
  len: usize,
  step: usize,
  buffer: Vec<f32>,
  start: u64,
  index: usize,
}

impl Chunker {
  pub fn new(rate: u32) -> Self {
    let len = (PIECE_SEC * rate as f64) as usize;
    let step = ((PIECE_SEC - OVERLAP_SEC) * rate as f64) as usize;
    Self { rate, len, step, buffer: Vec::with_capacity(len * 2), start: 0, index: 0 }
  }

  /// Adds samples, and returns the pieces now complete. A piece is complete once a sample after it has arrived, so
  /// the last one is only known at `finish`.
  pub fn push(&mut self, samples: &[f32]) -> Vec<Piece> {
    self.buffer.extend_from_slice(samples);
    let mut pieces = Vec::new();
    while self.buffer.len() > self.len {
      pieces.push(Piece {
        start_sec: self.start as f64 / self.rate as f64,
        samples: self.buffer[..self.len].to_vec(),
        first: self.index == 0,
        last: false,
      });
      self.buffer.drain(..self.step);
      self.start += self.step as u64;
      self.index += 1;
    }
    pieces
  }

  /// The last piece: what is left, which includes the overlap of the piece before it.
  pub fn finish(self) -> Option<Piece> {
    (!self.buffer.is_empty()).then(|| Piece {
      start_sec: self.start as f64 / self.rate as f64,
      samples: self.buffer,
      first: self.index == 0,
      last: true,
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const RATE: u32 = 100; // 100 samples a second keeps the tests small

  fn pieces_of(seconds: f64, block: usize) -> Vec<Piece> {
    let total = (seconds * RATE as f64) as usize;
    let samples: Vec<f32> = (0..total).map(|i| i as f32).collect();
    let mut chunker = Chunker::new(RATE);
    let mut pieces = Vec::new();
    for part in samples.chunks(block) {
      pieces.extend(chunker.push(part));
    }
    pieces.extend(chunker.finish());
    pieces
  }

  #[test]
  fn a_short_recording_is_one_piece() {
    let pieces = pieces_of(12.0, 37);
    assert_eq!(pieces.len(), 1);
    assert!(pieces[0].first && pieces[0].last);
    assert_eq!(pieces[0].own_part(RATE), (f64::NEG_INFINITY, f64::INFINITY));
    assert_eq!(pieces_of(30.0, 1000).len(), 1, "exactly 30 s is still one piece");
  }

  #[test]
  fn pieces_overlap_by_two_seconds_and_cover_every_sample() {
    for block in [1, 77, 1000, 10_000] {
      let pieces = pieces_of(100.0, block);
      assert_eq!(pieces.len(), 4, "block {block}"); // 0–30, 28–58, 56–86, 84–100
      assert_eq!(pieces.iter().map(|p| p.start_sec).collect::<Vec<_>>(), vec![0.0, 28.0, 56.0, 84.0]);
      assert!(pieces[0].first && !pieces[0].last && pieces[3].last && !pieces[3].first);
      for pair in pieces.windows(2) {
        let end = pair[0].start_sec + pair[0].len_sec(RATE);
        assert!((end - pair[1].start_sec - OVERLAP_SEC).abs() < 1e-9);
        // The samples really are the recording's: the first of each piece is its start.
        assert_eq!(pair[1].samples[0] as f64, pair[1].start_sec * RATE as f64);
      }
      let last = pieces.last().unwrap();
      assert_eq!(*last.samples.last().unwrap() as usize, 100 * RATE as usize - 1);
    }
  }

  #[test]
  fn own_parts_tile_the_recording_with_no_gap() {
    let pieces = pieces_of(100.0, 500);
    for pair in pieces.windows(2) {
      assert_eq!(pair[0].own_part(RATE).1, pair[1].own_part(RATE).0);
    }
    assert_eq!(pieces[1].own_part(RATE), (29.0, 57.0));
  }

  #[test]
  fn each_word_is_kept_by_exactly_one_piece() {
    let pieces = pieces_of(100.0, 333);
    // Words every 0.25 s, 0.3 s long, in recording time; each piece sees those inside it.
    let mut t = 0.0;
    while t + 0.3 < 100.0 {
      let keepers = pieces
        .iter()
        .filter(|p| t >= p.start_sec && t + 0.3 <= p.start_sec + p.len_sec(RATE))
        .filter(|p| p.keeps(RATE, t - p.start_sec, t + 0.3 - p.start_sec))
        .count();
      assert_eq!(keepers, 1, "word at {t}");
      t += 0.25;
    }
  }

  #[test]
  fn an_empty_recording_has_no_pieces() {
    assert!(pieces_of(0.0, 10).is_empty());
  }
}
