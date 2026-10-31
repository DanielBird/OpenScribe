// Writes the deterministic 16 kHz, mono, 16-bit PCM test recordings for the e2e tests:
// - fixtures/audio/tone-5s.wav: a 5 s, 440 Hz tone (Setup reads its duration as 00:00:05).
// - fixtures/audio/tone-12s.wav: 12 s whose pitch changes every 3 s, matching the turns of
//   fixtures/elevenlabs/tone-12s.json (playback tests).
// - fixtures/audio/blip-50ms.wav: 50 ms, shorter than ElevenLabs' 100 ms minimum (robustness tests).
// Edit this script and re-run it rather than editing the WAVs.
// Usage: node scripts/make-test-audio.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 16_000;
const AMPLITUDE = 0.2; // of full scale; quiet enough not to startle anyone who plays it

const OUT_DIR = new URL('../fixtures/audio/', import.meta.url);

/** `segments` is a list of [seconds, frequency] played one after the other. */
function toneWav(segments, sampleRate, amplitude) {
  const samples = segments.reduce((n, [seconds]) => n + seconds * sampleRate, 0);
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  // RIFF/WAVE header, PCM format chunk, data chunk.
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);

  // The phase carries over between segments, so a pitch change doesn't click.
  let i = 0;
  let phase = 0;
  for (const [seconds, frequency] of segments) {
    for (let s = 0; s < seconds * sampleRate; s++, i++) {
      buf.writeInt16LE(Math.round(Math.sin(phase) * amplitude * 32767), 44 + i * 2);
      phase += (2 * Math.PI * frequency) / sampleRate;
    }
  }
  return buf;
}

function write(name, segments) {
  const file = new URL(name, OUT_DIR);
  const wav = toneWav(segments, SAMPLE_RATE, AMPLITUDE);
  writeFileSync(file, wav);
  console.log(`wrote ${fileURLToPath(file)} (${wav.length} bytes)`);
}

mkdirSync(OUT_DIR, { recursive: true });
write('tone-5s.wav', [[5, 440]]);
write('tone-12s.wav', [
  [3, 330],
  [3, 440],
  [3, 330],
  [3, 523],
]);
write('blip-50ms.wav', [[0.05, 440]]);
