# Phase 10 — Spike: project folder on `file://` and OneDrive

**Goal:** Find out whether Describe, opened from `file://` in Edge and Chrome, can use a OneDrive folder as a
project folder through the File System Access API. Record the facts in a new reference doc, and give a go/no-go
for Phases 14–15. No app code changes in this phase.

**Depends on:** nothing. It can run alongside Phases 11, 12 and 13. Start from `main`. If **Edit text** (Phase 9)
should reach colleagues before release 2, release 1.1 from `main` first (see [RELEASING.md](../RELEASING.md)).
From Phase 11 on, `main` holds unfinished release-2 work until Phase 18.

**Read first:** [PROJECTS.md](../PROJECTS.md) §4, §5.2, §6, §7 and §9 Q4; [DECISIONS.md](../DECISIONS.md) D3, D18,
T11; [reference/elevenlabs-stt.md](../reference/elevenlabs-stt.md), for the style of a reference doc with a
verification log.

## Who does what

This phase needs the maintainer's hands. The checks run in real Edge and Chrome on Windows, against a real OneDrive
folder, and the folder picker can't be automated.

1. **The agent** builds the probe page, the file generator and the checklist (Tasks 1–3). It runs the checks that
   Playwright can do on its own (Task 4), then hands over to the maintainer.
2. **The maintainer** runs the checklist in Edge and in Chrome, and pastes the results into the reference doc (or
   into the session for the agent to write up).
3. **The agent** writes the conclusions and the go/no-go (Task 5).

## Tasks

1. **`scripts/spikes/fsa-probe.html`**: one self-contained page, with inline script and no build step. Each check
   has a button and a result line, and the page lists all its results as one block with **Copy results**.
   - Show `navigator.userAgent`, `window.isSecureContext`, `'showDirectoryPicker' in window` and
     `location.protocol`.
   - **Pick folder** (`showDirectoryPicker({ id: 'describe-project', mode: 'readwrite' })`): show the folder name,
     or the error's `name` and `message`.
   - **Store handle / Load handle:** put the handle in IndexedDB (database `describe-probe`), read it back after a
     reload, and show `queryPermission({ mode: 'readwrite' })`. **Request permission** calls `requestPermission`
     from a click.
   - **List:** names, kinds, and for files `size` and `lastModified` (via `getFile()`). Time it.
   - **Read all:** read and `JSON.parse` every `*.json` file in `sessions/`. Show the count, total MB and time,
     and any errors by name.
   - **Write:** write `probe-<timestamp>.json` (about 1 MB) with `createWritable()`, then list the folder at once.
     Note any temporary files.
   - **Overwrite twice quickly:** two writes of one file 100 ms apart.
   - **Clipboard:** `navigator.clipboard.writeText('probe')`.
   - **OPFS:** `navigator.storage.getDirectory()`, create a file with `createWritable()`, read it back, and store
     that handle in IndexedDB.
   - The page uses only the APIs above. It makes no network requests and loads nothing from the network.
2. **`scripts/spikes/make-probe-files.mjs <folder> [count=300] [mb=0.7]`**: writes `count` JSON files of about
   `mb` MB each into `<folder>/sessions/`. They are TranscriptDoc-shaped random text, close enough to real
   transcript files for the read timings to mean something.
3. **The checklist:** a section of `docs/reference/file-system-access.md`, with one row per check and a column
   each for Edge and Chrome. Write down the browser versions. The checks:

   | ID | Check |
   |---|---|
   | F1 | The page opened from `file://`: secure context true, `showDirectoryPicker` present. |
   | F2 | Pick a subfolder of the OneDrive folder (e.g. `OneDrive - Demant\Describe probe`). Also try the OneDrive root, `Documents`, `Desktop` and `Downloads`, and note which ones the browser refuses. |
   | F3 | Write a file. It shows in Explorer, and OneDrive syncs it: check on OneDrive on the web or another PC. Note any `.crswap` or other temporary files, and whether OneDrive syncs them. |
   | F4 | Reload the page, then **Load handle**: what does `queryPermission` say? Then **Request permission**: what does the prompt offer? Is "Allow on every visit" there? |
   | F5 | After choosing "Allow on every visit" (if offered): reload, close and reopen the browser, and restart Windows. Is permission still granted without a prompt each time? |
   | F6 | Copy the probe to another file name and folder (e.g. `Desktop\probe-copy.html`) and open it. Is the stored handle readable there, and with which permission? (Every `file://` page shares one storage, D3.) |
   | F7 | Generate 300 files (`make-probe-files.mjs`) into the OneDrive folder and let them sync. **List** and **Read all**: record the times. |
   | F8 | Mark the folder **Free up space** (online only). **List**: are size and `lastModified` there without downloading? **Read all**: record the time, and whether the files are now kept locally. |
   | F9 | Disconnect the network with the files online only. **Read all**: which error (`name`, `message`)? |
   | F10 | Change one file from two places while offline, then reconnect, to provoke a OneDrive conflict. Record the conflict copy's exact name. If a second PC or account isn't available, record what Microsoft documents and mark the row as not run. |
   | F11 | Rename or delete a file in Explorer while the page is open, then **Read all**: which error? |
   | F12 | **Overwrite twice quickly:** does the second write fail, or leave a stray file? |
   | F13 | **Clipboard** works from `file://`. |
   | F14 | **OPFS** works on `file://`, and its handle can be stored in IndexedDB. |

4. **Automated checks:** run the probe in Playwright's Chromium over `file://` for F1, F13 and F14. Use a
   throwaway script in your scratch space, not a spec in `tests/e2e/`. Record the results in the doc as
   *Playwright Chromium* rows. They tell Phase 14 whether its e2e folder harness can use OPFS.
5. **`docs/reference/file-system-access.md`**, in the style of the other reference docs:
   - **Facts:** what works, with versions, timings and error names, from the verification log.
   - **Rules for Phase 14:** how to ask for permission again, which errors map to which message, which file names
     to ignore (temporary files, conflict copies), and the conflict-copy naming pattern.
   - **E2E harness:** OPFS or an in-memory handle (F14).
   - **Go/no-go:**
     - If F1–F4 pass in both browsers, it's a go, and the doc says which mitigations Phase 14 must build.
     - If not, list what failed. The maintainer decides PROJECTS.md §9 Q4 before Phase 14 starts. Record that
       decision in DECISIONS.md and in this file's Handoff.
6. **Update [PROJECTS.md](../PROJECTS.md):** §7 R1–R3 with what was learned, and §5.2 if the folder rules change
   (e.g. a different conflict-copy pattern). Keep `scripts/spikes/` in the repo: it's the quickest way to check a
   new browser version again.

## Contracts introduced

None. This phase produces facts, not code.

## Acceptance criteria

- [ ] The probe and the generator run as described. The probe makes no network requests, and passes Prettier.
- [ ] Every row F1–F14 has a result for Edge and for Chrome, or is marked *not run* with a reason.
- [ ] `docs/reference/file-system-access.md` has the facts, the rules for Phase 14, the harness choice and a
      go/no-go.
- [ ] PROJECTS.md §7 (and §5.2 if needed) is updated. On a no-go, the maintainer's choice for Q4 is recorded in
      DECISIONS.md.
- [ ] `npm run lint` passes. App code, `npm test` and the build are unchanged.

## Required tests

None beyond the automated checks in Task 4. The probe is not part of `npm test` or `test:e2e`.

## Out of scope

- Any change under `src/`.
- Microsoft Graph or any network-based alternative (T11).
- Firefox.

## Handoff

*(Browser versions, the go/no-go, anything Phase 14 must do differently from PROJECTS.md §5.2.)*

**Part A (2026-10-15): the probe, the generator and the checklist.** The Edge and Chrome runs are pending.
- **Branch:** the maintainer chose to work on `release-2-plan`, which holds the release-2 docs, rather than on a
  `phase-10-folder-spike` branch from `main`.
- **A separate commit first:** `fix: ignore gitignored local tooling (.claude, .impeccable) in ESLint`. ESLint
  doesn't read `.gitignore`, so the impeccable skill's scripts under `.claude/` made `npm run lint` fail locally.
- **What the probe adds to the task list:**
  - full browser versions (`userAgentData`);
  - a **sessions/ fingerprint** in **List**, to see whether "Free up space" or a read changes `lastModified` or
    size, which the text cache is keyed on;
  - a **parallel** setting for **Read all**;
  - **Read all** reads the files from the last **List**, so F11 can rename a file in between;
  - a **Note** field;
  - a log that survives reloads and restarts.
  - **Overwrite twice quickly** keeps write A open for about 200 ms, so B really overlaps it.
- **The generator** writes `SessionTranscriptFile`s (PROJECTS.md §5.2) with seeded ids, so a second run overwrites
  the same files.
- **Playwright results** (the reference doc has the details):
  - F1 passes.
  - **F13:** the clipboard needs a permission grant in the headless shell.
  - **F14: OPFS fails on `file://`** (`SecurityError`). The flag that allows it also changes `window.origin` to
    `file://`.
  - **So Phase 14's harness uses an in-memory handle.** It was proven with the probe, including surviving reloads
    and IndexedDB, and a `prompt` permission.
- **Part B to do:**
  - fill in the Edge and Chrome columns from the maintainer's results;
  - write the Facts, the Rules for Phase 14 and the go/no-go;
  - update PROJECTS.md §7 R1–R3 (and §5.2 if F10 shows a different conflict-copy pattern);
  - set ROADMAP to ☑.

**Part B (2026-10-15): results and go/no-go.**
- **Go.** F1–F4 pass in Edge 155.0.4283.45 and Chrome 155.0.8059.40, on the maintainer's PC with a personal
  OneDrive. The facts, the rules for Phase 14 and the harness are in `reference/file-system-access.md`. DECISIONS.md
  T14 records the go.
- **What Phase 14 must do differently from PROJECTS.md §5.2** (now updated):
  - **Reconnect** once per browser session: `file://` never offers "Allow on every visit".
  - Conflict copies are `<base>.<kind>-<device>.json`, not `<base>-<device>.<kind>.json`. `classifySessionFile` treats
    any text between the kind and `.json` as a copy marker.
  - `NotReadableError` (an online-only file, offline) is not a permission problem, despite its message.
  - Read files one at a time, and keep the refresh in the background: a listing took about 11 s once while OneDrive
    caught up.
  - The e2e harness is an in-memory folder: OPFS throws `SecurityError` on `file://`.
- **Also updated:**
  - PROJECTS.md §6 (the harness) and §9 Q4 (not needed after the go);
  - ROADMAP §5 (`scripts/spikes/`) and §7 (☑).
- **Not run, with reasons in the checklist:**
  - F1's browser policies (a personal PC);
  - F2's refused folders (Chromium refuses them by design);
  - the prompts' wording (it only matters for the User Guide);
  - Chrome's F8 download (OneDrive does the downloading, and Edge measured it).
- **The run itself:**
  - The OneDrive client wasn't running during the first Edge and Chrome runs. Every check that depends on OneDrive
    was run again after it was started; the checklist says which.
  - The maintainer's `OneDrive\Describe probe` folder still holds the test files, and `P001…` is in OneDrive's online
    recycle bin. The folder can be deleted, or kept for rechecks.
- **Open:** run F1–F4 once on a Demant-managed laptop with `OneDrive - Demant`, and check `edge://policy`. This
  belongs with Phase 14's manual TESTING.md row.
- **Agreed UI text:** none. The probe is a developer tool, not app UI, so D13 didn't apply.
