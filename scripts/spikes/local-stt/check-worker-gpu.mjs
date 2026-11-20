// Phase 37, Task 3: checks run-worker-gpu.ps1's runs of the app's worker on a graphics card against its run of the same
// recording on the processor (out/worker-gpu/worker.cpu.<length>.jsonl).
//
// Batching on a card fails silently in v0.3.0 (empty words, exit 0; Task 1), so beyond "it finished" this reports:
// - windows of 30 s (the worker's piece length) where the processor found words and the card found none, or fewer than
//   half as many: a piece that came back empty;
// - how much the words differ: word-level edit distance of the normalised words over the processor's count;
// - how often the speakers agree: each word gets the speaker of the segment it overlaps most; card words are matched
//   to processor words with the same text starting within 0.5 s, and each card label maps to the processor label it
//   matches most;
// - from pinrun: the cards' peak memory, the job's peak commit, and the logical processors kept busy on average.
// Writes out/worker-gpu/summary.md and prints it. Exits 1 if any card run has a flagged window or didn't finish.
// Usage: node scripts/spikes/local-stt/check-worker-gpu.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out', 'worker-gpu');
const WINDOW_SEC = 30;

const runs = readdirSync(OUT)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => f.replace(/\.jsonl$/, ''))
  .sort();

function load(label) {
  const lines = readFileSync(join(OUT, `${label}.jsonl`), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);
  const events = lines.flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const pinPath = join(OUT, `${label}.pinrun.json`);
  const pin = existsSync(pinPath) ? JSON.parse(readFileSync(pinPath, 'utf8')) : null;
  return {
    label,
    done: events.find((e) => e.event === 'done') ?? null,
    last: events.at(-1) ?? null,
    pin,
  };
}

const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

function words(result) {
  return result.words.map((w) => ({
    ...w,
    n: norm(w.text),
    speaker: speakerOf(w, result.speakerSegments),
  }));
}

function speakerOf(word, segments) {
  let best = -1;
  let overlap = 0;
  for (const s of segments) {
    const o = Math.min(word.end, s.end) - Math.max(word.start, s.start);
    if (o > overlap) {
      overlap = o;
      best = s.speaker;
    }
  }
  return best;
}

function windows(ws, duration) {
  const counts = new Array(Math.ceil(duration / WINDOW_SEC)).fill(0);
  for (const w of ws) counts[Math.min(counts.length - 1, Math.floor(w.start / WINDOW_SEC))] += 1;
  return counts;
}

/** Word-level edit distance between `a` and `b` (normalised, empty words dropped), two rows at a time. */
function editDistance(a, b) {
  let prev = new Int32Array(b.length + 1).map((_, j) => j);
  let row = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      row[j] = Math.min(sub, prev[j] + 1, row[j - 1] + 1);
    }
    [prev, row] = [row, prev];
  }
  return prev[b.length];
}

function speakerAgreement(reference, card) {
  const byText = new Map();
  for (const w of card) {
    if (!byText.has(w.n)) byText.set(w.n, []);
    byText.get(w.n).push(w);
  }
  const pairs = [];
  for (const r of reference) {
    const near = (byText.get(r.n) ?? []).find((c) => Math.abs(c.start - r.start) <= 0.5);
    if (near && r.speaker >= 0 && near.speaker >= 0) pairs.push([r.speaker, near.speaker]);
  }
  const votes = new Map();
  for (const [r, c] of pairs) {
    const key = `${c}`;
    if (!votes.has(key)) votes.set(key, new Map());
    votes.get(key).set(r, (votes.get(key).get(r) ?? 0) + 1);
  }
  const mapping = new Map(
    [...votes].map(([c, m]) => [Number(c), [...m].sort((x, y) => y[1] - x[1])[0][0]]),
  );
  const agree = pairs.filter(([r, c]) => mapping.get(c) === r).length;
  return pairs.length ? agree / pairs.length : NaN;
}

const mb = (b) => (b == null ? '–' : `${Math.round(b / 1e6)}`);
const pct = (x) => (Number.isNaN(x) ? '–' : `${(x * 100).toFixed(2)} %`);
const s1 = (x) => (x == null ? '–' : x.toFixed(1));

const rows = [];
let failed = false;
for (const label of runs) {
  const run = load(label);
  const [, device, length] = label.split('.');
  const pin = run.pin;
  const cards = (pin?.samples?.gpu_adapters ?? []).filter(
    (a) => a.engine_max_percent > 0.5 || a.dedicated_peak_bytes > 1e7 || a.shared_peak_bytes > 1e7,
  );
  const cardMemory = cards.length
    ? cards
        .map(
          (a) =>
            `${mb(a.dedicated_peak_bytes)} ded. / ${mb(a.shared_peak_bytes)} shared, ${Math.round(a.engine_max_percent)} % max`,
        )
        .join('; ')
    : '–';
  const busy = pin ? ((pin.cpuUserSec + pin.cpuKernelSec) / pin.wallSec).toFixed(1) : '–';
  if (!run.done) {
    failed ||= device !== 'cpu';
    rows.push(`| ${label} | **did not finish**: ${JSON.stringify(run.last)} | | | | | | | | | |`);
    continue;
  }
  const r = run.done;
  const t = r.timings;
  let diff = '(reference)';
  let agreement = '(reference)';
  let flagged = '–';
  if (device !== 'cpu') {
    const reference = runs.includes(`worker.cpu.${length}`)
      ? load(`worker.cpu.${length}`).done
      : null;
    if (reference) {
      const refWords = words(reference);
      const cardWords = words(r);
      const a = refWords.map((w) => w.n).filter(Boolean);
      const b = cardWords.map((w) => w.n).filter(Boolean);
      diff = pct(editDistance(a, b) / a.length);
      agreement = pct(speakerAgreement(refWords, cardWords));
      const ref = windows(refWords, reference.durationSec);
      const got = windows(cardWords, r.durationSec);
      const bad = ref.flatMap((n, i) =>
        n > 0 && (got[i] ?? 0) < n / 2 ? [`${i * WINDOW_SEC} s: ${got[i] ?? 0} of ${n}`] : [],
      );
      flagged = bad.length ? `**${bad.join(', ')}**` : 'none';
      failed ||= bad.length > 0;
    } else {
      diff = agreement = 'no processor run';
    }
  }
  rows.push(
    `| ${label} | ${t.device ? `${t.device.name} (nth ${t.device.nth})` : `processor (${t.threads} threads)`} | ${s1(r.durationSec)} | ${s1(t.totalSec)} | ${(r.durationSec / t.totalSec).toFixed(1)} | ${s1(t.wordsSec)} / ${s1(t.speakersSec)} | ${r.words.length} / ${r.speakerSegments.length} | ${diff} | ${agreement} | ${flagged} | ${busy} | ${mb(pin?.peakProcessCommitBytes)} | ${cardMemory} |`,
  );
}

const table = [
  '| Run | Ran on | Audio s | Total s | × real time | Words s / speakers s | Words / segments | Words differ | Speakers agree | Thin windows | LPs busy | Peak commit MB | Card: MB dedicated / shared, engine |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
].join('\n');
writeFileSync(join(OUT, 'summary.md'), `${table}\n`);
console.log(table);
process.exit(failed ? 1 : 0);
