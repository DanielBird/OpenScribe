// Phase 33 spike, maintainer task 1: compares every transcription run in out/runs/ with the ElevenLabs reference.
// Given the DeScribe session file of tests/audio/test_audio.m4a (from Add to project), it makes the shifted references
// for the 5-minute, 1-hour and 3-hour test files (make-test-set.mjs), then runs compare.mjs on each run whose length
// matches one of them, with the speakers merged from the diarization segments (as Phase 34 would). The transcripts it
// writes to out/transcripts/ are for task 9.
// Usage: node scripts/spikes/local-stt/compare-all.mjs <sessions/….transcript.json> [recording=tests/audio/test_audio.m4a]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [
  referenceArg,
  recordingArg = join(HERE, '..', '..', '..', 'tests', 'audio', 'test_audio.m4a'),
] = process.argv.slice(2);
if (!referenceArg || !existsSync(referenceArg)) {
  console.error('Usage: node compare-all.mjs <the session file of test_audio.m4a> [recording]');
  process.exit(1);
}
const reference = resolve(referenceArg);
execFileSync(
  process.execPath,
  [join(HERE, 'make-test-set.mjs'), resolve(recordingArg), reference],
  { stdio: 'inherit' },
);

const set = join(HERE, 'out', 'test-set');
const references = [
  { seconds: 300, file: join(set, 'test_audio.5min.reference.json') },
  { seconds: 3600, file: join(set, 'test_audio.1h.reference.json') },
  { seconds: 10800, file: join(set, 'test_audio.3h.reference.json') },
];
const runsDir = join(HERE, 'out', 'runs');
let count = 0;
for (const name of readdirSync(runsDir)
  .filter((f) => f.endsWith('.json') && !f.endsWith('.engine.json'))
  .sort()) {
  const run = JSON.parse(readFileSync(join(runsDir, name), 'utf8'));
  if (run.tool !== 'stt-bench' || !(run.result?.words?.length > 0)) continue;
  const seconds = run.audio?.durationSec ?? 0;
  const ref =
    Math.abs(seconds - 2242.3) < 2
      ? reference
      : references.find((r) => Math.abs(r.seconds - seconds) < 2)?.file;
  if (!ref) continue;
  const segments = run.result?.speakerSegments?.segments?.length > 0;
  const args = [
    join(HERE, 'compare.mjs'),
    join(runsDir, name),
    ref,
    '--label',
    `${run.label}.vs-elevenlabs`,
  ];
  if (segments) args.push('--segments');
  execFileSync(process.execPath, args, { stdio: 'inherit' });
  count++;
}
execFileSync(process.execPath, [join(HERE, 'summarize.mjs')], { stdio: 'inherit' });
console.log(`Compared ${count} runs. Transcripts: out/transcripts/*.vs-elevenlabs.txt`);
