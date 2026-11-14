// Phase 33 spike: compares one local transcript (a stt-bench JSON) with its ElevenLabs reference (M3, M6, M7, M12).
//
// The reference is a DeScribe session file (`sessions/*.transcript.json` from Add to project), a bare TranscriptDoc,
// or a reference made by make-test-set.mjs. Words are normalised (lowercase, punctuation removed) and aligned by
// edit distance, within a ±30 s band of time so a three-hour recording aligns in seconds. It reports:
// - the word error rate (substitutions + deletions + insertions over the reference's words), also without fillers
//   ("um", "uh", …), and how many tokens contain digits on each side (no ITN runs on Windows, so "25" against
//   "twenty five" counts as errors);
// - word-time offsets (local start − reference start) of matched words, in the first and last ten minutes (M3);
// - speaker agreement on matched words after mapping each local label to the reference speaker it overlaps most,
//   overall and per ten minutes (M6: does a label hold for three hours?). With --segments, the words are given the
//   speaker of the diarization segment they overlap most instead of the engine's own labels (M7: merged afterwards).
//
// Writes the metrics (no text) to out/compare/<label>.json and a readable transcript to out/transcripts/<label>.txt.
// Usage: node scripts/spikes/local-stt/compare.mjs <stt-bench.json> <reference.json> [--segments] [--label NAME]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WINDOW_SEC = 30;
const FILLERS = new Set([
  'um',
  'uh',
  'er',
  'erm',
  'ah',
  'eh',
  'hmm',
  'hm',
  'mm',
  'mhm',
  'uhhuh',
  'mmhmm',
]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--label');
if (positional.length < 2) {
  console.error(
    'Usage: node compare.mjs <stt-bench.json> <reference.json> [--segments] [--label NAME]',
  );
  process.exit(1);
}
const [hypPath, refPath] = positional;
const hyp = JSON.parse(readFileSync(hypPath, 'utf8'));
const refFile = JSON.parse(readFileSync(refPath, 'utf8'));
const label =
  option('--label') ??
  `${hyp.label ?? basename(hypPath, '.json')}${flag('--segments') ? '.merged' : ''}`;

/** Splits one word into normalised tokens, each keeping the word's times and speaker. */
function tokens(text, start, end, speaker) {
  return String(text)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((t) => ({ t, start, end, speaker }));
}

function referenceWords(file) {
  // Another stt-bench run, e.g. the engine's own whole-file pass against chunked words (M4's joins).
  if (file.tool === 'stt-bench') {
    return file.result.words.flatMap((w) => tokens(w.text, w.start, w.end, w.speaker ?? null));
  }
  if (Array.isArray(file.words)) {
    return file.words.flatMap((w) => tokens(w.text, w.start, w.end, w.speaker ?? null));
  }
  const doc = file.doc ?? file;
  if (!Array.isArray(doc.turns)) throw new Error(`${refPath}: no turns and no words`);
  return doc.turns.flatMap((turn) =>
    turn.words.flatMap((w) => tokens(w.text, w.start, w.end, turn.speakerId)),
  );
}

/** Each word gets the speaker of the segment it overlaps most, or of the nearest segment (Phase 34's mapper). */
function mergeSegments(words, segments) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  return words.map((w) => {
    let best = null;
    let bestOverlap = 0;
    let nearest = null;
    let nearestGap = Infinity;
    for (const s of sorted) {
      if (s.start > w.end + 30) break;
      const overlap = Math.min(w.end, s.end) - Math.max(w.start, s.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = s.speaker;
      }
      const gap = Math.max(s.start - w.end, w.start - s.end, 0);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = s.speaker;
      }
    }
    return { ...w, speaker: best ?? nearest };
  });
}

/** The speaker segments in a stt-bench result, whatever shape nemo-speech's diarize JSON has. */
function segmentsOf(result) {
  const raw = result?.speakerSegments;
  const list = Array.isArray(raw) ? raw : (raw?.segments ?? raw?.speakers ?? []);
  return list
    .map((s) => ({
      speaker: s.speaker ?? s.speaker_id ?? s.label,
      start: Number(s.start ?? s.start_time ?? s.begin),
      end: Number(s.end ?? s.end_time ?? s.stop),
    }))
    .filter((s) => s.speaker !== undefined && Number.isFinite(s.start) && Number.isFinite(s.end));
}

let hypWords = hyp.result?.words ?? [];
if (flag('--segments')) {
  const segments = segmentsOf(hyp.result);
  if (segments.length === 0) throw new Error(`${hypPath}: no speaker segments to merge`);
  hypWords = mergeSegments(hypWords, segments);
}
const H = hypWords.flatMap((w) => tokens(w.text, w.start, w.end, w.speaker ?? null));
const R = referenceWords(refFile);

/** First index in R whose start is ≥ t. */
function lowerBound(t) {
  let lo = 0;
  let hi = R.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (R[mid].start < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Banded edit distance. Row i (0..n) has consumed i hypothesis tokens; its band is the reference positions within
 * WINDOW_SEC of hypothesis token i's time, kept monotone so every row overlaps the next. Returns the operations.
 */
function align() {
  const n = H.length;
  const m = R.length;
  const bands = new Array(n + 1);
  let prevLo = 0;
  let prevHi = 0;
  for (let i = 0; i <= n; i++) {
    const t = i === 0 ? (H[0]?.start ?? 0) : H[i - 1].start;
    let lo = i === 0 ? 0 : lowerBound(t - WINDOW_SEC);
    let hi = i === n ? m : Math.min(m, lowerBound(t + WINDOW_SEC) + 1);
    lo = Math.max(lo, prevLo);
    lo = Math.min(lo, prevHi); // overlap the previous row
    hi = Math.max(hi, prevHi, lo);
    bands[i] = [lo, hi];
    prevLo = lo;
    prevHi = hi;
  }
  const ops = new Array(n + 1);
  let prev = null;
  let prevBand = null;
  for (let i = 0; i <= n; i++) {
    const [lo, hi] = bands[i];
    const row = new Float64Array(hi - lo + 1);
    const op = new Uint8Array(hi - lo + 1);
    for (let j = lo; j <= hi; j++) {
      const k = j - lo;
      if (i === 0) {
        row[k] = j;
        op[k] = 2;
        continue;
      }
      const up =
        prev && j >= prevBand[0] && j <= prevBand[1] ? prev[j - prevBand[0]] + 1 : Infinity;
      const left = j > lo ? row[k - 1] + 1 : Infinity;
      let diag = Infinity;
      if (j > 0 && prev && j - 1 >= prevBand[0] && j - 1 <= prevBand[1]) {
        diag = prev[j - 1 - prevBand[0]] + (H[i - 1].t === R[j - 1].t ? 0 : 1);
      }
      if (diag <= up && diag <= left) {
        row[k] = diag;
        op[k] = 0;
      } else if (up <= left) {
        row[k] = up;
        op[k] = 1;
      } else {
        row[k] = left;
        op[k] = 2;
      }
    }
    ops[i] = op;
    prev = row;
    prevBand = bands[i];
  }
  const pairs = [];
  let S = 0;
  let D = 0;
  let I = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const [lo] = bands[i];
    const o = j - lo >= 0 && j - lo < ops[i].length ? ops[i][j - lo] : i > 0 ? 1 : 2;
    if (i > 0 && j > 0 && o === 0) {
      if (H[i - 1].t === R[j - 1].t) pairs.push([i - 1, j - 1]);
      else S++;
      i--;
      j--;
    } else if (i > 0 && (o === 1 || j === 0)) {
      I++;
      i--;
    } else {
      D++;
      j--;
    }
  }
  pairs.reverse();
  return { S, D, I, pairs, distance: prev ? prev[prev.length - 1] : m };
}

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

const round = (x, digits = 3) => (x === null || x === undefined ? null : Number(x.toFixed(digits)));

const { S, D, I, pairs } = align();
const wer = R.length > 0 ? (S + D + I) / R.length : null;

// Without fillers: align again on the filtered sequences.
const keep = (w) => !FILLERS.has(w.t);
const allH = [...H];
const allR = [...R];
H.splice(0, H.length, ...allH.filter(keep));
R.splice(0, R.length, ...allR.filter(keep));
const noFill = align();
const werNoFillers = R.length > 0 ? (noFill.S + noFill.D + noFill.I) / R.length : null;
const refTokensNoFillers = R.length;
H.splice(0, H.length, ...allH);
R.splice(0, R.length, ...allR);

// Time offsets (M3), in the first and last ten minutes of the reference.
const lastRef = R.at(-1)?.end ?? 0;
const offsets = pairs.map(([h, r]) => ({ at: R[r].start, d: H[h].start - R[r].start }));
const window = (from, to) => offsets.filter((o) => o.at >= from && o.at < to).map((o) => o.d);
const describe = (ds) => ({
  words: ds.length,
  medianSec: round(quantile(ds, 0.5)),
  p90AbsSec: round(quantile(ds.map(Math.abs), 0.9)),
  withinHalfSecond: ds.length
    ? round(ds.filter((d) => Math.abs(d) <= 0.5).length / ds.length)
    : null,
});

// Speakers (M6, M7): map each local label to the reference speaker it shares most matched words with.
const counts = new Map();
for (const [h, r] of pairs) {
  const hs = H[h].speaker;
  const rs = R[r].speaker;
  if (hs === null || hs === undefined || rs === null || rs === undefined) continue;
  const key = `${hs}\u0000${rs}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const mapping = {};
for (const [key] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  const [hs, rs] = key.split('\u0000');
  if (mapping[hs] === undefined && !Object.values(mapping).includes(rs)) mapping[hs] = rs;
}
let agreeing = 0;
let labelled = 0;
const perTen = new Map();
for (const [h, r] of pairs) {
  const hs = H[h].speaker;
  const rs = R[r].speaker;
  if (hs === null || hs === undefined || rs === null || rs === undefined) continue;
  const ok = mapping[String(hs)] === String(rs);
  labelled++;
  if (ok) agreeing++;
  const bucket = Math.floor(R[r].start / 600);
  const b = perTen.get(bucket) ?? { words: 0, agree: 0 };
  b.words++;
  if (ok) b.agree++;
  perTen.set(bucket, b);
}

// A readable transcript, one line per turn.
const hhmmss = (s) => {
  const t = Math.max(0, Math.floor(s));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
    .map((x) => String(x).padStart(2, '0'))
    .join(':');
};
const lines = [];
let current = null;
for (const w of hypWords) {
  if (!current || w.speaker !== current.speaker) {
    if (current)
      lines.push(`[${hhmmss(current.start)}] Speaker ${current.speaker ?? '?'}: ${current.text}`);
    current = { speaker: w.speaker, start: w.start, text: w.text };
  } else {
    current.text += ` ${w.text}`;
  }
}
if (current)
  lines.push(`[${hhmmss(current.start)}] Speaker ${current.speaker ?? '?'}: ${current.text}`);

const metrics = {
  tool: 'compare',
  label,
  hypothesis: hypPath,
  reference: refPath,
  speakersFrom: flag('--segments') ? 'diarization segments, merged here' : 'engine (per word)',
  audioSec: hyp.audio?.durationSec ?? null,
  referenceTokens: R.length,
  hypothesisTokens: H.length,
  substitutions: S,
  deletions: D,
  insertions: I,
  wer: round(wer, 4),
  werNoFillers: round(werNoFillers, 4),
  referenceTokensNoFillers: refTokensNoFillers,
  digitTokens: {
    reference: R.filter((w) => /\d/.test(w.t)).length,
    hypothesis: H.filter((w) => /\d/.test(w.t)).length,
  },
  times: {
    first10min: describe(window(0, 600)),
    last10min: describe(window(Math.max(0, lastRef - 600), Infinity)),
    all: describe(offsets.map((o) => o.d)),
  },
  speakers: {
    mapping,
    hypothesisLabels: [...new Set(H.map((w) => w.speaker))].filter(
      (s) => s !== null && s !== undefined,
    ).length,
    referenceLabels: [...new Set(R.map((w) => w.speaker))].filter((s) => s !== null).length,
    agreement: labelled ? round(agreeing / labelled, 4) : null,
    perTenMinutes: [...perTen.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, v]) => ({
        fromMin: b * 10,
        words: v.words,
        agreement: round(v.agree / v.words, 4),
      })),
  },
};

const outDir = join(HERE, 'out');
mkdirSync(join(outDir, 'compare'), { recursive: true });
mkdirSync(join(outDir, 'transcripts'), { recursive: true });
writeFileSync(join(outDir, 'compare', `${label}.json`), JSON.stringify(metrics, null, 2) + '\n');
writeFileSync(join(outDir, 'transcripts', `${label}.txt`), lines.join('\n') + '\n');
console.log(
  `${label}: WER ${metrics.wer} (${metrics.werNoFillers} without fillers), ` +
    `times p90 |Δ| ${metrics.times.first10min.p90AbsSec} s first 10 min / ${metrics.times.last10min.p90AbsSec} s last, ` +
    `speaker agreement ${metrics.speakers.agreement}`,
);
