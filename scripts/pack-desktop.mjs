// Packs the desktop app as an x64 MSIX for the Microsoft Store (DECISIONS.md D35, docs/reference/desktop.md).
// Builds the release exe, stages it with src-tauri/msix/ (the manifest, with package.json's version written in, and
// its assets), then packs the stage with Microsoft's winapp CLI. Unsigned by default: the Store signs MSIX itself.
// Usage: npm run desktop:pack [-- --sign]
//   --sign  signs with a development certificate, devcert.pfx (made on first use, never committed), so the MSIX
//           installs on this PC. Trust it once, as administrator: winapp cert install devcert.pfx
//           After the manifest's Publisher changes, delete devcert.pfx so a matching one is made.
import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const { version } = JSON.parse(readFileSync(path('package.json'), 'utf8'));
const sign = process.argv.includes('--sign');

const exe = path('src-tauri/target/release/describe.exe');
// No trailing separator: in a quoted Windows argument, "…\" would escape the closing quote.
const stage = path('src-tauri/target/msix');
// Beside the stage, not in it: winapp packs every file in the stage and writes the manifest in as AppxManifest.xml.
const stagedManifest = path('src-tauri/target/msix-manifest/Package.appxmanifest');
const name = `DeScribe-v${version}-x64.msix`;
const output = path(`release/${name}`);
const cert = path('devcert.pfx');
// winapp sends anonymous usage data unless this is set (Phase 24, Task 1).
const winappEnv = { ...process.env, WINAPP_CLI_TELEMETRY_OPTOUT: '1' };

function stop(message) {
  console.error(`\npack-desktop: ${message}`);
  process.exit(1);
}

function run(command, env = process.env) {
  console.log(`\npack-desktop: ${command}`);
  execSync(command, { cwd: root, env, stdio: 'inherit' });
}

// 1. The Store reserves an MSIX version's fourth number, which must be 0. The other three are 0–65535, and the
//    first can't be 0 (Microsoft Learn, "App package requirements for MSIX app").
const parts = version.split('.');
const valid =
  parts.length === 3 &&
  parts.every((p) => /^\d+$/.test(p) && Number(p) <= 65535) &&
  Number(parts[0]) > 0;
if (!valid) {
  stop(
    `package.json's version "${version}" can't be an MSIX version: it must be x.y.z, each 0–65535, x not 0.`,
  );
}
const msixVersion = `${version}.0`;

// 2. A development certificate made for another Publisher can't sign the package: say so before the build.
const manifest = readFileSync(path('src-tauri/msix/Package.appxmanifest'), 'utf8');
if (sign && existsSync(cert)) {
  const publisher = manifest.match(/<Identity\b[^>]*?\bPublisher="([^"]*)"/)?.[1];
  let subject;
  try {
    const info = execSync(`winapp cert info "${cert}" --json`, {
      cwd: root,
      env: winappEnv,
      encoding: 'utf8',
    });
    subject = JSON.parse(info).subject;
  } catch {
    stop("winapp couldn't read devcert.pfx. Delete it, then run again.");
  }
  if (subject !== publisher) {
    stop(
      `devcert.pfx is for ${subject}, but the manifest's Publisher is ${publisher}. Delete devcert.pfx and run ` +
        'again, then trust the new certificate once, as administrator: winapp cert install devcert.pfx',
    );
  }
}

// 3. The licences Settings shows must list what this build includes.
try {
  run('node scripts/make-notices.mjs --check');
} catch {
  stop('the third-party notices are out of date (see above). Nothing was packed.');
}

// 4. The release exe, built from this tree (`tauri build --no-bundle` runs build:desktop first).
try {
  run('npm run desktop:build');
} catch {
  stop('the desktop build failed (see above). Nothing was packed.');
}

// 5. The stage holds exactly what goes in the package. The committed manifest keeps its version.
const identityVersion = /(<Identity\b[^>]*?\bVersion=")[^"]*(")/;
if (!identityVersion.test(manifest))
  stop('src-tauri/msix/Package.appxmanifest has no <Identity Version>.');
for (const dir of [stage, dirname(stagedManifest)]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
cpSync(exe, `${stage}/describe.exe`);
cpSync(path('src-tauri/msix/Assets'), `${stage}/Assets`, { recursive: true });
writeFileSync(stagedManifest, manifest.replace(identityVersion, `$1${msixVersion}$2`));

// 6. Pack, signed only for this PC.
mkdirSync(path('release'), { recursive: true });
rmSync(output, { force: true });
try {
  if (sign) {
    run(
      `winapp cert generate --manifest "${stagedManifest}" --output "${cert}" --if-exists skip`,
      winappEnv,
    );
  }
  const signing = sign ? `--cert "${cert}"` : '--no-sign';
  run(
    `winapp pack "${stage}" --manifest "${stagedManifest}" --output "${output}" ${signing}`,
    winappEnv,
  );
} catch {
  stop('winapp failed (see above). Nothing was packed.');
}

const megabytes = (statSync(output).size / 1024 / 1024).toFixed(1);
console.log(`
pack-desktop: done.
  File:     release/${name} (${megabytes} MB)
  Version:  ${msixVersion}
  Signed:   ${sign ? 'with devcert.pfx, for this PC only' : 'no: for the Store, which signs it'}`);
if (sign) {
  console.log(`
  To install it here: trust the certificate once (as administrator: winapp cert install devcert.pfx),
  then double-click the MSIX, or: Add-AppxPackage release\\${name}`);
}
