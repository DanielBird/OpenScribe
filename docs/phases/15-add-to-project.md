# Phase 15 — Add to project and session summaries

**Goal:** Sessions get into a project, and get summaries.
- **Add to project** on the Output tab saves the transcript to the project folder, translates it if it isn't
  English, and writes its summary.
- Later edits on the Output tab are saved back to the folder, with a check that nobody else changed the file
  meanwhile.
- In Project mode, every session shows its summary status. Selecting a session shows its summary, with quotes to
  copy, **Regenerate** and **Open transcript**. **Summarise all** works through the sessions that need it.

**Depends on:** Phase 14 (and through it 12 and 13). Phase 16 can run alongside. This phase is large: build and
test the pipeline store first, then the UI.

**Read first:**
- [PROJECTS.md](../PROJECTS.md) §2 (A4, A5, A11, A12, A14, A17), §5.2, §5.3, §5.6, §5.8;
- [DECISIONS.md](../DECISIONS.md) D7, D10, D13, D14, D19, D20, D21, D23, T13;
- the Handoffs of Phases 13 and 14;
- `src/stores/translation.ts` (the run, cancel and resume pattern) and `src/stores/transcript.ts` (saving).

## Agreed with the maintainer (2026-10-15)

- **Add to project** is one action: save, then translate if needed, then summarise (A14).
- Summaries are in English, are read only in Describe, and are regenerated rather than edited (A4, A5, A11).
- Quotes leave Describe by **Copy with citation** (A12).
- The project model (Sonnet 5.5 by default) does the translating and summarising (A17).

## Decided in this file (the maintainer can still change them)

- **Progress and errors show in the Output actions row**, as translation does (D14): "Adding to project ·
  translating, batch 3 of 12" or "Summarising…", with a progress bar and **Cancel**. An error shows in the same
  row, with **Resume**, which continues from the step that failed.
  - While the pipeline works on the open transcript, **Edit text** and **Translate** are hidden, as during a
    translation.
- **The dialog** opens on every **Add to project**, because it also names the project. It shows:
  - the project name, or **Open project…** / **New project…** / **Reconnect** when there is no project yet;
  - the Claude key field, if the key is missing;
  - the line "The transcript text is sent to Anthropic to translate and summarise.";
  - **Add** and **Cancel**.
- **Saving comes first.** The transcript file is written before any API call, so a failed translation or summary
  still leaves the session in the project, with the status *no summary*.
- **Once a transcript is in a project**, the Output tab saves to the folder after every change, using the same
  debounce as the IndexedDB autosave. **Add to project** is then hidden, and the transcript header shows "In
  <project name>" (draft).
- **The change check:**
  - If the file in the folder changed since Describe last read or wrote it, saving to the folder stops. A notice
    offers **Reload** (the folder's version replaces the open one) and **Keep mine** (overwrite the folder's
    version).
  - If the permission to the folder is lost, the notice offers **Reconnect** instead.
  - In both cases the IndexedDB autosave carries on.
- **After a reload**, the last transcript (D10) is linked to its project file again by its id. If the two differ
  (`transcriptHash`), the same notice is shown.
- **Statuses:**
  - `none`: no summary yet;
  - `ok`;
  - `stale`: the `transcriptHash` or the `briefHash` doesn't match;
  - `queued`, `running`;
  - `failed`: the last attempt on this computer failed. Failures aren't written to the folder.
- **Regenerate** is a button for stale and failed summaries. For an up-to-date summary, it sits inside the
  summary's details.
- **Summarise all (N)** counts the sessions that are `none`, `stale` or `failed`. It asks first ("Summarise 12
  sessions, about 18 hours, with Sonnet 5.5?"), then works through them one at a time.
  - An `auth` or `quota` error stops the queue.
  - Any other error marks that session `failed`, and the queue moves on.
- **Open transcript** loads the session on the Output tab, linked to its file.
  - If the Output tab holds a transcript that isn't in a project, a confirmation says it will be replaced (it
    exists only in this browser).
  - The recording isn't in the folder (A1), so playback uses the existing re-attach flow.

## Tasks

### Core

1. **`storage/projectFiles.ts`:** add `SessionSummaryFileSchema`, `readSummaryFile` and `writeSummaryFile`.
   Summary files are small and are read on every load, with no cache.
2. **`stores/project.ts`:** sessions gain `summary`, `summaryFile`, `title` (`summary.title` or the recording name)
   and `status` (above). It reads summaries during `load()` and `refresh()`, and groups copies as for transcripts.
   `themeVocabulary` is computed from all summaries.
3. **`stores/pipeline.ts`** (contract below)
   - One job at a time, and a queue.
   - Steps: `save` → `translate` (only for German or French sessions without English text) → `summarise`.
     - **Translate:** use `translateTranscript` with Claude, the project model and the Claude key. Write the
       translation into the transcript file. If the session is open on Output, also use
       `transcript.setTranslation`.
     - **Summarise:** call `summariseSession` with the project's brief, name and theme vocabulary, then write a
       `SessionSummaryFile`:
       - `model`: the project model;
       - `transcriptHash` and `briefHash`: of what was sent;
       - `droppedQuotes`;
       - the file name: `<base>.summary.json`.
   - **Resume** continues from the failed step. A failed translation resumes from its completed batches, as the
     translation store does.
   - **Cancel** aborts the current request. What was saved stays saved.
   - Keep the browser's "Leave site?" warning while a job runs (`beforeunload`, as in translation).
   - A missing key, or a project that isn't ready, is an error with a clear message. The dialog prevents both
     before a start.
4. **`stores/transcript.ts`: the project link**
   - `projectLink` holds the file name and the last known stat. `setDoc` clears it, and `linkToProject` sets it.
   - After each autosave to IndexedDB, write to the folder too, via `writeTranscriptFile(..., { expected })`:
     - `FolderError('changed')` → `folderConflict`;
     - a permission error → `folderSaveError`.
   - `resolveConflict('reload' | 'keep')`.
   - Relink by id once the project is ready.
   - Avoid a setup-time cycle between the transcript and project stores: call `useProjectStore()` inside the
     functions.

### UI

5. **`AddToProjectButton` and `AddToProjectDialog`** (Output actions row), as decided above. The dialog reuses
   Phase 14's connect buttons and `ApiKeyField`.
6. **`PipelineStatus`** in the actions row: the progress, **Cancel**, the error and **Resume**, as for translation.
7. **`TranscriptHeader`:** "In <project name>" when the transcript is linked.
8. **The folder notice** on Output for a conflict or a save error, with **Reload** / **Keep mine** or
   **Reconnect**.
9. **`SessionList`:**
   - The items become selectable. Use buttons, or one roving tab stop if hundreds of Tab stops make keyboard use
     poor; say which in the Handoff.
   - Each item shows its title and status (✓ / ◐ / ⟳ / failed / no summary), with a text alternative for each
     mark.
   - **Summarise all (N)** at the foot, when N > 0.
10. **`SessionSummary`** (the right-hand pane, with a heading that takes focus when a session is selected):
    - **The header:** title; date · duration · language (and "translated" when it applies).
    - **The status notice,** when there is one: out of date (with **Regenerate**), failed (with the error and
      **Try again**), no summary (with **Summarise**), or running (with the progress).
    - **The summary:** the synopsis (as the lead), the overview, the respondents and their details (a `<dl>`), the
      research questions with their findings, and the themes with their descriptions.
    - **Key moments:** time · title · description.
    - **Quotes:** each as a `QuoteCard`, with the text, speaker, time, "translated from German" where it applies,
      and **Copy**. **Copy all quotes** below them. Build `QuoteCard` so that Phase 17 can reuse it for chat
      answers, with a "not found" variant.
    - **Details:**
      - "Made with Sonnet 5.5 on 15 Oct 2026";
      - the dropped-quote count, if any;
      - other copies of the files (conflict copies);
      - **Regenerate**, when the summary is up to date.
    - **Open transcript.**
    - If there is no selection, the pane is empty. Phase 17 puts the chat there.
11. **About and data flow:**
    - Update the data-flow statement (PROJECTS.md §5.8) in the About panel, `reference/llm-providers.md` and the
      User Guide's privacy section.
    - **Clear saved data** doesn't touch the project folder. Say so in its confirmation if that text lists what is
      cleared.
12. **Docs:**
    - USER_GUIDE: "Add a session to a project", "Read a summary", and "When a summary is out of date".
    - TESTING.md: the new specs, and a manual row: add a real German session and an English one to a OneDrive
      project.
    - CHANGELOG.

## Contracts introduced

```ts
// stores/pipeline.ts
export type PipelineStep = 'save' | 'translate' | 'summarise';
export interface PipelineJob {
  sessionId: string;
  title: string;
  steps: PipelineStep[];
  current: PipelineStep | null;
  progress: { batch: number; totalBatches: number } | null;   // during translate
  status: 'queued' | 'running' | 'error' | 'cancelled' | 'done';
  error: ProviderError | FolderError | null;
}
addCurrentTranscript(): Promise<void>;     // from Output, after the dialog
summarise(sessionIds: string[]): void;     // Summarise / Regenerate / Summarise all
resume(): Promise<void>;
cancel(): void;
current: ComputedRef<PipelineJob | null>;
queued: ComputedRef<readonly PipelineJob[]>;

// stores/project.ts (additions)
export type SummaryStatus = 'none' | 'ok' | 'stale' | 'queued' | 'running' | 'failed';
interface ProjectSession {
  /* Phase 14 fields, plus: */
  title: string;
  summary: SessionSummaryFile | null;
  summaryFile: SessionFileInfo | null;
  status: SummaryStatus;
}

// stores/transcript.ts (additions)
projectLink: ShallowRef<{ fileName: string; stat: FileStat } | null>;
folderConflict: Ref<boolean>;
folderSaveError: ShallowRef<FolderError | null>;
linkToProject(fileName: string, stat: FileStat): void;
resolveConflict(choice: 'reload' | 'keep'): Promise<void>;
```

## Acceptance criteria

- [x] **Add to project** on an English transcript writes `<base>.transcript.json` and then `<base>.summary.json`.
      On a German one, it translates first, and the translation is in the file and shown on Output.
- [x] A failure in translate or summarise leaves the transcript in the project. **Resume** continues from that step,
      and **Cancel** stops cleanly.
- [x] Edits and renames on a linked transcript reach the folder. A file changed by someone else stops the folder
      saves, and **Reload** and **Keep mine** both work. A lost permission offers **Reconnect**.
- [x] After a reload, the last transcript is linked again by its id.
- [x] Statuses are right for every case, including a brief change (everything `stale`) and an edit (that session
      `stale`).
- [x] The summary view shows every section. Every quote shown verifies against the transcript, and **Copy** /
      **Copy all quotes** give the citation format.
- [x] **Summarise all** asks first, runs one session at a time, stops on `auth` or `quota`, and continues past other
      failures.
- [x] **Open transcript** loads the session on Output, linked, and asks first if an unlinked transcript would be
      replaced.
- [x] The data-flow text is updated everywhere it appears.
- [x] The axe and keyboard specs cover the dialog, the actions row states and the summary view.
- [x] Definition of Done in AGENTS.md. No real API calls (the live checks stay pending).

## Required tests

- `projectFiles.spec.ts`: the summary file round trip; an invalid summary file ignored.
- `stores/project.spec.ts`: summaries loaded; statuses (`stale` by transcript and by brief); the theme vocabulary.
- `stores/pipeline.spec.ts`, against `memoryFolder` and a fake provider:
  - every step order;
  - skipping translation for English;
  - writing the files with the right hashes and model;
  - resume after each step;
  - cancel;
  - the queue rules (stop on `auth` or `quota`, continue on others);
  - `beforeunload` while running.
- `stores/transcript.spec.ts`:
  - the link set and cleared;
  - folder saves debounced;
  - conflict and keep / reload;
  - permission loss;
  - relink by id, with and without differences.
- Component specs: `AddToProjectDialog` (each state), `PipelineStatus`, `SessionSummary` (each status, every
  section, Copy), `QuoteCard`, `SessionList` (selection, the status texts, Summarise all).
- `tests/e2e/project-add.e2e.ts` (ElevenLabs and Claude mocked; the Claude mock answers translation and summary
  requests differently):
  - transcribe → **Add to project** (New project) → files written → the Project list shows the summary → Copy a
    quote;
  - a German session from the seeded folder → **Summarise** → translated and summarised;
  - edit on Output → the file is updated → the session is `stale` → **Regenerate**;
  - a file changed behind the app's back → the notice → **Keep mine**;
  - **Summarise all** with one failure.

## Out of scope

- The chat (Phase 17).
- Editing summaries (A11).
- Writing failures or "who added it" to the folder.
- A cost estimate before **Summarise all**. Cost is shown with chat answers (Phase 17).

## Handoff

*(UI text trimmed under D13, list keyboard model, anything about OneDrive behaviour seen in testing, notes for 17.)*

### 2026-10-20 — Phase 15 done (branch `phase-15-add-to-project`, based on `phase-14-project-folder` at `0e0b16b`)

**Agreed with the maintainer at planning**
- **The project link is remembered** (DECISIONS **D25**): `describe.v1.lastTranscriptLink` holds `{ docId, projectId,
  projectName, fileName, stat }` beside the last transcript. After a restart, Output says "In <project>" at once, a
  change asks for **Reconnect**, and the change check uses the remembered stat. Relinking by id (this file's plan)
  stays as the fallback for a transcript in the project with no link.
- **Narrow windows:** a selected summary replaces the search box and the list, with a **Sessions** back button that
  returns to the session's item. **The maintainer approved the layout** at 1280 and 375 px (2026-10-20); the
  screenshot spec and contact sheets are in the gitignored `.claude/phase15-screens/`.

**Mid-phase: "Project" became "Analyse"** (another session, at the maintainer's request). The mode's Home tile and
heading say **Analyse**; a project is still a project. This phase's UI and docs use "Analyse mode". The rename had
left e2e specs pointing at **Project** (`enterProject`, the Home tile's name, the banner); they're updated here. It
also set `TranscriptHeader`'s visually hidden label for "In <project>" to "Analyse"; "Project" may read better.

**Changed from this file**
- **Contracts:**
  - `ProjectSession.status` is what the files say: `none`, `ok` or `stale`. `pipeline.statusOf(id)` adds `queued`,
    `running` and `failed` (`SummaryStatus` lives in `stores/pipeline.ts`). So the project store never imports the
    pipeline, and `sessions` stays a plain shallowRef. `copies` lists conflict copies of summaries too.
  - `PipelineJob` has `kind: 'add' | 'summarise'`, and its `status` is only `queued` or `running`. An error becomes a
    `PipelineFailure` in `failures` (the step, the error, the finished translation batches, `reconnect`), kept in
    memory only; Cancel removes the jobs. `resume(sessionId?)` resumes the last failure by default.
    `addCurrentTranscript()` and `summarise()` resolve when the queue is idle (`whenIdle()`). Also: `jobFor`,
    `failureFor`, `needsKey`, `summariseAllIds`, `queueProgress`, `stopped`, `isBusy`.
  - The transcript store's `projectLink` is the remembered link (with `docId`, `projectId` and `projectName`), with
    `folderNotice` (`conflict`, `reconnect`, `retry`, `otherProject`) for the UI, which never imports storage. Also
    `addToProject()`, `openFromProject(id)`, `flush()`, `retryFolderSave()`, `reconnectFolder()`, `syncLink()`.
  - The project store keeps the folder private and gained the reads and writes: `addSessionTranscript`,
    `saveSessionTranscript(doc, name, expected?)`, `readSessionFile`, `readSessionDoc`, `saveSessionSummary`, plus
    `session(id)`, `themesExcept(id)` and `briefHash`. `reconnect()` resolves whether the project is ready.
    `writeTranscriptFile` also returns its `savedAt`.
- **Choices:**
  - **Add to project** goes to the front of the queue (after the running job). **Cancel** clears the queue. An `auth`
    or `quota` error, a missing key or a lost folder stops it; other errors mark the session and it moves on.
  - The theme vocabulary sent with a summary leaves out the session's own summary, so **Regenerate** isn't steered by
    its old themes.
  - When the session is open on Output and linked, the pipeline works through the transcript store; otherwise
    through the file, with the change check. **Open transcript** waits while that session's job runs.
  - Summary files are indented and written without a change check (the newest wins).
  - **The sessions list** is a `listbox` with one roving Tab stop: ↑ ↓ Home End move, Enter, Space or a click
    selects. Selection doesn't follow focus. The summary heading takes focus only when a session is picked in the
    list, not when Analyse mode opens with one still selected.
  - **Status marks:** ✓ summarised, ◐ summarising, ◌ waiting, ⟳ out of date, **!** failed, and no mark for no summary,
    each with visually hidden words. The phase file's "failed" and "no summary" were words; marks repeat less in a
    long list (D13).
  - **The data-flow text** gains only the Add to project sentence (About, `reference/llm-providers.md`, the User
    Guide). The chat's sentence comes with the chat (Phase 17).
  - `SessionSearch` keeps its own Copy code; the new `useCopy` composable serves `QuoteCard` and **Copy all quotes**.
- **Outside the phase, fixed because the new specs hit it:** `useModalDialog` reopened a dialog and closed it at once
  when Enter came right after Escape (the earlier close's `close` event arrived late). It now ignores a `close`
  event while the dialog is open again. The Translate dialog had the same bug.
- **Tests:** the link's specs are in `stores/transcriptLink.spec.ts`. `src/testing/folderMocks.ts` replaces the
  browser side of `storage/folder.ts` for `project.spec`, `pipeline.spec` and `transcriptLink.spec`. E2E sessions come
  from `tests/e2e/sessionDocs.ts`, because `src/testing/transcriptDoc.ts` imports a fixture JSON that Playwright's
  loader can't. `LlmCall.input` is parsed lazily, with the raw `text` beside it.

**UI text (D13)**
- Dialog: "Add to “<project>”" (or "Add to project" with the connect buttons), and "The transcript text is sent to
  Anthropic to translate and summarise." ("to summarise" for English). The key field only when needed.
- Actions row: "Adding to project · saving…" / "· translating, batch 3 of 12" / "· summarising…", "Waiting to add to
  the project"; Resume, or **Reconnect** when access ended. Announced: "Added to the project.", "Cancelled.".
- Folder notice: "The project's copy of this transcript has changed." (**Reload**, **Keep mine**); "Describe no longer
  has access to “<project>”." (**Reconnect**); the error and **Try again**; "Open “<project>” in Analyse mode to save
  your changes to it."
- Summary: "Out of date: the transcript or the brief has changed." (**Regenerate**), "No summary yet."
  (**Summarise**), the error with **Try again**. Details: "Made with Sonnet 5.5 on 15 Oct 2026", "1 quote wasn't
  found in the transcript and was left out.", "Another copy: <file>", **Regenerate**.
- Summarise all: "Summarise 12 sessions, about 18 hours, with Sonnet 5.5?"; the key field and data line when needed.
- Open transcript over an unsaved transcript: "Replace the transcript on Output?" with "It isn't in a project, and is
  saved only in this browser." or "Its latest changes aren't saved in its project."

**Build and perf**
- `describe.html` is 1,439.6 KB: `features/summary` (schema, prompt, check) is in the bundle now.
- `npm run test:perf`: the 3-hour transcript meets every target (render 308 ms, rename mean 28 / max 55 ms, Edit text
  on 152 ms). The 300-hour project test fails before its second measure, **on the Phase 14 commit too**: after the
  reload the no-project state shows instead of **Reconnect** within 5 s. Not investigated here (TESTING.md).

**For Phase 16 and 17**
- `QuoteCard` takes `text`, `verified`, `speaker`, `start`, `translatedFrom`, `sessionTitle` (for chat answers),
  `note` and `citation` (`null`: no Copy). A quote that isn't found is marked "Not found in the transcript".
- The right-hand pane shows `SessionSummary` while `useProjectUi().selected` is set; the chat goes there otherwise.
  **Back to chat** can clear `selected`.
- E2E: `isSummaryCall`, `summaryFor` and `projectAnswer` in `helpers.ts`; `summaryReplyForInput` and
  `sessionFromSummaryInput` in `src/testing/summary.ts` read a summary request back.
- `PipelineStatus` without `sessionId` shows the whole queue (the foot of the sessions list).

**Open**
- Live checks S1–S3 and manual row 17 (a real German and English session in a OneDrive project) need the
  maintainer.
- `test:perf`'s 300-hour project test (above).
