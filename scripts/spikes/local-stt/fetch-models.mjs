// Phase 33 spike: downloads the model files listed in models.json into models/ (gitignored), from
// https://huggingface.co/<repo>/resolve/<revision>/<file>, and checks each one's size and SHA-256.
// A file already there is hashed again rather than trusted. An interrupted download resumes from
// its .part file with a Range request. A mismatch deletes the file and stops with exit code 1.
// Usage: node scripts/spikes/local-stt/fetch-models.mjs [id ...]   (no ids: every file)
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(HERE, 'models');
// A generic client name: nothing about the user goes to Hugging Face.
const USER_AGENT = 'DeScribe-spike/0.1';

const { models } = JSON.parse(readFileSync(join(HERE, 'models.json'), 'utf8'));
const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !models.some((m) => m.id === id));
if (unknown.length > 0) {
  console.error(
    `Unknown model id: ${unknown.join(', ')}. Known: ${models.map((m) => m.id).join(', ')}`,
  );
  process.exit(1);
}
const selected = wanted.length > 0 ? models.filter((m) => wanted.includes(m.id)) : models;

function urlOf(model) {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}`;
}

async function sha256Of(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

function mb(bytes) {
  return (bytes / 1e6).toFixed(1);
}

async function download(model, partPath) {
  const have = existsSync(partPath) ? (await stat(partPath)).size : 0;
  const headers = { 'User-Agent': USER_AGENT };
  if (have > 0 && have < model.bytes) headers.Range = `bytes=${have}-`;
  const started = Date.now();
  const response = await fetch(urlOf(model), { headers, redirect: 'follow' });
  const resumed = response.status === 206;
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${urlOf(model)}`);
  const type = response.headers.get('content-type') ?? '';
  if (type.startsWith('text/html')) throw new Error(`got an HTML page (${type}), not the file`);
  console.log(
    `  ${resumed ? `resuming at ${mb(have)} MB` : 'from the start'}, via ${new URL(response.url).host}`,
  );
  let done = resumed ? have : 0;
  let lastReport = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    done += chunk.length;
    const now = Date.now();
    if (now - lastReport > 5000) {
      lastReport = now;
      const rate = (done - (resumed ? have : 0)) / 1e6 / ((now - started) / 1000);
      console.log(`  ${mb(done)} / ${mb(model.bytes)} MB, ${rate.toFixed(1)} MB/s`);
    }
  });
  await pipeline(body, createWriteStream(partPath, { flags: resumed ? 'a' : 'w' }));
  const seconds = (Date.now() - started) / 1000;
  console.log(`  downloaded in ${seconds.toFixed(0)} s`);
}

mkdirSync(MODELS_DIR, { recursive: true });
let failed = false;
for (const model of selected) {
  const path = join(MODELS_DIR, model.file);
  const partPath = `${path}.part`;
  console.log(`${model.id}: ${model.file} (${mb(model.bytes)} MB)`);
  try {
    if (!existsSync(path)) {
      await download(model, partPath);
      await rename(partPath, path);
    }
    const size = (await stat(path)).size;
    if (size !== model.bytes) throw new Error(`size ${size}, expected ${model.bytes}`);
    const hashStarted = Date.now();
    const hash = await sha256Of(path);
    const hashSeconds = ((Date.now() - hashStarted) / 1000).toFixed(1);
    if (hash !== model.sha256) throw new Error(`SHA-256 ${hash}, expected ${model.sha256}`);
    console.log(`  ok: size and SHA-256 match (hashed in ${hashSeconds} s)`);
  } catch (error) {
    failed = true;
    console.error(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (existsSync(path)) await rm(path);
  }
}
process.exit(failed ? 1 : 0);
