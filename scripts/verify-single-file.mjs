// Asserts that the build is one self-contained HTML file with the expected CSP and no Tauri code, and that the
// three lists of API hosts agree (AGENTS.md rules 1 and 2).
// Usage: node scripts/verify-single-file.mjs [--dist <dir>]   (defaults to ./dist)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Must match API_HOSTS in vite.config.ts and connect-src in src-tauri/tauri.conf.json (checked below). Changing
 * this list needs a DECISIONS.md entry.
 */
const ALLOWED_HOSTS = [
  'https://api.elevenlabs.io',
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com',
];
/** Tauri's own IPC sources in the desktop CSP, which aren't API hosts. */
const TAURI_IPC_SOURCES = ['ipc:', 'http://ipc.localhost'];
/** Strings that only Tauri's JavaScript contains: the web build must never include it. */
const TAURI_MARKERS = ['__TAURI__', 'ipc.localhost'];
const EXPECTED_FILE = 'describe.html';
const WARN_BYTES = 3 * 1024 * 1024;
const VITE_CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const TAURI_CONFIG = fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url));

const distArg = process.argv.indexOf('--dist');
const distDir =
  distArg !== -1 && process.argv[distArg + 1]
    ? resolve(process.argv[distArg + 1])
    : fileURLToPath(new URL('../dist', import.meta.url));

const failures = [];
const fail = (msg) => failures.push(msg);

const decodeEntities = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

/** CSP text → Map of lower-case directive name → its values. */
const parseCsp = (content) =>
  new Map(
    content
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name.toLowerCase(), values]),
  );

/** Fails with the missing and extra hosts when `hosts` isn't the same set as ALLOWED_HOSTS. */
function checkHosts(where, hosts) {
  const missing = ALLOWED_HOSTS.filter((h) => !hosts.includes(h));
  const extra = hosts.filter((h) => !ALLOWED_HOSTS.includes(h));
  if (missing.length > 0) fail(`${where} is missing ${missing.join(', ')}`);
  if (extra.length > 0) fail(`${where} has hosts that aren't allowed: ${extra.join(', ')}`);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [relative(distDir, full).replaceAll('\\', '/')];
  });
}

let files;
try {
  files = listFiles(distDir);
} catch {
  console.error(`verify-single-file: cannot read ${distDir}. Run "npm run build" first.`);
  process.exit(1);
}

if (files.length !== 1 || files[0] !== EXPECTED_FILE) {
  fail(`dist/ must contain exactly "${EXPECTED_FILE}", found: ${files.join(', ') || '(nothing)'}`);
}

const htmlPath = join(distDir, EXPECTED_FILE);
let html = '';
try {
  html = readFileSync(htmlPath, 'utf8');
} catch {
  fail(`${EXPECTED_FILE} is missing`);
}

if (html) {
  // Drop inline script bodies so strings inside the bundled JS cannot trigger false matches.
  const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');

  if (/<script\b[^>]*\ssrc\s*=/i.test(markup)) fail('found an external <script src=…>');
  if (/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i.test(markup))
    fail('found <link rel="stylesheet">');
  if (/<link\b[^>]*\bhref\s*=\s*["']?\s*(https?:)?\/\//i.test(markup)) {
    fail('found a <link href> pointing to the network');
  }

  const styles = [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  for (const css of styles) {
    if (/@import\b/i.test(css)) fail('found @import in a <style> block');
    if (/url\(\s*["']?\s*(https?:)?\/\//i.test(css)) fail('found url(http…) in a <style> block');
  }

  const cspMatch = markup.match(
    /<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/i,
  );
  if (!cspMatch) {
    fail('CSP <meta> is missing');
  } else {
    // Vite writes the quotes in the attribute as entities (&#39;none&#39;), so decode before parsing.
    const content = decodeEntities(cspMatch[0].match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? '');
    const directives = parseCsp(content);
    const connect = directives.get('connect-src') ?? [];
    const sameSet =
      connect.length === ALLOWED_HOSTS.length && ALLOWED_HOSTS.every((h) => connect.includes(h));
    if (!sameSet) {
      fail(
        `CSP connect-src must be exactly [${ALLOWED_HOSTS.join(' ')}], got [${connect.join(' ')}]`,
      );
    }
    if (content.includes("'unsafe-eval'")) fail("CSP must never contain 'unsafe-eval'");
    if (directives.get('default-src')?.join(' ') !== "'none'")
      fail("CSP default-src must be 'none'");

    const firstScript = markup.search(/<script\b/i);
    if (firstScript !== -1 && cspMatch.index > firstScript) {
      fail('CSP <meta> must come before the first <script>');
    }
  }

  // The whole file, script bodies included: Tauri's code only belongs in the desktop build.
  for (const marker of TAURI_MARKERS) {
    if (html.includes(marker)) fail(`found Tauri code ("${marker}") in the web build`);
  }
}

// The same hosts in all three places (AGENTS.md rule 2), whichever build was checked above.
try {
  const viteConfig = readFileSync(VITE_CONFIG, 'utf8');
  const list = viteConfig.match(/const API_HOSTS = \[([\s\S]*?)\]/)?.[1];
  if (list === undefined) {
    fail('vite.config.ts: API_HOSTS not found');
  } else {
    const hosts = [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    checkHosts('API_HOSTS in vite.config.ts', hosts);
  }
} catch {
  fail('cannot read vite.config.ts');
}

try {
  const csp = JSON.parse(readFileSync(TAURI_CONFIG, 'utf8')).app?.security?.csp;
  if (typeof csp !== 'string') {
    fail('src-tauri/tauri.conf.json: app.security.csp must be a string');
  } else {
    const directives = parseCsp(csp);
    const connect = (directives.get('connect-src') ?? []).filter(
      (h) => !TAURI_IPC_SOURCES.includes(h),
    );
    checkHosts('connect-src in src-tauri/tauri.conf.json', connect);
    if (csp.includes("'unsafe-eval'")) fail("the desktop CSP must never contain 'unsafe-eval'");
    if (directives.get('default-src')?.join(' ') !== "'none'")
      fail("the desktop CSP's default-src must be 'none'");
  }
} catch {
  fail('cannot read or parse src-tauri/tauri.conf.json');
}

if (failures.length > 0) {
  console.error('verify-single-file: FAILED');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

const bytes = statSync(htmlPath).size;
const size = `${(bytes / 1024).toFixed(1)} KB`;
console.log(`verify-single-file: OK (${EXPECTED_FILE}, ${size}; the three host lists agree)`);
if (bytes > WARN_BYTES) {
  console.warn(`verify-single-file: warning: ${EXPECTED_FILE} is larger than 3 MB (${size})`);
}
