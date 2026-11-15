// For developers: puts the speech pack that src-tauri/speech-pack/pack.json lists into .speech-pack/<pack id>/
// (gitignored), so a debug desktop build has something to point DESCRIBE_SPEECH_PACK_DIR at. Model files are never
// committed. The app itself downloads them in Phase 35.
//
// Each file is checked for its size and SHA-256 before it counts. A file already there is hashed again rather than
// trusted. An interrupted download resumes from its .part file where the server honours a range.
//
// Usage: npm run desktop:fetch-models                      (downloads from the URLs in pack.json)
//        npm run desktop:fetch-models -- --from <folder>   (copies verified files from a folder instead, with no
//                                                           network: e.g. scripts/spikes/local-stt/models)
// Then: set DESCRIBE_SPEECH_PACK_DIR to the .speech-pack folder it prints.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pack = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'speech-pack', 'pack.json'), 'utf8'));
const PACKS = join(ROOT, '.speech-pack');
const DIR = join(PACKS, pack.id);
// A generic client name: nothing about the user goes to Hugging Face.
const USER_AGENT = 'DeScribe-developer-fetch';

const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const from = fromIndex >= 0 ? resolve(args[fromIndex + 1] ?? '') : null;

const mb = (bytes) => (bytes / 1e6).toFixed(1);

async function sha256Of(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function matches(path, model) {
  if (!existsSync(path) || (await stat(path)).size !== model.bytes) return false;
  return (await sha256Of(path)) === model.sha256;
}

async function download(model, partPath) {
  const have = existsSync(partPath) ? (await stat(partPath)).size : 0;
  const headers = { 'User-Agent': USER_AGENT };
  if (have > 0 && have < model.bytes) headers.Range = `bytes=${have}-`;
  const response = await fetch(model.url, { headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(model.url).host}`);
  if (!response.url.startsWith('https://')) throw new Error('redirected to plain HTTP');
  const type = response.headers.get('content-type') ?? '';
  if (type.startsWith('text/html')) throw new Error(`got a web page (${type}), not the file`);
  const resumed = response.status === 206;
  console.log(
    `  ${resumed ? `resuming at ${mb(have)} MB` : 'from the start'}, via ${new URL(response.url).host}`,
  );
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(partPath, { flags: resumed ? 'a' : 'w' }),
  );
}

mkdirSync(DIR, { recursive: true });
let failed = false;
for (const model of pack.models) {
  const path = join(DIR, model.file);
  console.log(`${model.role}: ${model.file} (${mb(model.bytes)} MB)`);
  try {
    if (await matches(path, model)) {
      console.log('  already there, size and SHA-256 match');
      continue;
    }
    if (from) {
      const source = join(from, model.file);
      if (!(await matches(source, model))) throw new Error(`${source} is missing or doesn't match`);
      copyFileSync(source, `${path}.part`);
    } else {
      await download(model, `${path}.part`);
    }
    await rename(`${path}.part`, path);
    if (!(await matches(path, model)))
      throw new Error('the size or SHA-256 does not match pack.json');
    console.log('  ok: size and SHA-256 match');
  } catch (error) {
    failed = true;
    console.error(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (existsSync(path)) await rm(path);
  }
}
if (!failed) console.log(`\nDone. For a debug build: set DESCRIBE_SPEECH_PACK_DIR=${PACKS}`);
process.exit(failed ? 1 : 0);
