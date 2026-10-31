// Makes a release: release/DeScribe-v<version>.html plus its SHA-256 (docs/RELEASING.md).
// Refuses to run with uncommitted changes, without a dated CHANGELOG entry for the version, or when the
// version has already been released. Runs every check first (typecheck, lint, unit tests, third-party notices,
// build, single-file check, e2e) and stops at the first failure.
// Usage: npm run release
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const name = `DeScribe-v${version}`;
const releaseDir = fileURLToPath(new URL('../release/', import.meta.url));
const target = `${releaseDir}${name}.html`;

function stop(message) {
  console.error(`\nrelease: ${message}`);
  process.exit(1);
}

// 1. A release must be reproducible from a commit, so the tree must be clean.
const dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim();
if (dirty) {
  stop(`the working tree has uncommitted changes. Commit or stash them first:\n${dirty}`);
}
// 2. A released version is never replaced: colleagues may already have that file.
if (existsSync(target)) {
  stop(`${name}.html already exists. Bump "version" in package.json for a new release.`);
}

// 3. The changelog says what this version is and when it was released.
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const dated = new RegExp(
  `^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`,
  'm',
);
if (!dated.test(changelog)) {
  stop(`CHANGELOG.md has no dated entry "## [${version}] - YYYY-MM-DD". Add one and commit it.`);
}

// 4. Every check, in the order of the Definition of Done.
const run = (cmd) => {
  console.log(`\nrelease: ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
};
try {
  run('npm run typecheck');
  run('npm run lint');
  run('npm test');
  run('node scripts/make-notices.mjs --check --web');
  run('npm run build');
  run('npm run verify:single-file');
  run('npx playwright test --project=chromium');
} catch {
  stop('a check failed (see above). Nothing was released.');
}

// 5. Copy the build and write its checksum in the usual `sha256sum` format.
const source = fileURLToPath(new URL('../dist/describe.html', import.meta.url));
mkdirSync(releaseDir, { recursive: true });
copyFileSync(source, target);
const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
writeFileSync(`${releaseDir}${name}.sha256`, `${sha256}  ${name}.html\n`);
const commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();

console.log(`
release: ${name} built from ${commit}
  file:    release/${name}.html
  sha256:  ${sha256}  (also in release/${name}.sha256)

Before you share it (docs/RELEASING.md):
  [ ] Run the manual checklist in docs/TESTING.md on Edge and Chrome with release/${name}.html
  [ ] Tag the commit: git tag -a v${version} -m "DeScribe ${version}" && git push origin v${version}
  [ ] Upload ${name}.html to SharePoint and keep the previous version's file
  [ ] Optionally replace the stable DeScribe.html copy on SharePoint with this file
`);
