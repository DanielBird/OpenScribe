# Phase 4 — Output tab: job, transcript view, speakers, autosave

**Goal:** Clicking **Run** really transcribes. The Output tab shows upload progress, then a "transcribing" state
with an elapsed timer, then the transcript: a metadata header, speaker turns with timestamps, and an editable
speaker-name panel. The result is autosaved so a reload doesn't lose it. Errors and cancellation are handled
cleanly.

**Depends on:** Phases 1, 2, 3.

**Read first:** [ROADMAP.md](../ROADMAP.md) §5 (data flow), [DECISIONS.md](../DECISIONS.md) D8, D10, T4,
[reference/elevenlabs-stt.md](../reference/elevenlabs-stt.md) (errors, V4 result).

## Tasks

1. **`src/storage/idb.ts`** (with `idb-keyval`, store name `describe-v1`)
   - `saveLastTranscript(doc)`, `loadLastTranscript(): Promise<TranscriptDoc | null>`, `clearLastTranscript()`.
   - On load, validate `schemaVersion === 1` plus a light zod shape check. Return `null` on mismatch or error
     (never throw).
2. **`stores/transcript.ts`**
   - `doc` is a `shallowRef<TranscriptDoc | null>`.
   - `setDoc(doc)` saves immediately.
   - `renameSpeaker(id, label)`: trim the label; empty means the default label. Builds a new doc object and
     debounces the save (500 ms).
   - `loadAutosave()` runs at app start. It loads into `doc` and sets `hasAutosave`, but doesn't navigate.
   - `autosaveInfo` (`{ fileName, createdAt }`) for the banner.
   - `view: 'original' | 'en'` stays at `'original'` in this phase.
3. **`stores/job.ts`** (implement the state machine)

   ```
   idle ──start──▶ uploading ──upload done──▶ processing ──200──▶ done
     ▲               │  │                        │  │
     │            cancel error                cancel error
     │               ▼  ▼                        ▼  ▼
     └──retry/start─ cancelled / error ◀─────────┘
   ```

   - `start()`:
     - Set `status = 'uploading'` **synchronously, before the first `await`**. GlossaryView calls `start()` and
       then `nav.goTo('output')`, and the nav guard only opens Output once the status has left `idle`.
     - Snapshot the settings (key, file, language, speakers, zero retention) and `glossary.validTerms`.
     - Create an `AbortController` and call `provider.transcribe` with an `onProgress` callback.
     - On success, run `buildTranscriptDoc` with `SourceInfo` (from the File plus the probed duration) and
       `TranscriptionRequestInfo`, then `transcript.setDoc()` and set status `done`.
   - `cancel()` aborts and sets `cancelled`. `retry()` calls `start()` again with the same snapshot.
   - Track `startedAt` and `uploadDoneAt`. Expose `elapsedSec` via a 1 s ticker that runs only while processing.
   - Provider injection: `useJobStore` gets its provider from `src/providers/index.ts`
     (`getTranscriptionProvider()`), so tests can swap it.
   - While uploading or processing, register a `beforeunload` handler (the browser's "Leave site?" dialog), and
     remove it afterwards.
4. **Run confirmation:** in `GlossaryView`'s Run handler, if `transcript.hasAutosave`, first confirm: *"Start a
   new transcription? This replaces your last transcript (\"<file>\")."*
5. **Setup banner:** on `SetupView`, if `transcript.hasAutosave`, show the banner *"Last transcript:
   <file> · <date>"* with an **Open** button that navigates to Output.
6. **Components**
   - **`JobStatus.vue`** (`role="status"`, `aria-live="polite"`):
     - *Uploading:* a progress bar, *"Uploading 45% (210 MB of 470 MB)"*, and **Cancel**.
     - *Processing:* a spinner, *"Transcribing… 01:12 elapsed"*, the hint *"Long recordings can take several
       minutes. Keep this tab open."* (refine with the V4 timing), and **Cancel**.
     - *Error:* the icon, `error.userMessage`, **Try again** (if `retryable`, or for any error except auth), and
       **Back to setup**.
     - *Cancelled:* *"Transcription cancelled."*, with **Start again** and **Back to setup**.
   - **`TranscriptHeader.vue`:** file name, duration (`HH:MM:SS`), detected language name (+ confidence %),
     number of speakers, transcribed date/time (`en-GB` format), glossary terms used (count), and
     "Zero retention: on" if used.
   - **`SpeakerPanel.vue`:** one row per speaker: a colour swatch, a text input bound to the label (placeholder =
     default label), and the number of turns. The heading is *"Speakers: rename to make the transcript easier to
     read"*.
   - **`TurnList.vue` / `TurnItem.vue`:**
     - Each turn is a `<li>` with a timestamp **button** `[00:01:23]` (it emits `select(turn)`; a no-op until
       Phase 7), the speaker label in that speaker's colour, and the text.
     - The `TurnItem` text comes from the `text` prop, which lets Phase 6 pass translated text.
     - Lists of about 2000 items must stay smooth. Use `v-memo` keyed on `[turn.id, label, text]` if needed.
   - **`OutputView.vue`** layout:
     - Header area: `TranscriptHeader` and an actions row. The actions row has placeholders that later phases fill:
       *Translate* (Phase 6), *Download .docx* (Phase 5), *Original/English* (Phase 6).
     - Below: `SpeakerPanel` (collapsible) and `TurnList`.
     - `JobStatus` shows above the transcript while a job is active or failed.
     - Empty state when there is no doc and the job is idle: *"No transcript yet. Start on the Setup tab."*
   - **Zero turns:** if the doc has 0 turns, show *"No speech was detected in this recording."*
7. **Speaker colours:** `speakerColor(index)` uses the 8-colour token palette, cycling if there are more speakers.

## Contracts introduced

```ts
// src/providers/index.ts
export function getTranscriptionProvider(): TranscriptionProvider;          // ElevenLabs today
export function setTranscriptionProviderForTests(p: TranscriptionProvider): void;

// src/storage/idb.ts
export function saveLastTranscript(doc: TranscriptDoc): Promise<void>;
export function loadLastTranscript(): Promise<TranscriptDoc | null>;
export function clearLastTranscript(): Promise<void>;

// stores/job.ts (public surface)
status, progress, error, elapsedSec, start(): Promise<void>, cancel(): void, retry(): Promise<void>
```

## Acceptance criteria

- [x] With the ElevenLabs API mocked (Playwright route returning `two-speakers-short.json` after a 2 s delay),
      Run → Output shows uploading, then transcribing with a ticking timer, then the transcript with 2 speakers and
      the right timestamps. *(Under a route mock Chromium reports the upload done only when the response arrives,
      so the e2e sees Uploading → transcript. The processing state and the ticking timer are covered by
      `job.spec.ts` and `JobStatus.spec.ts`. See Handoff.)*
- [x] Renaming "Speaker 1" to "Interviewer" updates every turn instantly and survives a reload.
- [x] Reloading after a successful run: the Setup banner offers the last transcript, and Open shows it.
- [x] A mocked 401 shows the auth message with **Back to setup** (no retry). A mocked 429 shows **Try again**.
- [x] Cancel during processing aborts the request (no response handling afterwards) and shows the cancelled state.
      *(Both phases in `job.spec.ts`; the e2e cancels a held request.)*
- [x] Closing the tab while processing triggers the browser's leave-page confirmation.
- [ ] **Live (manual, with the user's key):** a real 2–5 min EN, DE and FR file each transcribe correctly from
      `dist/describe.html`. Record the timings in the V4 row of the reference doc. *(Pending: not run yet.)*

## Required tests

- `stores/job.spec.ts` with a fake provider: success, every error kind, cancel in both phases, retry, the
  `beforeunload` registration and removal.
- `stores/transcript.spec.ts`: rename (empty → default), debounced save (fake timers), autosave load with a
  valid, invalid or wrong-version doc (`fake-indexeddb`).
- `ui/components/TurnList.spec.ts`: renders labels, timestamps and text; emits `select`.
- `tests/e2e/transcribe.e2e.ts`: the full happy path with a route mock, the 401 path, cancel, rename and reload.

## Out of scope

Playback (the timestamp click is a no-op), translation, export, editing turn text.

## Handoff

*(Notes for the next agent, including the observed processing-time ratio.)*

### 2026-10-13 — Phase 4 done (branch `phase-4-output-tab`, based on `phase-3-glossary-tab` at `123733c`)

**Not done yet: the live check.** No real API calls were made (CLAUDE.md). The EN/DE/FR live run and the V4 timing
(processing time ÷ audio length) are still open; the processing hint keeps its generic wording until then.

**Decisions taken with the maintainer**
- **A run hides the old transcript.** While a run is uploading, processing, failed or cancelled, Output shows only
  `JobStatus`. The old doc stays in the store and in IndexedDB (it is replaced only on success). Setup's banner
  **Open** calls `job.dismiss()` and shows it again.
- **Timestamps are text until playback exists.** `TurnList`/`TurnItem` have a `playable` prop (default `false`).
  Only when it is true is the timestamp a `<button>` (named "Play from 00:01:23") that emits `select(turn)`.
  **Phase 7:** set `playable` once audio is attached, and handle `select` in `OutputView`.

**Other decisions**
- **Try again** shows for every error kind except `auth` and `validation`. Both need a change on Setup or Glossary,
  and a retry repeats the same snapshot. `quota` keeps it (credits may have been topped up).
- **One run at a time.** `start()` and `retry()` do nothing while a run is active. Glossary's Run is disabled then,
  with "A transcription is already running." in the StepFooter list.
- **Live regions announce the phase only:** "Uploading", "Transcribing…", the error message, or "Transcription
  cancelled.". The percentage is outside the region and the elapsed time is `role="timer"` (not announced).
- **Focus:** when a status change removes the focused button (Cancel, Try again), focus moves to Output's `h1`.

**Contract changes and additions**
- `job`: also exposes `startedAt`, `uploadDoneAt`, `isActive` and `dismiss()`. `start()` with no file sets a
  `validation` error instead of throwing.
- `setTranscriptionProviderForTests(null)` restores the real provider.
- `saveLastTranscript()` returns `Promise<boolean>` (true when saved), so the store can set `saveFailed`. Output
  then warns that the transcript will be lost when the tab closes.
- `transcript`: also exposes `saveFailed`. `setDoc()` returns the save promise and resets `view` to `'original'`.
  A `pagehide` listener flushes a pending rename save (best effort).
- `transcript.loadAutosave()` is called from `main.ts`. A `setDoc()` that lands while it loads wins.
- New: `formatDateTime(iso, { timeZone? })` in `domain/transcript.ts` ("13 Oct 2026, 14:05"). **Phase 5** can use
  it for the docx header date.
- New: `speakerColor(index)` in `src/ui/speakerColor.ts`.
- New: `src/testing/transcriptDoc.ts` (`makeDoc`, `makeLargeDoc`) builds test docs from the fixtures. Test-only.
- New: `LastTranscriptBanner.vue` holds the Setup banner, so `SetupView` only gains one line.
- IndexedDB: database `describe-v1`, store `keyval`, key `describe.v1.lastTranscript`. The zod schema
  (`TranscriptDocSchema` in `storage/idb.ts`) checks the whole doc, words included.

**UI text trimmed (D13)**
- The speaker panel is a `<details open>` with the summary "Speakers". The long heading is gone; each field has a
  visually hidden label "Name for Speaker N", and the default name is the placeholder.
- "Transcribing… 01:12 elapsed" → "Transcribing… 00:01:12". The hint is "Long recordings take several minutes. Keep
  this tab open."
- The header shows "N glossary terms" and "Zero retention" only when they apply, and the language confidence only
  when the language was auto-detected. Items are separated by a middle dot.
- No placeholder buttons in the actions row: it is an HTML comment in `OutputView` for **Phase 5** (Download .docx)
  and **Phase 6** (Translate, Original/English).
- Run confirmation: title "Start a new transcription?", message `This replaces your last transcript ("<file>").`,
  confirm label "Run".
- "Back to setup" sits in a `StepFooter` (error and cancelled states only), per the Phase 3 handoff.

**For Phase 6:** `TurnItem` takes its text from the `text` prop; `TurnList` passes `turn.text` today. Add the
translated text there when `view === 'en'`. `transcript.setDoc()` resets `view`.

**For Phase 7:** the job reaches `done` in `run()` in `stores/job.ts`, right after `transcript.setDoc()`. That is
where `playback.attachFromRunFile(snap.input.file)` belongs.

**E2E finding: no "Transcribing" state under route mocks.** Chromium reports an intercepted request's upload as
done only when the mocked response arrives. A probe with a 2.5 s delay saw "Uploading" for the whole time. The e2e
therefore checks Uploading → transcript, and the unit tests cover the processing state and the timer. The
provider's `uploading` → `processing` order is tested with a fake transport (`provider.spec.ts`); the live check
will show it with a real upload.

**Checks**
- **Mutation spot checks:** 7 deliberate bugs, each caught: dropping the stale-run guard; setting `uploading` after
  an `await`; not removing `beforeunload`; saving renames without the debounce; `loadAutosave` overwriting a newer
  doc; Try again for auth errors; showing the old doc during a run.
- **Size:** a 2000-turn, 3-speaker doc renders, and a rename takes about 20 ms per keystroke in the dev build.
- **Narrow windows:** no horizontal scroll at 375 px.

**Tests:** the phase commit, checked out on its own, passes everything: typecheck, lint, 490 unit tests (up from
391) and 26 e2e tests (up from 19), plus the build and the single-file check.
- **New tests:** `idb`, `transcript`, `job`, `speakerColor`, `JobStatus`, `TranscriptHeader`, `SpeakerPanel`,
  `TurnList`, `LastTranscriptBanner` and `OutputView` specs; additions to the `GlossaryView` spec; and
  `transcribe.e2e.ts` (7 tests).
- **Not part of this phase:** another session had uncommitted Setup-tab changes in the same working tree ("Test
  key" → "Verify key", a zero-retention switch). With those edits, 4 unit tests and 3 e2e tests in
  `ApiKeyField.spec.ts`, `SetupView.spec.ts` and `setup.e2e.ts` fail. The edits were left out of this commit;
  `SetupView.vue` was committed with only the banner lines added.

**Bundle:** 226 KB (76 KB gzip), up from 202 KB.
