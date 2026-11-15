// A stand-in for Hugging Face on 127.0.0.1, for trying the speech models' download in a debug build (Phase 35's
// checks over CDP). Nothing leaves the computer, and no real model is fetched.
//
// It serves two small made-up model files and writes a list for them, which a debug build reads in place of the
// compiled pack.json:
//   node scripts/speech-pack-test-server.mjs [--port 8765] [--scenario ok] [--rate-kbps 400]
//   set DESCRIBE_SPEECH_PACK_TEST_LIST=<repo>/.speech-pack-test/test-pack.json
//   set DESCRIBE_SPEECH_PACK_DIR=<a scratch folder>
// A release build never reads the list. Plain HTTP to 127.0.0.1 is allowed only while a test list is in use.
//
// Scenarios, chosen with --scenario or at any time with GET /scenario/<name>:
//   ok        both files, with Range support (206), at --rate-kbps (default 400 kB/s, slow enough to Cancel)
//   fast      the same, unthrottled
//   no-range  a Range request gets 200 and the whole file, as on the work laptop's network
//   redirect  302 to /cdn/<file>?signature=…, as huggingface.co hands files to its delivery host
//   drop      the connection is cut half-way through each file
//   403 | 404 | 410 | 429 | 503   that status for every file (429 and 503 with Retry-After)
//   html      200 text/html: a network filter's block page
//   to-http   302 to a plain-HTTP URL elsewhere, which the app must refuse
//   altered   the right size, one byte changed: the hash fails
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const port = Number(option('port', 8765));
const rate = Number(option('rate-kbps', 400)) * 1000;
let scenario = option('scenario', 'ok');

/** Made-up bytes, the same on every run, so a part file from an earlier run still matches. */
function bytes(seed, length) {
  const out = Buffer.alloc(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x >> 16;
  }
  return out;
}

const FILES = {
  'words.gguf': bytes(1, 6_000_000),
  'speakers.gguf': bytes(2, 2_000_000),
};

const outDir = fileURLToPath(new URL('../.speech-pack-test/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const list = {
  id: 'test-pack-1',
  version: '1.0.0',
  languages: ['en', 'de', 'fr'],
  maxSpeakers: 8,
  models: Object.entries(FILES).map(([file, body]) => ({
    role: file.startsWith('words') ? 'words' : 'speakers',
    file,
    bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    url: `http://127.0.0.1:${port}/${file}`,
    name: `Test ${file}`,
    card: 'https://huggingface.co/',
    licence: 'CC-BY-4.0',
    copyright: '© nobody',
    changes: null,
  })),
};
const listPath = `${outDir}test-pack.json`;
writeFileSync(listPath, `${JSON.stringify(list, null, 2)}\n`);

const blockPage =
  '<!doctype html><title>Blocked</title><p>This site is blocked by your organisation.</p>';

/** Writes `body` at about `rate` bytes a second (or at once), cutting after `cutAt` bytes if given. */
function send(res, body, { throttle = true, cutAt = null } = {}) {
  const chunk = 64 * 1024;
  let sent = 0;
  const step = () => {
    if (res.destroyed) return;
    if (cutAt !== null && sent >= cutAt) return res.socket?.destroy();
    if (sent >= body.length) return res.end();
    const end = Math.min(sent + chunk, body.length, cutAt ?? body.length);
    res.write(body.subarray(sent, end));
    sent = end;
    if (throttle && rate > 0) setTimeout(step, (chunk / rate) * 1000);
    else setImmediate(step);
  };
  step();
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const switched = /^\/scenario\/([\w-]+)$/.exec(url.pathname);
  if (switched) {
    scenario = switched[1];
    console.log(`scenario: ${scenario}`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(`scenario ${scenario}\n`);
  }
  const name = url.pathname.replace(/^\/(cdn\/)?/, '');
  const file = FILES[name];
  console.log(`${req.method} ${req.url} range=${req.headers.range ?? '-'} (${scenario})`);
  if (!file) {
    res.writeHead(404);
    return res.end();
  }
  const status = Number(scenario);
  if (status >= 400) {
    const wait = status === 429 || status === 503 ? { 'Retry-After': '120' } : {};
    res.writeHead(status, { 'Content-Type': 'text/plain', ...wait });
    return res.end('No');
  }
  if (scenario === 'html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(blockPage);
  }
  if (scenario === 'to-http') {
    res.writeHead(302, { Location: `http://example.com/${name}` });
    return res.end();
  }
  if (scenario === 'redirect' && !url.pathname.startsWith('/cdn/')) {
    res.writeHead(302, { Location: `/cdn/${name}?signature=not-a-real-one` });
    return res.end();
  }
  const body = scenario === 'altered' ? Buffer.from(file).fill(file[0] ^ 1, 0, 1) : file;
  const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
  const from = range && scenario !== 'no-range' ? Number(range[1]) : 0;
  const part = body.subarray(from);
  res.writeHead(from > 0 ? 206 : 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': part.length,
    ...(from > 0 ? { 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}),
  });
  send(res, part, {
    throttle: scenario !== 'fast',
    cutAt: scenario === 'drop' ? Math.floor(part.length / 2) : null,
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`speech-pack-test-server on http://127.0.0.1:${port} (scenario ${scenario})`);
  console.log(`set DESCRIBE_SPEECH_PACK_TEST_LIST=${listPath}`);
});
