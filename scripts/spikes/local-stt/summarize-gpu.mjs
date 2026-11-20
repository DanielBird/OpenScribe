// Phase 37, Task 1: one Markdown table from run-gpu.ps1's runs (out/runs/gpu.*.json and out/gpu/gpu.*.pinrun.json).
// Usage: node scripts/spikes/local-stt/summarize-gpu.mjs > scripts/spikes/local-stt/out/gpu/summary.md
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, 'out', 'runs');
const REPORTS = join(HERE, 'out', 'gpu');
// PDH's LUIDs for the PC's cards (vulkaninfo's deviceLUID, bytes reversed).
const CARDS = { '0x00000000_0x00017912': 'RTX 2070 SUPER', '0x00000000_0x00018BCE': 'UHD 770' };

const mb = (b) => (b == null ? '–' : `${Math.round(b / 1e6)}`);
const s = (x, d = 1) => (x == null ? '–' : x.toFixed(d));

const rows = [];
for (const file of readdirSync(RUNS).filter(
  (f) => /^gpu\..*\.json$/.test(f) && !f.includes('.engine.'),
)) {
  const run = JSON.parse(readFileSync(join(RUNS, file), 'utf8'));
  const pinPath = join(REPORTS, `${run.label}.pinrun.json`);
  const pin = existsSync(pinPath) ? JSON.parse(readFileSync(pinPath, 'utf8')) : null;
  const part = (kind) => run.runs.find((r) => r.kind === kind);
  const words = part('words') ?? part('combined');
  const speakers = part('speakers');
  const cards = (pin?.samples?.gpu_adapters ?? [])
    .filter(
      (a) =>
        a.engine_max_percent > 0.5 || a.dedicated_peak_bytes > 1e7 || a.shared_peak_bytes > 1e7,
    )
    .map(
      (a) =>
        `${CARDS[a.luid] ?? a.luid}: ${s(a.engine_max_percent, 0)} % max / ${s(a.engine_mean_percent, 0)} % mean, ` +
        `${mb(a.dedicated_peak_bytes)} MB ded. / ${mb(a.shared_peak_bytes)} MB shared`,
    )
    .join('; ');
  const cpuSec = pin ? pin.cpuUserSec + pin.cpuKernelSec : null;
  // A run can "finish" with words missing: a crashed engine (exit ≠ 0) leaves chunks unwritten, and a batch on a GPU
  // can come back empty. Say so beside the word count.
  const problems = run.runs
    .filter((r) => r.exitCode !== 0)
    .map((r) => `${r.kind} exit ${r.exitCode}`);
  const chunkDir = join(RUNS, `${run.label}.words.chunks`);
  if (run.chunking && existsSync(chunkDir)) {
    const files = readdirSync(chunkDir);
    const empty = files.filter(
      (f) => (JSON.parse(readFileSync(join(chunkDir, f), 'utf8')).words ?? []).length === 0,
    );
    if (files.length < run.chunking.chunks)
      problems.push(`${run.chunking.chunks - files.length} chunks unwritten`);
    if (empty.length) problems.push(`${empty.length} chunks empty`);
  }
  rows.push({
    label: run.label,
    cells: [
      run.label.replace(/^gpu\./, ''),
      s(run.audio.durationSec, 0),
      s(run.timing.totalSec),
      s(run.timing.xRealtime),
      words
        ? `${s(words.wallSec)} / ${s(words.loadAndWarmupSec)} / ${mb(words.peakWorkingSetBytes)} / ${mb(words.peakPrivateBytes)}`
        : '–',
      words ? `${s(words.encoderMs / 1000)} / ${s(words.decoderMs / 1000)}` : '–',
      speakers
        ? `${s(speakers.wallSec)} / ${mb(speakers.peakWorkingSetBytes)} / ${mb(speakers.peakPrivateBytes)}`
        : '–',
      cpuSec == null ? '–' : `${s(cpuSec, 0)} (${s(cpuSec / pin.wallSec)})`,
      cards || 'none',
      `${run.result.words.length}${problems.length ? ` (**${problems.join(', ')}**)` : ''}`,
    ],
  });
}
rows.sort((a, b) => a.label.localeCompare(b.label));
console.log(
  '| Run | Audio s | Total s | × real time | Words (or combined): s / load s / WS MB / commit MB | Encoder s / decoder s (summed over chunks) | Speakers: s / WS MB / commit MB | CPU s (busy LPs) | Cards used | Words |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.cells.join(' | ')} |`);
