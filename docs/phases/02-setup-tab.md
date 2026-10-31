# Phase 2 — Setup tab

**Goal:** A complete Setup step. Users enter and optionally remember API keys, pick an audio or video file (whose
size and duration are checked before upload), set the language, number of speakers and zero retention, and
continue with **Next** only when everything is valid.

**Depends on:** Phase 1 (`checkFile`, `ELEVENLABS_LIMITS`, `verifyKey`).

**Read first:** [DECISIONS.md](../DECISIONS.md) D2, D3, D5, [reference/elevenlabs-stt.md](../reference/elevenlabs-stt.md)
(limits, V2, V3 results).

## Tasks

1. **`src/storage/secrets.ts`**
   - `type KeyProvider = 'elevenlabs' | 'claude' | 'gemini'`.
   - `loadKey(p)`: read `localStorage` first, then `sessionStorage`.
   - `saveKey(p, value, remember)`: when `remember`, write to local and delete from session. Otherwise write to
     session and delete from local. An empty value deletes the key from both.
   - `isRemembered(p)`.
   - `forgetKey(p)`: delete from both.
   - Storage keys: `describe.v1.key.<provider>`. Go through `storage/local.ts`.
2. **`stores/settings.ts`** (implement the Phase 0 skeleton)
   - On init, load the keys and the `remember` flags. Setting a key or flag saves immediately via `secrets.ts`.
   - Load and save `prefs` (`languageHint`, `zeroRetention`) under `describe.v1.prefs`. `numSpeakers` and `file`
     are per run and not persisted.
   - `setFile(file)`: probe the duration, run `checkFile` and store `fileCheck`. A newer selection cancels an
     in-flight probe.
   - `isReady` = ElevenLabs key non-empty ∧ file set ∧ `fileCheck.ok` ∧ (`numSpeakers` null or an integer 1–32).
   - `missingRequirements: string[]` lists human-readable reasons, shown next to the disabled Next button.
3. **`src/ui/media/probeDuration.ts`:** `probeDuration(file, timeoutMs = 10000): Promise<number | null>`. Uses an
   off-DOM `<audio preload="metadata">` with an object URL. Resolves `null` on error or timeout, and when the
   duration is `Infinity` or `NaN`. Always revokes the URL.
4. **`ApiKeyField.vue`** (reusable)
   - Props: `provider`, `label`, `required`.
   - A password input with a show/hide button (`aria-pressed`).
   - A **"Remember on this computer"** checkbox with help text: *"Stores the key in this browser. Any web page you
     open from a file on this computer can read it. Leave unticked on shared computers."*
   - A "Forget key" link when a key is remembered.
   - A **"Test key"** button only if the provider has `verifyKey`. It shows ✓ or ✗ with the result's `message`
     (`aria-live`). ElevenLabs has one (Phase 1, V3). It sends a transcription request with no audio, so it is free
     and works with keys restricted to Speech-to-Text. `verifyKey` returns `{ ok, message }` for every outcome,
     including network errors, and rejects only when its `AbortSignal` fires. Abort the check if the user edits
     the key while it runs. Claude and Gemini get one in Phase 6.
5. **`FileDrop.vue`**
   - A "Choose file…" button (hidden `<input type="file" accept="audio/*,video/*,.m4a,.wma,.mkv,.opus">`) plus a
     drag-and-drop zone with a keyboard-accessible equivalent.
   - Shows the name, size (`formatBytes` → KB/MB/GB, one decimal) and duration (`HH:MM:SS` or *"unknown"*).
   - Lists errors in red and warnings in amber. A "Remove" button clears the selection.
   - Never reads the file into memory.
6. **`SetupView.vue`** (in this order)
   1. **ElevenLabs API key** (required) with a link to the ElevenLabs API keys page.
   2. A collapsed `<details>` **"Translation keys (optional)"** with the Claude and Gemini `ApiKeyField`s and the
      line *"Only needed if you want to translate transcripts to English."*
   3. **Recording** (`FileDrop`).
   4. **Options:**
      - **Language** select: Auto-detect / English / German / French.
      - **Number of speakers**: a number input with placeholder "Auto" and min 1, max 32. Empty means Auto. Help
        text: *"Set this if you know it (e.g. 2 for an interview). It improves speaker separation."*
      - **Zero retention (ElevenLabs Enterprise only)** checkbox. Help text: *"Asks ElevenLabs not to store your
        audio or transcript. Only Enterprise plans can use it; on other plans ElevenLabs refuses the
        transcription."* (V2 confirmed it: 403, and the job shows a message telling the user to untick the box.)
   5. Footer: **Next ▶** (disabled until `isReady`), with `missingRequirements` listed beside it.
7. **Styling:** single column, max-width about 720 px, clear section headings, using tokens only.

## Contracts introduced

```ts
// src/storage/secrets.ts
export type KeyProvider = 'elevenlabs' | 'claude' | 'gemini';
export function loadKey(p: KeyProvider): string;            // '' if none
export function saveKey(p: KeyProvider, value: string, remember: boolean): void;
export function isRemembered(p: KeyProvider): boolean;
export function forgetKey(p: KeyProvider): void;

// src/ui/media/probeDuration.ts
export function probeDuration(file: File, timeoutMs?: number): Promise<number | null>;
```

## Acceptance criteria

- [x] Typing a key with **Remember** unticked, then reloading: the key is still there. Closing the tab, reopening
      the file: the key is gone.
- [x] With **Remember** ticked, the key survives closing the browser. Unticking it removes the key from
      `localStorage` immediately. *(Playwright checks a new tab in the same profile, not a browser restart; a
      restart is left to the maintainer.)*
- [x] Picking a 4 GB file (or a mocked `File` with that `size`) shows an error, and Next stays disabled.
- [x] Picking a normal mp3 shows its name, size and correct duration. *(E2E uses the generated WAV, since there is
      no mp3 encoder in the toolchain. An mp3 takes the same `<audio>` metadata path; a spot check with a real mp3
      is left to the maintainer.)*
- [x] Next is enabled only when the key is set and the file is valid. It navigates to Glossary.
- [x] The language and zero-retention prefs survive a reload. The speakers field does not.
- [x] Every control is reachable and operable by keyboard, and every input has a `<label>`.

## Required tests

- `storage/secrets.spec.ts`: all remember/forget transitions.
- `stores/settings.spec.ts`: `isReady` and `missingRequirements` for each missing piece, and the stale-probe race
  (a newer file wins).
- `ui/components/ApiKeyField.spec.ts`: show/hide, remember toggle, forget.
- `tests/e2e/setup.e2e.ts`: enter a key, `setInputFiles` with a short fixture audio (generated by
  `scripts/make-test-audio.mjs`: a 5 s mono 16 kHz WAV tone), check the duration shows `00:00:05`, Next leads to
  Glossary. Plus a reload test for key persistence.

## Out of scope

The "Open last transcript" banner (Phase 4), the transcription call itself (Phase 4), the Claude/Gemini "Test key"
(Phase 6).

## Handoff

*(Notes for the next agent.)*

### 2026-10-13 — Phase 2 done (branch `phase-2-setup-tab`, based on `main` at `bff9bf9`)

**Settings store.** The Phase 0 state names are unchanged. New:
- **Keys:** `remember: Record<KeyProvider, boolean>`, `keyFor(p)`, `setKey(p, v)`, `setRemember(p, on)` and
  `forgetKey(p)`. A sync watcher saves every key change, so a plain assignment (`settings.claudeKey = …`) persists
  too. Phase 6's inline `ApiKeyField` needs nothing extra.
- **Test key:** `keyChecks[p]` (`{ status: 'idle' | 'checking' | 'done', result }`), `canTestKey(p)` and
  `testKey(p)`. Verifiers live in the store's `verifiers` map, which only has ElevenLabs. **Phase 6 registers
  Claude and Gemini there.** Editing a key aborts its check and clears the result.
- **File:** `fileProbing`, `setFile(file): Promise<void>` and `clearFile()`. The newest `setFile` wins, and older
  probes are aborted. `fileCheck` is a `computed`, `null` while there is no file or a probe is running.
- **Readiness:** `isReady` is `missingRequirements.length === 0`.
- **`numSpeakers` can be `NaN`** when the user types something that isn't a number, and `isReady` is then false.
  Phase 4 starts a job only when ready, so by then it is `null` or an integer 1–32.
- **Prefs:** `describe.v1.prefs` holds `{ languageHint, zeroRetention }`, validated field by field (`PrefsSchema` in
  `stores/settings.ts`). Saving **merges** into the stored object. Phase 6 ("Don't show again") and Phase 7
  (`followPlayback`) can add fields to the same object; they must merge on write too, or extend `PrefsSchema`.

**Other changes**
- **`probeDuration(file, timeoutMs?, signal?)`:** the optional `signal` is an addition to the contract. Empty files
  resolve `null` without being loaded, because Chromium logs `ERR_REQUEST_RANGE_NOT_SATISFIABLE` for a 0-byte
  blob.
- **`FileDrop` is presentational,** so Phase 7 can reuse it. Props: `file`, `durationSec`, `probing`, `check`.
  Emits: `select`, `remove`. It has no `compact` mode yet. While mounted, it stops a file dropped *outside* the
  zone from opening in the browser, which would leave the app.
- **`ApiKeyField`** reads and writes the settings store itself. Props: `provider`, `label`, `required`. Slot:
  `help`.
- **Shared styles in `base.css`:** `.button`, `.button-primary`, `.link-button`, `.control`, `.hint` and
  `.visually-hidden`.
- **The step nav is the visible page title.** Its tabs use the h1 size and plain step numbers. Each view keeps an
  `<h1 class="visually-hidden" tabindex="-1">` that labels its `<section>` and takes focus on a step change
  (`App.vue`). Phases 3 and 4 must keep that heading when they rewrite `GlossaryView` and `OutputView`.
- **New tokens:** `--color-warning`, `--color-border-strong` (form control outlines, ≥ 3:1, tested) and
  `--form-width`.
- **Test audio:** `fixtures/audio/tone-5s.wav` comes from `scripts/make-test-audio.mjs`. It is deterministic and
  committed.
- **Specs that create the settings store must clear `localStorage` and `sessionStorage` in `beforeEach`,** because
  the store reads them when it is created. `nav.spec.ts` and `App.spec.ts` now do.

**E2E gotchas for mocked ElevenLabs calls** (Phase 4 will need them):
- **CORS:** fulfil routes with `access-control-allow-origin: *`, because the page origin is `null`. The `xi-api-key`
  header makes the request non-simple, so also answer `OPTIONS` if the handler sees one.
- **Console errors:** Chromium logs every 4xx/5xx response as "Failed to load resource: …", which the helpers'
  guard counts as an error. In a test that expects an error status, remove only those lines from `consoleErrors`.
  See `setup.e2e.ts`; the line was confirmed for 400 and 401.
- **File input:** it is `hidden`, and `setInputFiles` works on it directly.

**Bundle:** 191 KB (64 KB gzip), up from 76 KB. The settings store now imports the ElevenLabs provider for
`verifyKey`, and zod comes with it. Phase 4 would have pulled both in anyway.

**Tests:** 268 unit tests and 11 e2e tests. Mutation spot checks: removing the stale-probe guard, or the
cross-store delete in `saveKey`, each fails two tests.

**Not verified:** the ElevenLabs keys link (`https://elevenlabs.io/app/settings/api-keys`) was not opened.
