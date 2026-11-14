// Phase 33 spike: out/summary.md, the numbers from every run so far, for the maintainer to send back.
// It holds no transcript text: only timings, memory, the calibration, and the scores of compare.mjs, hf-fetch and
// decode-probe. Run it any time; it reads what is in out/.
// Usage: node scripts/spikes/local-stt/summarize.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function jsonFiles(dir, filter = () => true) {
  const full = join(OUT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith('.json') && filter(f))
    .sort()
    .map((f) => ({ file: f, data: readJson(join(full, f)) }))
    .filter((x) => x.data);
}

const mb = (b) => (typeof b === 'number' ? `${Math.round(b / 1e6)}` : '');
const n = (x, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '');
const lines = [];
lines.push(`# Phase 33 results (${new Date().toISOString()})`, '');

const profiles = readJson(join(HERE, 'profiles.json'));
if (profiles) {
  lines.push(
    '## The emulation',
    '',
    `Mask ${profiles.mask} (logical processors ${(profiles.logicalProcessors ?? []).join(', ')}).`,
    '',
  );
  lines.push(
    '| Profile | Scheme | Cap MHz | 2024 multi | R23 multi | 2024 error | R23 error | Both within 5 % | 2024 single | R23 single | Calibrated |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [key, p] of Object.entries(profiles.profiles ?? {})) {
    const pct = (e) => (typeof e === 'number' ? `${(e * 100).toFixed(1)} %` : '');
    lines.push(
      `| ${key} | ${p.scheme} | ${p.capMHz ?? ''} | ${n(p.cinebench2024Multi, 0)} (target ${p.targetCinebench2024Multi}) | ` +
        `${n(p.cinebenchR23Multi, 0)} (target ${p.targetCinebenchR23Multi}) | ${pct(p.error2024)} | ${pct(p.errorR23)} | ` +
        `${p.bothWithin5Percent ?? ''} | ${n(p.cinebench2024Single, 0)} | ${n(p.cinebenchR23Single, 0)} | ${p.calibratedAt ?? ''} |`,
    );
  }
  const check = readJson(join(OUT, 'bench', 'laptop-check.json'));
  if (check)
    lines.push(
      '',
      `Check before the benchmarks: R23 ${n(check.cinebenchR23Multi, 0)} (${n(check.drift * 100)} % from the calibration).`,
    );
  lines.push('');
}

const runs = [...jsonFiles('runs', (f) => !f.endsWith('.engine.json'))].filter(
  (r) => r.data.tool === 'stt-bench',
);
if (runs.length) {
  lines.push('## Transcription runs', '');
  lines.push(
    '| Label | Profile | Estimate | Audio s | Total s | × real time | Words s | Speakers s | Words WS MB | Speakers WS MB | Peak commit MB | Clock MHz | GPU max % |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { data: r } of runs) {
    const run = (kind) => r.runs?.find((x) => x.kind === kind);
    const words = run('words') ?? run('combined');
    const speakers = run('speakers');
    const pin =
      readJson(join(OUT, 'bench', `${r.label}.pinrun.json`)) ??
      readJson(join(OUT, `pinrun-${r.label}.json`));
    const commit = Math.max(...(r.runs ?? []).map((x) => x.peakPrivateBytes ?? 0));
    lines.push(
      `| ${r.label} | ${r.pinning?.profile ?? 'uncapped'} | ${r.pinning?.laptopEstimate ? 'yes' : 'no'} | ${n(r.audio?.durationSec, 0)} | ` +
        `${n(r.timing?.totalSec)} | ${n(r.timing?.xRealtime)} | ${n(words?.wallSec)} | ${n(speakers?.wallSec)} | ` +
        `${mb(words?.peakWorkingSetBytes)} | ${mb(speakers?.peakWorkingSetBytes)} | ${mb(commit)} | ` +
        `${pin?.samples?.clock_mean_mhz ?? ''} | ${pin ? n(pin.samples?.gpu_max_percent) : ''} |`,
    );
  }
  lines.push('');
}

const compares = jsonFiles('compare');
if (compares.length) {
  lines.push('## Accuracy (compare.mjs)', '');
  lines.push(
    '| Label | Speakers from | WER | WER without fillers | Times p90 first 10 min s | Times p90 last 10 min s | Speaker agreement | Lowest 10-min agreement |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const { data: c } of compares) {
    const lowest = Math.min(...(c.speakers?.perTenMinutes ?? []).map((b) => b.agreement));
    lines.push(
      `| ${c.label} | ${c.speakersFrom} | ${c.wer} | ${c.werNoFillers} | ${c.times?.first10min?.p90AbsSec ?? ''} | ` +
        `${c.times?.last10min?.p90AbsSec ?? ''} | ${c.speakers?.agreement ?? ''} | ${Number.isFinite(lowest) ? lowest : ''} |`,
    );
  }
  lines.push('');
}

const downloads = jsonFiles('dl').filter((d) => d.data.tool === 'hf-fetch');
if (downloads.length) {
  lines.push('## Downloads (hf-fetch)', '');
  lines.push(
    '| Report | Stack | OK | Error | Resumed from | MB this run | MB/s | Hash s | Hosts |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const { file, data: d } of downloads) {
    lines.push(
      `| ${file} | ${d.stack} | ${d.ok} | ${d.error ? `${d.error.kind}` : ''} | ${d.resumedFrom ?? ''} | ${mb(d.bytesThisRun)} | ` +
        `${n(d.mbPerSec)} | ${n(d.hashSec, 2)} | ${(d.hops ?? []).map((h) => `${h.status} ${h.host}`).join(' → ')} |`,
    );
  }
  lines.push('');
}

const decodes = jsonFiles('decode').filter((d) => d.data.tool === 'decode-probe');
if (decodes.length) {
  lines.push('## Decoding (decode-probe)', '');
  lines.push(
    '| Input | Decoder | OK | Seconds | Peak WS MB | Output Hz | Resampled by | Audio s | vs ffmpeg r | Error |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const { data: d } of decodes) {
    const input = String(d.input).split(/[\\/]/).at(-1);
    lines.push(
      `| ${input} | ${d.decoder} | ${d.ok} | ${n(d.wallSec, 2)} | ${mb(d.peakWorkingSetBytes)} | ${d.result?.output_sample_rate ?? ''} | ` +
        `${d.result?.resampled_by ?? ''} | ${n(d.result?.duration_sec)} | ${n(d.ffmpeg?.correlation, 4)} | ${d.error ? String(d.error).slice(0, 80) : ''} |`,
    );
  }
  lines.push('');
}

// D7: the probe's folder checks (packaged: guide task 6).
const d7 = existsSync(OUT)
  ? readdirSync(OUT)
      .filter((f) => /^d7-.*\.json$/.test(f))
      .sort()
      .map((f) => ({ file: f, data: readJson(join(OUT, f)) }))
      .filter((x) => x.data)
  : [];
if (d7.length) {
  lines.push('## Package folders (D7)', '');
  lines.push(
    '| Report | Identity | Version | Folder | Probe file before | Marker before | Write s | Mmap read s | Free GB |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const { file, data } of d7) {
    for (const f of data.folders ?? []) {
      lines.push(
        `| ${file} | ${data.packageIdentity} | ${data.package?.version ?? ''} | ${f.kind} | ${mb(f.before?.probeBytes)} MB | ` +
          `${f.before?.marker?.writtenBy ?? ''} | ${n(f.write?.seconds, 2)} | ${n(f.mmapRead?.seconds, 2)} | ${n((f.freeBytes ?? 0) / 1e9, 0)} |`,
      );
    }
  }
  lines.push('');
}
const d8 = readJson(join(OUT, 'dl', 'd8-summary.json'));
if (d8) {
  lines.push('## Interrupted downloads (D8)', '');
  for (const [step, r] of Object.entries(d8)) {
    const first = r.first?.error
      ? `${r.first.error.kind}: ${String(r.first.error.detail).slice(0, 80)}`
      : r.first
        ? 'finished'
        : '';
    const second = r.second
      ? `${r.second.ok ? 'ok' : r.second.error?.kind}, resumed from ${r.second.resumedFrom ?? 0} bytes`
      : '';
    lines.push(
      `- **${step}:** left behind ${r.leftBehindMB ?? ''} MB; first run: ${first}; next run: ${second}`,
    );
  }
  lines.push('');
}

writeFileSync(join(OUT, 'summary.md'), lines.join('\n') + '\n');
console.log(`Wrote ${join(OUT, 'summary.md')}`);
