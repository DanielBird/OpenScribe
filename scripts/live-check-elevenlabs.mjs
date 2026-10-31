// Live checks against the real ElevenLabs API: V1, V2, V3 and V5 in docs/reference/elevenlabs-stt.md.
//
// Usage (Node >= 22, PowerShell):
//   $env:ELEVENLABS_API_KEY = "<your key>"; node scripts/live-check-elevenlabs.mjs <short-speech-file> [--only V1,V5] [--terms "Oticon,Hörgerät"]
// Usage (bash):
//   ELEVENLABS_API_KEY=<your key> node scripts/live-check-elevenlabs.mjs <short-speech-file>
//
// Cost: up to 5 transcriptions of the file (V1: 2, V2: 1, V5: 2). V3 sends no audio, so it is free (the file
// argument is still required). Use a short (10–30 s) clip of speech with nothing private in it. The key is
// read from the environment and is never printed.
// Paste the summary at the end into the verification log of docs/reference/elevenlabs-stt.md.
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const API = 'https://api.elevenlabs.io';
const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const filePath = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const only = new Set((option('--only') ?? 'V1,V2,V3,V5').toUpperCase().split(','));
const terms = (option('--terms') ?? 'Describe,Oticon')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const key = process.env.ELEVENLABS_API_KEY?.trim();

if (!key || !filePath) {
  console.error('Set ELEVENLABS_API_KEY and pass a short speech file, e.g.');
  console.error('  node scripts/live-check-elevenlabs.mjs sample.mp3');
  process.exit(1);
}

const audio = readFileSync(filePath);
const fileName = basename(filePath);
const mimeType = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
const redact = (text) => text.replaceAll(key, '[redacted]');
const results = [];

/** One transcription with Describe's fixed fields (DECISIONS.md D4) plus `extra`. */
async function transcribe({ query = '', extra = [] } = {}) {
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  form.append('file', new Blob([audio], { type: mimeType }), fileName);
  form.append('diarize', 'true');
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  form.append('no_verbatim', 'true');
  for (const [name, value] of extra) form.append(name, value);

  const started = Date.now();
  const res = await fetch(`${API}/v1/speech-to-text${query}`, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
  });
  const bodyText = await res.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    // keep null
  }
  return { status: res.status, seconds: (Date.now() - started) / 1000, json, bodyText };
}

function errorSummary(r) {
  const detail = r.json?.detail;
  if (!detail) return redact(r.bodyText.slice(0, 200));
  return redact(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300);
}

function record(id, result) {
  results.push({ id, result });
  console.log(`\n[${id}] ${result}`);
}

function termsFound(r) {
  const text = (r.json?.text ?? '').toLowerCase();
  return terms
    .map((t) => `${t}: ${text.includes(t.toLowerCase()) ? 'found' : 'not found'}`)
    .join(', ');
}

console.log(
  `File: ${fileName} (${mimeType}, ${(audio.length / 1024).toFixed(0)} KB). Terms: ${terms.join(', ')}`,
);

let baseline = null;

if (only.has('V1')) {
  const repeated = await transcribe({ extra: terms.map((t) => ['keyterms', t]) });
  const asJson = await transcribe({ extra: [['keyterms', JSON.stringify(terms)]] });
  if (repeated.status === 200) baseline = repeated;
  const describe = (r) =>
    r.status === 200
      ? `200 in ${r.seconds.toFixed(1)} s (${termsFound(r)})`
      : `${r.status}: ${errorSummary(r)}`;
  record('V1', `repeated fields → ${describe(repeated)}; JSON-array string → ${describe(asJson)}`);
}

if (only.has('V2')) {
  const r = await transcribe({ query: '?enable_logging=false' });
  record(
    'V2',
    r.status === 200
      ? `enable_logging=false accepted (200) on this key`
      : `enable_logging=false rejected: ${r.status} ${errorSummary(r)}`,
  );
}

if (only.has('V3')) {
  const parts = [];
  for (const path of ['/v1/user', '/v1/user/subscription', '/v1/models']) {
    const res = await fetch(`${API}${path}`, { headers: { 'xi-api-key': key } });
    const text = await res.text();
    let code = '';
    try {
      const detail = JSON.parse(text)?.detail;
      code = detail?.status ?? (typeof detail === 'string' ? detail : '');
    } catch {
      // not JSON
    }
    // Only the status and error code are printed: /v1/user returns personal account data.
    parts.push(`GET ${path} → ${res.status}${code ? ` (${redact(String(code))})` : ''}`);
  }
  // A transcription request without a file: if the key is checked before the body, a valid key gets a
  // "file missing" style error and an invalid key gets 401. No audio is sent, so nothing is transcribed.
  for (const [label, probeKey] of [
    ['your key', key],
    ['an invalid key', 'describe-invalid-key-check'],
  ]) {
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    const res = await fetch(`${API}/v1/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': probeKey },
      body: form,
    });
    const text = await res.text();
    let summary = '';
    try {
      const detail = JSON.parse(text)?.detail;
      if (typeof detail === 'string') summary = detail;
      else if (detail?.message || detail?.status) {
        summary = [detail.status ?? detail.code, detail.message].filter(Boolean).join(': ');
      } else if (detail) summary = JSON.stringify(detail);
      else summary = text.slice(0, 120);
    } catch {
      summary = text.slice(0, 120);
    }
    parts.push(
      `POST /v1/speech-to-text without a file (${label}) → ${res.status} ${redact(summary).slice(0, 200)}`,
    );
  }
  record('V3', `${parts.join('; ')}. Run this once with a key restricted to Speech-to-Text.`);
}

if (only.has('V5')) {
  baseline ??= await transcribe();
  const de = await transcribe({ extra: [['language_code', 'de']] });
  const deu = await transcribe({ extra: [['language_code', 'deu']] });
  const returned = baseline.status === 200 ? JSON.stringify(baseline.json?.language_code) : 'n/a';
  const accepted = (r) => (r.status === 200 ? '200' : `${r.status} ${errorSummary(r)}`);
  record(
    'V5',
    `response language_code (auto) = ${returned}; request language_code=de → ${accepted(de)}; ` +
      `language_code=deu → ${accepted(deu)}`,
  );
}

const today = new Date().toISOString().slice(0, 10);
console.log('\n--- Paste into docs/reference/elevenlabs-stt.md (verification log) ---');
for (const { id, result } of results) console.log(`| ${id} | … | ${result} | ${today} |`);
