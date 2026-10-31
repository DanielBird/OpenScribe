# Phase 8 — Hardening & release

**Goal:** A polished, accessible, documented 1.0 that holds up under real recordings and real corporate
conditions, released as a versioned single HTML file on SharePoint.

**Depends on:** Phases 0–7.

**Read first:** everything in `docs/`, especially the verification logs in `docs/reference/`.

## Tasks

1. **Accessibility**
   - Add `@axe-core/playwright`, and an e2e spec that runs axe on each step (Setup, Glossary, Output with a
     transcript, the dialogs open). There must be no serious or critical violations.
   - Do a keyboard-only walk-through of the full flow and fix any focus traps or missing focus states.
   - Dialogs return focus to their trigger. Changing step focuses the view's `<h1>`.
   - Check colour contrast in light theme (and dark, if implemented).
2. **Performance**
   - `scripts/make-large-fixture.mjs` generates a synthetic 3 h, 4-speaker transcript (about 2000 turns, about 25k
     words).
   - Measure the time to render the Output tab, scrolling, rename latency, docx export time, and autosave time.
     Targets: render < 1 s, rename < 100 ms, export < 5 s.
   - If a target is missed, apply in this order: `v-memo`, CSS `content-visibility: auto` on turns, and only then
     list virtualisation.
3. **Robustness review**
   - Very short audio, silence (0 turns), a single speaker, 32 speakers, a long file name, unicode file names.
   - Storage unavailable (simulate `localStorage` throwing): the app works and simply doesn't remember.
   - IndexedDB quota error: show a warning and continue.
   - Offline: clear network error messages.
   - Two tabs open: the last write wins. Document this; no locking is needed.
4. **Copy and empty states:** review every user-facing string for plain, consistent English. Keep them in one place
   per component. Avoid jargon ("diarization" → "speaker separation").
5. **`AboutDialog.vue`** (opened from a footer link)
   - Version and build date.
   - The data-flow statement (from `reference/llm-providers.md`).
   - Where keys are stored and how to forget them (a **Forget all keys** button).
   - **Clear saved data** (glossary, prefs, last transcript), with confirmation.
   - Links to the ElevenLabs, Anthropic and Google privacy and terms pages.
6. **`docs/USER_GUIDE.md`** (for colleagues; short, with screenshots)
   - Getting the file: download it from SharePoint. Open it in Edge or Chrome by double-clicking, or right-click →
     *Open with* → Edge.
   - Getting an ElevenLabs key: create a key in the ElevenLabs dashboard, **restrict it to Speech-to-Text**, and
     consider a credit limit. The same for Claude and Gemini keys (optional).
   - The workflow, step by step. Glossary tips (what to include: product names, people's names, acronyms).
   - Translation: when to use it, and what is sent.
   - Privacy notes: zero retention (Enterprise), the "remember key" caveat on shared computers.
   - Troubleshooting:
     - Network blocked by a corporate proxy: ask IT to allow the 3 API hosts.
     - File too large: export audio only (e.g. from Teams).
     - Playback unsupported: convert to mp3.
     - Lost transcript: autosave keeps only the last one.
7. **Release process**
   - `scripts/release.mjs`:
     - Refuses to run with a dirty git tree.
     - Runs typecheck, lint, test, build, verify and e2e.
     - Copies the build to `release/Describe-v<semver>.html` and writes `release/Describe-v<semver>.sha256`.
     - Prints a checklist.
   - `CHANGELOG.md` (Keep a Changelog format). Tag `v1.0.0`.
   - SharePoint guidance (in `docs/RELEASING.md`):
     - Upload the versioned file and keep the previous one.
     - Optionally keep a stable `Describe.html` copy that is overwritten each release.
     - Storage keys are `describe.v1.*` and shared by all local files in Chromium, so users' glossaries and keys
       carry over between versions.
   - Storage migration policy: any change to the shape of stored data needs a new version namespace or a migration
     function in `storage/`, plus a DECISIONS entry.
8. **Manual smoke-test checklist** in `docs/TESTING.md`, run on Edge **and** Chrome (Windows), using the downloaded
   release file:

   | # | Scenario | Edge | Chrome |
   |---|---|---|---|
   | 1 | Open the file from Downloads (with Mark of the Web) and check there are no warnings or blocked features | ☐ | ☐ |
   | 2 | 5 min English interview, 2 speakers, auto language, no glossary | ☐ | ☐ |
   | 3 | 15 min German meeting, 4 speakers, language=German, glossary of 30 terms | ☐ | ☐ |
   | 4 | 10 min French recording, speakers=Auto | ☐ | ☐ |
   | 5 | 60+ min file (V4): completes, timer runs, result correct | ☐ | ☐ |
   | 6 | Rename speakers → export Original docx → opens cleanly in Word | ☐ | ☐ |
   | 7 | Translate the German transcript with Claude, then with Gemini → export English docx | ☐ | ☐ |
   | 8 | Click turns → playback is in sync; Follow works; shortcuts work | ☐ | ☐ |
   | 9 | Reload mid-way → autosave restores the transcript; re-attach audio → playback | ☐ | ☐ |
   | 10 | Wrong key → clear error; cancel mid-upload → clean state | ☐ | ☐ |
   | 11 | Zero retention on (Enterprise key if available; otherwise check the expected error) | ☐ | ☐ |
   | 12 | Remember-key on/off behaviour across reload and browser restart | ☐ | ☐ |

## Acceptance criteria

- [x] The axe e2e spec passes. The keyboard-only walk-through passes. *(Both automated: `a11y.e2e.ts`,
      `keyboard.e2e.ts`.)*
- [x] The performance targets are met on the large fixture (record the numbers in the Handoff). *(After D17.)*
- [x] `npm run release` produces the versioned file and checksum on a clean tree.
- [x] `docs/USER_GUIDE.md`, `docs/RELEASING.md`, `docs/TESTING.md` and `CHANGELOG.md` exist.
- [ ] The manual checklist is complete on both browsers, or any failures are logged as issues with notes.
      *(Open: the maintainer runs it on the release file; see `docs/TESTING.md`.)*
- [x] Every verification-log item in `docs/reference/*` is resolved (no *pending* left), or explicitly accepted as
      a known limitation. *(V4 and L3 are accepted until checklist scenarios 5 and 7 are run.)*

## Out of scope

New features. Anything new goes to [future.md](future.md).

## Handoff

*(Performance numbers, open issues, release link.)*

### 2026-10-14 — Phase 8 done (branch `phase-8-hardening-release`, based on `main` at `ca6a064`)

**Still to do (the maintainer):**
- Run the 12-scenario manual checklist in `docs/TESTING.md` on Edge and Chrome, using the release file. Scenario 5
  records V4 and scenario 7 records L3.
- Then tag `v1.0.0`, and upload the file to SharePoint (`docs/RELEASING.md`).
- No live API calls were made in this phase (CLAUDE.md). `CAR0004edit.m4a` was only used locally, to check real
  AAC playback in the browser pane. It was not committed.

**Decisions (taken with the maintainer)**
- **D17: the speaker column is a fixed 12rem in every turn.** Before, the turn list was one grid with `subgrid`
  and a shared `fit-content(12rem)` column. See *Performance* below.
- **D18: the storage migration policy.**
- **T10: the `braces` npm-audit advisory is accepted.** It is dev-only, and there is no fixed version.
- **Live checks stay manual.** V4 and L3 are recorded as accepted for 1.0 until checklist scenarios 5 and 7 are run.
- **AC-3 audio in Chrome** is documented as a known limitation (V6, the User Guide, the CHANGELOG). Detecting it
  is in `future.md` F4.
- **No screenshots in the User Guide.** No dark theme.
- **Perf tests are opt-in** (`npm run test:perf`), not part of `test:e2e` or the release run.
- **The version and tag:** `package.json` is `1.0.0` and the CHANGELOG entry is dated 2026-10-14. The tag is not
  created; RELEASING.md says to tag after the manual checklist.

**Performance** (`npm run test:perf`: 3 h, 4 speakers, 25,001 words, 2,209 turns; full table in `docs/TESTING.md`)
- **Before D17:**
  - Render after transcription 201 ms, Open 108 ms, export 170 ms, autosave write 18 ms; smooth scrolling.
  - Rename was 33 ms per ordinary keystroke, but 58–100 ms once the typed name became the longest. Each such
    keystroke widened the shared column and re-wrapped every paragraph.
  - At 4× CPU throttling: 165 ms and 300–420 ms.
  - Profiling: the layout of the 2,209-row subgrid was about two-thirds of the time; Vue's update took about 7 ms.
- **Tried in the phase's order:**
  - `v-memo` was already there.
  - `content-visibility: auto` on `.turn`: a size-contained item can't be a subgrid, so the column broke, and paint
    containment clipped the playing-turn bar.
  - `content-visibility` on `.text` only: rename went to 48 ms, and scrolling got much worse at 4× (p95 250 ms).
  - Both were reverted. No virtualisation was needed.
- **After D17** (one grid per turn, fixed column):
  - 1×: render 198 ms, Open 113 ms, rename mean 19 / max 28 ms, export 186 ms, autosave write 31 ms.
  - 4×: render 979 ms, Open 544 ms, rename 113 / 190 ms, export 818 ms.
  - All targets are met at 1×. The 4× numbers are for information only.

**Accessibility**
- **axe** (wcag2a/aa, 21a/aa, 22aa) runs on Setup, Glossary, Output (playing, English, failed run, no audio) and
  on every dialog. It found no serious or critical violations, and no moderate or minor ones either. A probe with
  an unlabelled input and grey text confirmed that axe really runs.
- **Keyboard:** `keyboard.e2e.ts` does the whole flow by keyboard. At every Tab stop it checks for a visible focus
  indicator, and it checks focus after each step change and dialog close.
  - Inside the native `<audio>` controls, Chromium draws its own ring on the inner button (checked by screenshot).
    The helper accepts media elements for that reason.
  - Nothing needed fixing.

**About dialog**
- `AboutDialog.vue` opens from the footer (`v1.0.0 · built … · About`).
  - The shared `<dialog>` logic moved from `ConfirmDialog` into `ui/composables/useModalDialog.ts`.
  - New store `stores/savedData.ts` with `clearSavedData()`.
  - `settings` gains `keyLocations`, `forgetAllKeys()` and `resetPrefs()`; `transcript` gains `clear()`.
  - `job.dismiss()` now also clears a finished run, so Output locks again after Clear saved data. An active run is
    left alone.
- **UI text trimmed (D13):**
  - No version line in the dialog: the footer already shows it.
  - Key lines only for stored keys ("ElevenLabs: remembered on this computer" / "…: until this tab closes").
    Otherwise "No API keys are saved.", which takes focus after **Forget all keys**, since the button disappears.
  - **Clear saved data…** has no description of its own; the danger confirmation says what is deleted and that keys
    stay. "Saved data cleared." is announced, not shown.
- The privacy and terms URLs were checked (HTTP 200) on 2026-10-14.

**Copy review**
- Removed the Setup hint "Only needed if you want to translate transcripts to English.". The summary
  "Translation keys (optional)" already says it.
- The zero-retention error said "Untick", but Setup has used an On/Off switch since `40553a1`. It now says
  `Switch off "Zero retention" on the Setup tab and try again.` (also in the reference doc).
- Both not-saving notices now end "…when you close the tab.".
- "does not support" → "doesn't support" (the multichannel message).
- Nothing else needed changing. The UI already says "speaker separation", not "diarization".

**Robustness** (`robustness.e2e.ts`)
- **Covered:**
  - a 50 ms recording (refused)
  - silence (new fixture `silence`)
  - one speaker
  - 32 speakers at 375 px (new fixture `thirty-two-speakers`)
  - a 150-character file name with umlauts, CJK and emoji (the `.docx` name is cut to 120)
  - `localStorage`/`sessionStorage` throwing
  - IndexedDB `put` throwing `QuotaExceededError`
  - offline for ElevenLabs (Verify key and Run) and for Claude
- **Two tabs:** last write wins, documented in the User Guide and RELEASING.md.
- Everything already worked; no app code changed for these.

**Release**
- `scripts/release.mjs` refuses:
  - a dirty tree
  - a version without a dated CHANGELOG entry
  - an existing `release/Describe-v<version>.html`

  Then it runs every check, writes the `.html` and a `sha256sum`-style `.sha256`, and prints the checklist.
  Checked: it refuses on a dirty tree, and produces both files from a clean worktree of the phase commit.
- `test:e2e` now runs `--project=chromium`. The new `perf` project matches `*.perf.ts`, and
  `fixtures/large/` is gitignored.

**Checks**
- **Mutation spot checks:** 9 deliberate bugs, each caught:
  - `clearSavedData` skipping the glossary
  - `forgetAllKeys` missing Gemini
  - the modal not returning focus
  - `transcript.clear` letting a late autosave back in
  - `dismiss` ignoring a finished run
  - `resetPrefs` leaving prefs stored
  - Forget all keys not moving focus
  - Clear without confirmation
  - unguarded `localStorage` reads (caught by the robustness e2e)
- Removing only `getStorage`'s own try/catch is *not* caught, because `readJson`/`writeJson` guard again; it's a
  redundant second layer.
- **Browser pane** (dev server, a doc seeded to match `CAR0004edit.m4a`):
  - Attaching it matched with no prompt.
  - Clicking `00:00:46` played the real AAC audio, and the highlight moved from t7 to t8 with Follow.
  - Forget all keys and Clear saved data emptied storage and IndexedDB, and the app went back to Setup.
  - The About dialog fits at 375 px (337 × 672).
  - No console errors.

**Tests:** 749 unit tests (up from 727) and 59 e2e tests (up from 41), plus typecheck, lint, the build and
`verify:single-file`.
- New: the `savedData`, `AboutDialog` and e2e `about`, `a11y`, `keyboard` and `robustness` specs, plus the perf
  spec.
- Additions to the `settings`, `transcript`, `job` and `App` specs.

**Bundle:** 1,322 KB.

**Not part of this phase:** `docs/phases/09-edit-text.md` appeared in the working tree from another session. It
was left uncommitted.
