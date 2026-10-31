// Writes the third-party notices that Settings → About shows:
//   THIRD-PARTY-NOTICES.txt          the npm packages bundled into the app's JavaScript (both builds)
//   THIRD-PARTY-NOTICES-DESKTOP.txt  the Rust crates, and Microsoft's WebView2 loader, in the Windows app
// The npm list comes from the production build's module graph, so it is exactly what gets bundled. The Rust list
// comes from `cargo metadata`: the crates linked into the x64 Windows exe, without build-only crates and proc macros.
// A package with no licence file, or one that covers more than DeScribe includes (Vite's lists Vite's own bundled
// dependencies), gets one in scripts/notices/<npm|cargo>/<name>.txt, which is used instead of the package's files.
// Packages that contain other software (PREBUNDLED_* below) list it.
// Usage: npm run notices [-- --check] [-- --web]
//   --check  writes nothing, and fails if a file is out of date (release.mjs and pack-desktop.mjs run it)
//   --web    only THIRD-PARTY-NOTICES.txt, which needs no Rust toolchain
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const check = process.argv.includes('--check');
const webOnly = process.argv.includes('--web');

/** The target the MSIX is built for (scripts/pack-desktop.mjs). */
const DESKTOP_TARGET = 'x86_64-pc-windows-msvc';

/** Vite's and Rolldown's own helpers, which the bundle includes as virtual modules. */
const VIRTUAL_MODULES = [
  ['\0rolldown/', 'rolldown'],
  ['\0vite/', 'vite'],
  ['\0plugin-vue:', '@vitejs/plugin-vue'],
];

/**
 * Packages whose own files contain other software, so their licence files don't cover all they ship. `checked` is
 * the version whose contents were checked; any other version stops the script, so the list is checked again.
 * A name is resolved from the package's folder; an object is software that isn't installed here, whose licence is in
 * scripts/notices/<npm|cargo>/<file>.
 */
const PREBUNDLED_NPM = {
  // dist/index.mjs inlines its dependencies and vite-plugin-node-polyfills' Node polyfills.
  docx: {
    checked: '9.11.0',
    includes: [
      'base64-js',
      'core-util-is',
      'hash.js',
      'immediate',
      'inherits',
      'isarray',
      'jszip',
      'lie',
      'minimalistic-assert',
      'nanoid',
      'pako',
      'process-nextick-args',
      'readable-stream',
      'safe-buffer',
      'sax',
      'setimmediate',
      'string_decoder',
      'util-deprecate',
      'xml',
      'xml-js',
      {
        name: 'buffer',
        license: 'MIT',
        url: 'https://github.com/feross/buffer',
        file: 'buffer.txt',
      },
      {
        name: 'events',
        license: 'MIT',
        url: 'https://github.com/browserify/events',
        file: 'events.txt',
      },
      {
        name: 'ieee754',
        license: 'BSD-3-Clause',
        url: 'https://github.com/feross/ieee754',
        file: 'ieee754.txt',
      },
      {
        name: 'process',
        license: 'MIT',
        url: 'https://github.com/defunctzombie/node-process',
        file: 'process.txt',
      },
      {
        name: 'stream-browserify',
        license: 'MIT',
        url: 'https://github.com/browserify/stream-browserify',
        file: 'stream-browserify.txt',
      },
    ],
  },
};
const PREBUNDLED_CARGO = {
  // Links WebView2LoaderStatic.lib, from the Microsoft.Web.WebView2 SDK, statically on MSVC (see its CHANGELOG).
  'webview2-com-sys': {
    checked: '0.39.1',
    includes: [
      {
        name: 'Microsoft Edge WebView2 SDK loader (WebView2LoaderStatic.lib)',
        version: '1.0.3650.58',
        license: 'BSD-3-Clause',
        url: 'https://www.nuget.org/packages/Microsoft.Web.WebView2',
        file: 'webview2-loader.txt',
      },
    ],
  },
};

const LICENCE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)/i;
const MIT_TEXT = /Permission is hereby granted, free of charge/;
const RULE = '='.repeat(80);
const THIN_RULE = '-'.repeat(80);

function stop(message) {
  console.error(`\nnotices: ${message}`);
  process.exit(1);
}

const read = (file) => readFileSync(file, 'utf8');

const normalise = (text) =>
  text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** scripts/notices/<ecosystem>/<file>, or null when there isn't one. */
function vendored(ecosystem, file) {
  const full = path(`scripts/notices/${ecosystem}/${file}`);
  return existsSync(full) ? read(full) : null;
}

/**
 * The texts to show from `files` ({ name, text }), and the licence they grant. Of "MIT OR …", only the MIT licence is
 * used when its text is there: it is the shortest, and asks only for attribution.
 */
function chooseTexts(expression, files) {
  const license = expression.replace(/^\((.*)\)$/, '$1');
  const choices = /\bAND\b/.test(license)
    ? []
    : license
        .replaceAll('/', ' OR ')
        .split(/\s+OR\s+/)
        .map((s) => s.trim());
  if (choices.length > 1 && choices.includes('MIT')) {
    const named = files.filter((f) => /mit/i.test(f.name));
    const mit = named.length > 0 ? named : files.filter((f) => MIT_TEXT.test(f.text));
    if (mit.length > 0) return { license: 'MIT', texts: mit.map((f) => f.text) };
  }
  return { license, texts: files.map((f) => f.text) };
}

/** A package's licence: scripts/notices/ first, then its licence files, then (npm) its README. */
function licenceTexts(ecosystem, name, dir, expression) {
  const override = vendored(ecosystem, `${name}.txt`);
  if (override) return chooseTexts(expression, [{ name: '', text: override }]);
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((file) => ({ name: file, text: read(join(dir, file)) }));
  if (files.length > 0) return chooseTexts(expression, files);
  const readme = ecosystem === 'npm' ? readmeLicence(dir) : null;
  return readme ? chooseTexts(expression, [{ name: '', text: readme }]) : null;
}

/** The README's "License" section, for npm packages that ship no licence file. */
function readmeLicence(dir) {
  const readme = readdirSync(dir).find((f) => /^readme(\.md)?$/i.test(f));
  if (!readme) return null;
  const lines = read(join(dir, readme)).split(/\r?\n/);
  const start = lines.findIndex((l) => /^#+\s*licen[cs]e\b/i.test(l));
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex(
    (l, i) => i > start && /^#+\s/.test(l) && l.match(/^#+/)[0].length <= level,
  );
  const text = lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
  return MIT_TEXT.test(text) || /copyright/i.test(text) ? text : null;
}

/** A browsable URL from package.json's `repository`. */
function repositoryUrl(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  if (!url) return null;
  if (/^(github:)?[\w.-]+\/[\w.-]+$/.test(url))
    return `https://github.com/${url.replace(/^github:/, '')}`;
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '');
}

/** Where `name` resolves from `fromDir`, as Node looks it up, or null. */
function findPackage(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

function npmEntry(dir, note) {
  const pkg = JSON.parse(read(join(dir, 'package.json')));
  const expression =
    typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
  const found = licenceTexts('npm', pkg.name, dir, expression);
  if (!found) {
    stop(
      `${pkg.name} ${pkg.version} has no licence text. Add it as scripts/notices/npm/${pkg.name}.txt.`,
    );
  }
  return {
    name: pkg.name,
    version: pkg.version,
    license: found.license,
    url:
      repositoryUrl(pkg.repository) ?? pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}`,
    texts: found.texts,
    note,
  };
}

/** The software in a PREBUNDLED_* entry, as entries noted "inside <package>". */
function prebundled(table, ecosystem, name, version, dir) {
  const entry = table[name];
  if (!entry) return [];
  if (entry.checked !== version) {
    stop(
      `${name} is ${version}, but PREBUNDLED in scripts/make-notices.mjs lists what ${entry.checked} contains. ` +
        `Check what ${name} ${version} bundles, then update the list and its "checked" version.`,
    );
  }
  const note = `inside ${name}`;
  return entry.includes.map((item) => {
    if (typeof item === 'string') {
      const found = findPackage(item, dir);
      if (!found)
        stop(`${item}, listed as inside ${name}, isn't installed. Add its licence as an object.`);
      return npmEntry(found, note);
    }
    const text = vendored(ecosystem, item.file);
    if (!text) stop(`scripts/notices/${ecosystem}/${item.file} is missing.`);
    return { ...item, texts: [text], note };
  });
}

async function npmEntries() {
  const { build } = await import('vite');
  const ids = new Set();
  await build({
    root,
    logLevel: 'silent',
    build: { write: false },
    plugins: [
      {
        name: 'describe-notices',
        generateBundle(_, bundle) {
          for (const output of Object.values(bundle)) {
            if (output.type === 'chunk') for (const id of Object.keys(output.modules)) ids.add(id);
          }
        },
      },
    ],
  });

  const rootPosix = root.replaceAll('\\', '/');
  const viteDir = findPackage('vite', root);
  const dirs = new Set();
  for (const id of ids) {
    const file = id.replaceAll('\\', '/').replace(/\?.*$/, '');
    const virtual = VIRTUAL_MODULES.find(([prefix]) => file.startsWith(prefix));
    if (virtual) {
      dirs.add(findPackage(virtual[1], viteDir).replaceAll('\\', '/'));
      continue;
    }
    const at = file.lastIndexOf('/node_modules/');
    if (at !== -1) {
      const parts = file.slice(at + '/node_modules/'.length).split('/');
      const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
      dirs.add(`${file.slice(0, at)}/node_modules/${name}`);
      continue;
    }
    // DeScribe's own files (src/, index.html, LICENSE, these notices).
    if (file.startsWith(rootPosix)) continue;
    stop(
      `no package found for the module ${JSON.stringify(id)}. Add its prefix to VIRTUAL_MODULES.`,
    );
  }

  return [...dirs].flatMap((dir) => {
    const entry = npmEntry(dir);
    return [entry, ...prebundled(PREBUNDLED_NPM, 'npm', entry.name, entry.version, dir)];
  });
}

function cargoEntries() {
  let meta;
  try {
    const json = execSync(
      `cargo metadata --format-version 1 --locked --filter-platform ${DESKTOP_TARGET} ` +
        `--manifest-path "${path('src-tauri/Cargo.toml')}"`,
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    meta = JSON.parse(json);
  } catch {
    stop(
      'cargo metadata failed (see above). Is the Rust toolchain installed? Use --web for the npm list only.',
    );
  }

  const packages = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const isProcMacro = (p) => p.targets.some((t) => t.kind.includes('proc-macro'));

  // Normal dependencies only: build scripts and proc macros run while compiling and aren't in the exe.
  const shipped = new Set();
  const queue = [meta.resolve.root];
  while (queue.length > 0) {
    for (const dep of nodes.get(queue.pop()).deps) {
      if (!dep.dep_kinds.some((k) => k.kind === null)) continue;
      if (shipped.has(dep.pkg) || isProcMacro(packages.get(dep.pkg))) continue;
      shipped.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }

  return [...shipped].flatMap((id) => {
    const crate = packages.get(id);
    const dir = dirname(crate.manifest_path);
    const found = licenceTexts('cargo', crate.name, dir, crate.license ?? 'UNKNOWN');
    if (!found) {
      stop(
        `the crate ${crate.name} ${crate.version} has no licence file. Add it as scripts/notices/cargo/${crate.name}.txt.`,
      );
    }
    const entry = {
      name: crate.name,
      version: crate.version,
      license: found.license,
      url: crate.repository ?? `https://crates.io/crates/${crate.name}`,
      texts: found.texts,
    };
    return [entry, ...prebundled(PREBUNDLED_CARGO, 'cargo', crate.name, crate.version, dir)];
  });
}

/**
 * One file: the intro, then each licence text once, under the packages that use it. Texts that differ only in line
 * breaks and spacing count as the same.
 */
function render(intro, entries) {
  const sortKey = (e) => `${e.name.toLowerCase()} ${e.version ?? ''}`;
  const byName = (a, b) => (sortKey(a) < sortKey(b) ? -1 : 1);
  const groups = new Map();
  for (const entry of entries.sort(byName)) {
    const text = entry.texts.map(normalise).join(`\n\n${THIN_RULE}\n\n`);
    const key = text.replace(/\s+/g, ' ');
    const heading = [
      `${entry.name}${entry.version ? ` ${entry.version}` : ''} (${entry.license})` +
        (entry.note ? `, ${entry.note}` : ''),
      entry.url,
    ].join('\n');
    if (!groups.has(key)) groups.set(key, { text, headings: new Set() });
    groups.get(key).headings.add(heading);
  }
  const sections = [...groups.values()].map(({ text, headings }) =>
    [RULE, [...headings].join('\n\n'), THIN_RULE, '', text].join('\n'),
  );
  return `${[intro, ...sections].join('\n\n')}\n`;
}

const files = [
  {
    name: 'THIRD-PARTY-NOTICES.txt',
    intro: 'DeScribe includes the open-source software below. Each is followed by its licence.',
    entries: npmEntries,
  },
];
if (!webOnly) {
  files.push({
    name: 'THIRD-PARTY-NOTICES-DESKTOP.txt',
    intro:
      'The DeScribe Windows app also includes the open-source software below. Each is followed by its licence.',
    entries: cargoEntries,
  });
}

let stale = false;
for (const file of files) {
  const entries = await file.entries();
  const text = render(file.intro, entries);
  const target = path(file.name);
  const current = existsSync(target) ? read(target).replace(/\r\n/g, '\n') : null;
  const kb = `${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`;
  if (check) {
    if (current !== text) {
      console.error(`notices: ${file.name} is out of date.`);
      stale = true;
    } else {
      console.log(`notices: ${file.name} is up to date (${entries.length} packages, ${kb})`);
    }
  } else {
    writeFileSync(target, text);
    console.log(`notices: wrote ${file.name} (${entries.length} packages, ${kb})`);
  }
}
if (stale) stop('run "npm run notices" and commit the result.');
