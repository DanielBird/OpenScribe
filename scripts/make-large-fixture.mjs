// Writes fixtures/large/large-3h.json: a synthetic ElevenLabs response for a 3-hour, 4-speaker meeting
// (about 2000 turns and 25k words), for the performance tests in tests/e2e/large-transcript.perf.ts.
// Deterministic (seeded), so every run measures the same transcript. The file is about 5 MB and is
// gitignored; `npm run test:perf` regenerates it.
// Usage: node scripts/make-large-fixture.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../fixtures/large/', import.meta.url));
const OUT_FILE = `${OUT_DIR}large-3h.json`;

const SPEAKERS = 4;
const TARGET_WORDS = 25_000;
const WORD_SEC = 0.3;
const GAP_SEC = 0.1;
const PAUSE_SEC = 0.6;
/** Every this many utterances, one speaker talks for over 90 s, so segmentation splits the turn. */
const MONOLOGUE_EVERY = 120;

// mulberry32: a small seeded PRNG.
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

const random = prng(20261014);
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[Math.floor(random() * list.length)];

const VOCABULARY = (
  'the a we our team project hearing aid device patient clinic test result results week month plan ' +
  'should could would will need want think know see sound quality battery app user users feedback ' +
  'design prototype launch market customer customers study data report meeting question answer ' +
  'early late next last first second third really quite very more less better worse good new old ' +
  'because so and but then also still already maybe perhaps definitely probably fitting audiologist ' +
  'noise speech background program settings update software firmware release schedule budget'
).split(' ');
const ENDINGS = ['.', '.', '.', '.', '?', '!'];

const r = (x) => Math.round(x * 1000) / 1000;

/** One sentence of `n` words, capitalised, with an ending. */
function sentence(n) {
  const words = Array.from({ length: n }, () => pick(VOCABULARY));
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  words[n - 1] += pick(ENDINGS);
  return words;
}

const tokens = [];
let t = 0.2;
let wordCount = 0;
let utterances = 0;
let speaker = 0;

while (wordCount < TARGET_WORDS) {
  const long = utterances > 0 && utterances % MONOLOGUE_EVERY === 0;
  const sentences = long ? int(20, 28) : int(1, 2);
  const words = Array.from({ length: sentences }, () => sentence(int(4, long ? 14 : 9))).flat();
  const id = `speaker_${speaker}`;
  words.forEach((text, i) => {
    tokens.push({
      text,
      start: r(t),
      end: r(t + WORD_SEC),
      type: 'word',
      speaker_id: id,
      logprob: -r(random() * 0.2),
    });
    t += WORD_SEC;
    const gap = i === words.length - 1 ? PAUSE_SEC : GAP_SEC;
    tokens.push({
      text: ' ',
      start: r(t),
      end: r(t + gap),
      type: 'spacing',
      speaker_id: id,
      logprob: 0,
    });
    t += gap;
  });
  wordCount += words.length;
  utterances++;
  // The next utterance is by someone else.
  speaker = (speaker + int(1, SPEAKERS - 1)) % SPEAKERS;
}
tokens.pop(); // no trailing spacing

const response = {
  language_code: 'eng',
  language_probability: 0.98,
  text: tokens.map((w) => w.text).join(''),
  transcription_id: 'fixture-large-3h',
  audio_duration_secs: r(t + 0.5),
  words: tokens,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(response));
const hours = (t / 3600).toFixed(2);
console.log(
  `wrote fixtures/large/large-3h.json: ${wordCount} words, ${utterances} utterances, ${SPEAKERS} speakers, ${hours} h`,
);
