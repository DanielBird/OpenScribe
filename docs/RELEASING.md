# Releasing DeScribe

A release is one file, `DeScribe-v<version>.html`, shared on SharePoint. This page is for the maintainer.

## Versions

- `version` in `package.json` is the release number ([Semantic Versioning](https://semver.org)). The footer shows
  it, along with the build date.
  - **Patch** (1.0.1): fixes.
  - **Minor** (1.1.0): new features.
  - **Major** (2.0.0): changes that drop support for something colleagues rely on.
- Every release has a dated entry in [CHANGELOG.md](../CHANGELOG.md).

## Steps

1. **Prepare a commit on `main`:**
   - `npm version <x.y.z> --no-git-tag-version`
   - Move the *Unreleased* notes into `## [x.y.z] - YYYY-MM-DD` in CHANGELOG.md.
   - Commit.
2. **Run `npm run release`** from that commit. The script:
   - refuses to run with uncommitted changes, without a dated CHANGELOG entry for the version, or when
     `release/DeScribe-v<version>.html` already exists (a released file is never replaced);
   - runs typecheck, lint, the unit tests, a check that `THIRD-PARTY-NOTICES.txt` is up to date (`npm run notices`
     fixes it), the build, `verify:single-file` and the e2e tests, and stops at the first failure;
   - writes `release/DeScribe-v<version>.html` and `release/DeScribe-v<version>.sha256` (`release/` is gitignored);
   - prints the checklist for the steps below.
3. **Run the manual checklist** in [TESTING.md](TESTING.md) on Edge and Chrome with the release file. If a scenario
   fails, fix it, bump the patch version and start again. A file that has failed is never shared.
4. **Tag the commit:** `git tag -a v<x.y.z> -m "DeScribe <x.y.z>"` then `git push origin v<x.y.z>`.
5. **Upload to SharePoint** (below).

Optional: `npm run test:perf` measures a 3-hour transcript (see TESTING.md). Run it when a change touches the
transcript view, export or autosave.

### Check a downloaded file

The `.sha256` file holds the checksum of the release. In PowerShell:

```powershell
Get-FileHash .\DeScribe-v2.0.0.html -Algorithm SHA256
```

The hash must match the first word of `DeScribe-v2.0.0.sha256`. The comparison ignores case.

## SharePoint

- Upload `DeScribe-v<version>.html` and **keep the previous version's file**, so colleagues can go back if the new
  one has a problem.
- Optionally, keep a stable `DeScribe.html` that is overwritten with each release. Links and bookmarks then always
  get the latest version, and SharePoint's version history keeps the old ones.
- Tell colleagues what changed. The CHANGELOG entry is written for that.

## Saved data across versions

Chromium gives every HTML file opened from disk (`file://`) the same storage. Every version of DeScribe therefore
reads and writes the same saved data:

| What | Where |
|---|---|
| API keys | `localStorage` (remembered) or `sessionStorage` (this tab): `describe.v1.key.elevenlabs`, `describe.v1.key.claude`, `describe.v1.key.gemini` |
| Glossary | `localStorage`: `describe.v1.glossary` |
| Settings | `localStorage`: `describe.v1.prefs` |
| Last transcript | IndexedDB database `describe-v1`, store `keyval`, key `describe.v1.lastTranscript` |

So colleagues' glossaries, settings and remembered keys carry over to a new version. They also stay visible to an
older version that someone opens again.

Two consequences:
- Two open tabs share this data, and the last one to save wins. Nothing locks it; the User Guide tells colleagues
  to use one tab.
- Any other HTML file opened from disk can read this storage (DECISIONS D3). That's why remembering a key is
  opt-in.

### Storage migration policy (DECISIONS D18)

Any change to the **shape** of stored data needs one of these:
- a **new namespace**: `describe.v2.*` keys and a `describe-v2` database, so old and new versions don't read each
  other's data; or
- a **migration function** in `src/storage/` that upgrades the old shape when it's read, and leaves data that older
  versions can still read, or is safe for them to ignore.

It also needs a DECISIONS entry. Readers already validate what they load (zod) and fall back to defaults; they never
try to repair it. Adding a new optional preference with a default doesn't count as a shape change.

Data that DeScribe writes back (the project file, transcripts, chats) keeps the fields a build doesn't know, so a new
optional field survives an older build's save (DECISIONS D38). Versions 1.1.0 and earlier still drop such fields.

Project folders are shared too, by colleagues who may run different versions. The same policy applies to their
files (`describe-project.json`, `sessions/`, `chats/`), with each file's `schemaVersion` in place of a namespace
(DECISIONS D40).
