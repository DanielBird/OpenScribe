// Phase 33 spike: the test set, made with ffmpeg from one recording, into out/test-set/ (gitignored).
//
// - <name>.5min.m4a: the first five minutes, copied without re-encoding.
// - <name>.1h.m4a and <name>.3h.m4a: the recording joined to itself until it is that long, then cut, also copied
//   without re-encoding. They are the fallback when no real one-hour or three-hour recordings are given. The same two
//   voices repeat, which is a fair test of whether a speaker keeps their label for three hours, but they are less
//   varied than a real recording: the reference doc says so wherever they are used.
// - With a reference (a DeScribe session file or TranscriptDoc for the original recording), a reference for each,
//   shifted by the same offsets: <name>.<length>.reference.json, which compare.mjs reads.
// - tone-3h.mp4: three hours of noise and tone as AAC in MP4, for the decoder's constant-memory check (Task 4).
//   Nothing private is in it.
//
// Usage: node scripts/spikes/local-stt/make-test-set.mjs <recording> [reference.json]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out', 'test-set');
const [recordingArg, referenceArg] = process.argv.slice(2);
if (!recordingArg) {
  console.error('Usage: node make-test-set.mjs <recording> [reference.json]');
  process.exit(1);
}
const recording = resolve(recordingArg);
const name = basename(recording, extname(recording));
mkdirSync(OUT, { recursive: true });

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
}

const duration = Number(
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    recording,
  ])
    .toString()
    .trim(),
);
if (!(duration > 0)) throw new Error(`ffprobe gave no duration for ${recording}`);
console.log(`${name}: ${duration.toFixed(1)} s`);

const lengths = [
  { tag: '5min', seconds: 300 },
  { tag: '1h', seconds: 3600 },
  { tag: '3h', seconds: 10800 },
];
for (const { tag, seconds } of lengths) {
  const target = join(OUT, `${name}.${tag}.m4a`);
  const copies = Math.ceil(seconds / duration);
  if (copies <= 1) {
    ffmpeg(['-i', recording, '-t', String(seconds), '-map', '0:a:0', '-c', 'copy', target]);
  } else {
    const list = join(OUT, `${name}.${tag}.concat.txt`);
    const line = `file '${recording.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\n`;
    writeFileSync(list, line.repeat(copies));
    ffmpeg([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-t',
      String(seconds),
      '-map',
      '0:a:0',
      '-c',
      'copy',
      target,
    ]);
  }
  console.log(`  ${basename(target)} (${copies > 1 ? `${copies} copies, cut` : 'cut'})`);
}

if (referenceArg) {
  const file = JSON.parse(readFileSync(resolve(referenceArg), 'utf8'));
  const doc = file.doc ?? file;
  const words = doc.turns.flatMap((turn) =>
    turn.words.map((w) => ({ text: w.text, start: w.start, end: w.end, speaker: turn.speakerId })),
  );
  for (const { tag, seconds } of lengths) {
    const copies = Math.ceil(seconds / duration);
    const shifted = [];
    for (let k = 0; k < copies; k++) {
      for (const w of words) {
        const start = w.start + k * duration;
        if (start >= seconds) break;
        shifted.push({ ...w, start, end: Math.min(w.end + k * duration, seconds) });
      }
    }
    const target = join(OUT, `${name}.${tag}.reference.json`);
    writeFileSync(
      target,
      JSON.stringify({
        kind: 'local-stt.reference',
        from: referenceArg,
        durationSec: seconds,
        words: shifted,
      }) + '\n',
    );
    console.log(`  ${basename(target)} (${shifted.length} words)`);
  }
}

const tone = join(OUT, 'tone-3h.mp4');
if (!existsSync(tone)) {
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=10800',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=color=pink:amplitude=0.05:sample_rate=48000:duration=10800',
    '-filter_complex',
    'amix=inputs=2:duration=shortest',
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    tone,
  ]);
  console.log('  tone-3h.mp4');
}
