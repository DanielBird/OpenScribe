// Phase 10 spike: writes `count` session transcript files of about `mb` MB each into
// <folder>/sessions/, for the read timings of scripts/spikes/fsa-probe.html (checks F7–F9, F11 in
// docs/reference/file-system-access.md). Each file has the PROJECTS.md §5.2 shape,
// `{ kind: 'describe.transcript', schemaVersion: 1, savedAt, doc }`, where `doc` is a TranscriptDoc of
// random English text with word timings. At 0.7 MB that is about an hour of speech (PROJECTS.md §3).
// Deterministic (seeded): running it again overwrites the same files instead of adding more.
// Usage: node scripts/spikes/make-probe-files.mjs <folder> [count=300] [mb=0.7]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [folderArg, countArg = '300', mbArg = '0.7'] = process.argv.slice(2);
const count = Number(countArg);
const targetMb = Number(mbArg);
if (!folderArg || !Number.isInteger(count) || count < 1 || !(targetMb > 0)) {
  console.error('Usage: node scripts/spikes/make-probe-files.mjs <folder> [count=300] [mb=0.7]');
  process.exit(1);
}
// "$env:OneDriveCommercial\Describe probe" with an empty variable becomes "\Describe probe", which
// would resolve to the root of the current drive.
if (/^[\\/](?![\\/])/.test(folderArg)) {
  console.error(
    `"${folderArg}" starts at the root of the drive: is the environment variable empty? ` +
      'Give the full path, e.g. "C:\\Users\\<you>\\OneDrive - Demant\\Describe probe".',
  );
  process.exit(1);
}

const SESSIONS_DIR = join(resolve(folderArg), 'sessions');
const TARGET_BYTES = targetMb * 1024 * 1024;
const SPEAKERS = 3;
const WORD_SEC = 0.3;
const GAP_SEC = 0.1;
const PAUSE_SEC = 0.6;

// mulberry32: a small seeded PRNG (as in scripts/make-large-fixture.mjs).
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCABULARY = (
  'the a we our I you it they hearing aid aids device battery charger charge night bedside ' +
  'routine phone app sound quality clinic audiologist fitting home visit family restaurant ' +
  'noise speech background program settings update quiet loud music television friends work ' +
  'because so and but then also still already maybe perhaps really quite very more less ' +
  'better worse good new old first last morning evening week month always never sometimes'
).split(' ');
const ENDINGS = ['.', '.', '.', '.', '?', '!'];

const r = (x) => Math.round(x * 1000) / 1000;

/** A uuid-shaped id from the PRNG, so file names are the same on every run. */
function seededUuid(random) {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function makeSession(index) {
  const random = prng(20261015 + index);
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const pick = (list) => list[Math.floor(random() * list.length)];

  const id = seededUuid(random);
  const label = `P${String(index + 1).padStart(3, '0')}`;
  const turns = [];
  let t = 0.4;
  let bytes = 2000; // the doc's other fields
  let speaker = 0;

  while (bytes < TARGET_BYTES) {
    const words = [];
    for (let s = int(1, 4); s > 0; s--) {
      const n = int(4, 14);
      for (let i = 0; i < n; i++) {
        let text = pick(VOCABULARY);
        if (i === 0) text = text[0].toUpperCase() + text.slice(1);
        if (i === n - 1) text += pick(ENDINGS);
        words.push({ text, start: r(t), end: r(t + WORD_SEC), logprob: -r(random() * 0.2) });
        t += WORD_SEC + GAP_SEC;
      }
    }
    t += PAUSE_SEC;
    const turn = {
      id: `t${turns.length + 1}`,
      speakerId: `speaker_${speaker}`,
      start: words[0].start,
      end: words.at(-1).end,
      text: words.map((w) => w.text).join(' '),
      words,
    };
    turns.push(turn);
    bytes += JSON.stringify(turn).length + 1;
    speaker = (speaker + int(1, SPEAKERS - 1)) % SPEAKERS;
  }

  const durationSec = r(t);
  const createdAt = new Date(Date.UTC(2026, 9, 1) + index * 3_600_000).toISOString();
  const doc = {
    schemaVersion: 1,
    id,
    createdAt,
    source: {
      fileName: `${label} probe session.m4a`,
      fileSize: Math.round(durationSec * 16_000),
      mimeType: 'audio/mp4',
      lastModified: Date.parse(createdAt),
      durationSec,
    },
    request: {
      provider: 'elevenlabs',
      model: 'scribe_v2',
      languageHint: 'auto',
      numSpeakers: null,
      zeroRetention: false,
      keyterms: [],
    },
    result: {
      providerTranscriptId: `probe-${index + 1}`,
      languageCode: 'eng',
      languageProbability: 0.98,
      audioDurationSec: durationSec,
    },
    speakers: Array.from({ length: SPEAKERS }, (_, i) => ({
      id: `speaker_${i}`,
      label: `Speaker ${i + 1}`,
    })),
    turns,
    translations: {},
  };
  const file = { kind: 'describe.transcript', schemaVersion: 1, savedAt: createdAt, doc };
  return { name: `${label}-probe-session--${id.slice(0, 8)}.transcript.json`, file };
}

const t0 = performance.now();
mkdirSync(SESSIONS_DIR, { recursive: true });
let total = 0;
for (let i = 0; i < count; i++) {
  const { name, file } = makeSession(i);
  const json = JSON.stringify(file);
  writeFileSync(join(SESSIONS_DIR, name), json);
  total += Buffer.byteLength(json);
  if ((i + 1) % 50 === 0 && i + 1 < count) console.log(`${i + 1} of ${count}…`);
}
const sec = ((performance.now() - t0) / 1000).toFixed(1);
const mb = (total / 1024 / 1024).toFixed(1);
console.log(`wrote ${count} files, ${mb} MB, to ${SESSIONS_DIR} in ${sec} s`);
