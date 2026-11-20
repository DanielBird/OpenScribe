// Packs the desktop app as an x64 MSIX for the Microsoft Store (DECISIONS.md D35, docs/reference/desktop.md).
// Builds the release exe, stages it with the speech engines' DLLs (src-tauri/stt-runtime/, from npm run
// desktop:stt-runtime; DECISIONS.md D53, D58: the processor's beside the exe, the Vulkan one in vulkan\) and src-tauri/msix/ (the manifest, with package.json's version written in, and
// its assets), then packs the stage with Microsoft's winapp CLI. Unsigned by default: the Store signs MSIX itself.
// Usage: npm run desktop:pack [-- --sign]
//   --sign  signs with a development certificate, devcert.pfx (made on first use, never committed), so the MSIX
//           installs on this PC. Trust it once, as administrator: winapp cert install devcert.pfx
//           After the manifest's Publisher changes, delete devcert.pfx so a matching one is made.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
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

// 2b. The speech engines' DLLs, exactly as npm run desktop:stt-runtime built and listed them (stt-runtime.json names
// the files; each built.json their sizes and hashes). Both always ship (DECISIONS.md D58): the processor's beside the
// exe, and the Vulkan one in its folder.
const runtimeDefinition = JSON.parse(readFileSync(path('src-tauri/stt-runtime.json'), 'utf8'));
const { vulkan } = runtimeDefinition;
const msvcFiles = runtimeDefinition.msvcRuntime.files;

/** Stops unless `folder` (under src-tauri/stt-runtime/) holds the engine stt-runtime.json describes, unchanged. */
function checkEngine({ folder, files, backend, vulkanSdk, rebuild }) {
  const label = `src-tauri/stt-runtime/${folder ? `${folder}/` : ''}`;
  const dir = path(label);
  if (!existsSync(`${dir}/built.json`)) {
    stop(`${label} has no engine. Run ${rebuild} first. Nothing was packed.`);
  }
  const built = JSON.parse(readFileSync(`${dir}/built.json`, 'utf8').replace(/^\uFEFF/, ''));
  if (built.version !== runtimeDefinition.version) {
    stop(
      `${label} holds ${built.name} ${built.version}, but stt-runtime.json names ` +
        `${runtimeDefinition.version}. Run ${rebuild} again. Nothing was packed.`,
    );
  }
  // The processor engine's built.json from Phase 33 predates `backend`.
  if ((built.backend ?? 'cpu') !== backend) {
    stop(
      `${label} holds a ${built.backend} engine, not ${backend}. Run ${rebuild}. Nothing was packed.`,
    );
  }
  if (vulkanSdk && built.vulkanSdk !== vulkanSdk) {
    stop(
      `${label} was built with Vulkan SDK ${built.vulkanSdk}, but stt-runtime.json names ${vulkanSdk}. ` +
        `Run ${rebuild} again. Nothing was packed.`,
    );
  }
  for (const name of files) {
    const file = `${dir}/${name}`;
    const listed = built.files.find((f) => f.name === name);
    if (!existsSync(file) || !listed) stop(`${label}${name} is missing. Nothing was packed.`);
    const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (sha256 !== listed.sha256 || statSync(file).size !== listed.bytes) {
      stop(`${label}${name} has changed since it was built. Nothing was packed.`);
    }
  }
  return { dir, files };
}

const engines = [
  {
    // Beside the exe, which loads it from its own folder (src-tauri/src/stt/nemo.rs).
    to: '',
    ...checkEngine({
      folder: '',
      files: [...runtimeDefinition.engineFiles, ...msvcFiles],
      backend: 'cpu',
      rebuild: 'npm run desktop:stt-runtime -- -Only cpu',
    }),
  },
  {
    // The folder name is VULKAN_FOLDER in src-tauri/src/stt/commands.rs.
    to: `${vulkan.folder}/`,
    ...checkEngine({
      folder: vulkan.folder,
      files: [...vulkan.engineFiles, ...msvcFiles],
      backend: 'vulkan',
      vulkanSdk: vulkan.vulkanSdk,
      rebuild: 'npm run desktop:stt-runtime -- -Only vulkan',
    }),
  },
];

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
for (const engine of engines) {
  mkdirSync(`${stage}/${engine.to}`, { recursive: true });
  for (const name of engine.files) cpSync(`${engine.dir}/${name}`, `${stage}/${engine.to}${name}`);
}
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

/** The bytes of every file under `dir`. */
function treeBytes(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((sum, entry) => sum + statSync(join(entry.parentPath, entry.name)).size, 0);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(`
pack-desktop: done.
  File:     release/${name} (${mb(statSync(output).size)} MB; installed ${mb(treeBytes(stage))} MB)
  Version:  ${msixVersion}
  Signed:   ${sign ? 'with devcert.pfx, for this PC only' : 'no: for the Store, which signs it'}`);
if (sign) {
  console.log(`
  To install it here: trust the certificate once (as administrator: winapp cert install devcert.pfx),
  then double-click the MSIX, or: Add-AppxPackage release\\${name}`);
}
