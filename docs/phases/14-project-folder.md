# Phase 14 — Project folder: connect, brief, sessions, search box

**Goal:** Project mode opens a real project folder. A researcher can:
- create a project or open one, and reconnect to it on a later visit;
- edit the brief and choose the model;
- see every session in the folder;
- search all transcripts with the search box.

Describe reads each transcript once per computer and caches its text, and it picks up colleagues' new sessions
when the window gets focus. Sessions can't be added or summarised yet (Phase 15).

**Depends on:** Phase 10 (a go, and the facts in `reference/file-system-access.md`), 11 (modes), 12 (corpus core)
and 13 (`ProjectBrief`, `PROJECT_MODELS`). Phase 16 can run alongside.

**Read first:**
- [PROJECTS.md](../PROJECTS.md) §2 (A1, A13, A16, A17), §3, §5.2, §5.4, §5.6, §5.7, §6, §7;
- [reference/file-system-access.md](../reference/file-system-access.md) (all of it);
- [DECISIONS.md](../DECISIONS.md) D3, D13, D18, D20, D23, T4, T11, T12;
- AGENTS.md rules 4, 7 and 8; `src/storage/`, `src/stores/savedData.ts`, `src/ui/composables/useModalDialog.ts`.

## Agreed with the maintainer (2026-10-15)

- The project is a OneDrive-synced folder (A1). The **Search box** is for researchers (A16). The **model** select
  offers Sonnet 5.5 (default) and Opus 5.5, saved on each computer (A17).
- Project mode is two panes: sessions on the left, and on the right the selected summary (Phase 15) or the chat
  (Phase 17). The page is wider than the Transcribe steps. **Show the maintainer screenshots at 1280 and 375 px
  before finishing**, and record their choices in the Handoff.

## Decided in this file (the maintainer can still change them)

- **New project** on a folder that already has a `describe-project.json` simply opens it.
- **Open project** on a folder without one says: "This folder isn't a Describe project. Choose the project folder,
  or use New project."
- After **New project**, the Brief dialog opens, with the name set to the folder's name.
- **The sessions list is newest first** (recording date). In this phase the items aren't interactive. Phase 15
  makes them selectable.
- **Search results replace the list** while the box has a query. Each hit has a **Copy** button that copies the
  whole turn's English text (or the original, if there is no translation) with its citation (`formatCitation`).
  Until Phase 15, the session title is the recording name.
- **Files that can't be read** (invalid, offline, or deleted mid-scan) don't stop the load. A `<details>` under
  the list says "2 files couldn't be read" and names them, with the reason.
- **Clear saved data** (About) also forgets the project folder and empties the text cache. The project folder
  itself is never touched.

## Tasks

1. **Rules first** (AGENTS.md and `eslint.config.js`)
   - Rule 4: `src/storage/folder.ts` is the only code that calls the File System Access API. Add an ESLint rule
     (`no-restricted-globals` / `no-restricted-properties` on `showDirectoryPicker`) that allows it only there.
   - Add `**/storage/**` to the restricted group for providers, features and media: only stores use storage.
   - Rule 7: name the new keys and databases: `describe.v1.projectFolder` and the database `describe-v1-corpus`.
2. **Types:** the browser's `showDirectoryPicker`, `queryPermission` and `requestPermission`, if TypeScript's DOM
   library lacks them. Use a typed dev dependency if it fits without conflicts, otherwise a small `.d.ts` in
   `src/storage/`. Say which in the Handoff.
3. **`storage/schemas.ts`:**
   - move `TranscriptDocSchema` here from `idb.ts` (which imports it);
   - add `SessionTextSchema` for the cache.
4. **`storage/folder.ts`:** the contract below.
   - Paths use `/` and are relative to the project folder.
   - `writeText` creates missing folders and writes through `createWritable()`. It returns the new stat.
   - Every browser error becomes a `FolderError` with a kind and a user message. The messages say what happened
     and what to do next, using the error names Phase 10 recorded, for example:
     - offline: "This file is only in OneDrive and the computer is offline. Connect, or set the folder to Always
       keep on this device."
     - a lost permission: "Describe no longer has access to the project folder. Reconnect it."
   - The handle is stored in IndexedDB with the project's name (`describe.v1.projectFolder`), so Home can show the
     name before permission is granted again.
5. **`src/testing/memoryFolder.ts`:** an in-memory `ProjectFolder` for unit tests. It can be seeded with files,
   made to fail on chosen paths, and changed "by someone else" (to test the change check).
6. **`domain/sessionFiles.ts`:**
   - `PROJECT_FILE`, `SESSIONS_DIR`;
   - `sessionBaseName(recordingName, sessionId)`: the name without its extension; accents removed; letters,
     digits, `-` and `_` kept; spaces turned into `-`; at most 60 characters (`session` if nothing is left); then
     `--` and the first 8 characters of the id;
   - `classifySessionFile(name)`: transcript or summary, the base name, and whether the file is a conflict copy
     (the pattern from Phase 10). Other files return `null` and are ignored, including temporary ones.
7. **`storage/projectFiles.ts`:** the schemas for `ProjectFile` and `SessionTranscriptFile` (PROJECTS.md §5.2),
   and these functions:
   - `readProject`, `createProject` and `writeProject`. `writeProject` refuses if the file changed since it was
     read (`FolderError('changed')`).
   - `listSessionFiles`.
   - `readTranscriptFile`, which validates the file (`'invalid'` otherwise).
   - `writeTranscriptFile`, with an optional `expected` stat for the change check. Phase 15 uses it.
8. **`storage/corpusCache.ts`:** the `SessionText` cache, in its own IndexedDB database (`describe-v1-corpus`;
   idb-keyval can't add a store to the existing database).
   - Entries are keyed by project id and file name, and hold the `lastModified` and size they were made from.
   - Read entries are validated, and a bad one is ignored (D18).
   - Every access is wrapped in try/catch, so that without IndexedDB the project still loads, just more slowly.
9. **`stores/settings.ts`:** the optional preference `projectModel`. It falls back to `PROJECT_MODELS.default`
   when missing or unknown (`isProjectModel`). This is a new optional preference with a default, so D18 doesn't
   apply.
10. **`stores/project.ts`**
    - The status: `unsupported`, `none`, `reconnect`, `loading`, `ready` or `error`.
    - `init()` at app start reads the stored handle and checks its permission. It reads no files until the
      permission is granted.
    - `newProject()`, `openProject()` and `reconnect()` must be called from a click.
    - **`load()`:**
      - read the project file and list `sessions/`;
      - for each transcript, use the cache, or read, validate, convert (`toSessionText`) and cache it;
      - report progress;
      - group files by session id: for duplicates, the newest `savedAt` wins and the others are kept as `copies`;
      - prune the cache of files that are gone.
    - **`refresh()`** on window focus and on `visibilitychange` (debounced, and skipped while loading): list,
      stat, and read only what is new or changed.
    - `saveBrief(name, brief)`, with the change check. If someone else changed the brief, say so and offer
      **Reload**.
    - `corpus` and `sessions` are held in `shallowRef`s and replaced, never mutated (rule 8). The
      `SearchableCorpus` is rebuilt only when the corpus changes.
    - `search(text)` parses the query and runs it with `field: 'both'`, `maxHitsPerSession: 5` and paged
      sessions. A `QueryError` becomes a short message under the box.
11. **`stores/savedData.ts`:** also forget the folder handle and clear the corpus cache.
12. **UI**
    - **`HomeView`:** the **Project** button's second line is the remembered project name.
    - **`ProjectView`:** one state per status. The drafts (trim them under D13):
      - `unsupported`: "This browser can't open project folders. Use Edge or Chrome."
      - `none`: **Open project…** and **New project…**, with one line, "A project is a shared folder, for example
        in OneDrive."
      - `reconnect`: **Reconnect "<name>"**, and **Open another project…**.
      - `loading`: "Reading 12 of 40 sessions", with a progress bar.
      - `error`: the message, and **Try again**.
      - `ready`: the header and the two panes.
    - **`ProjectHeader`:** the nav row (`Home / <project name>`, from Phase 11); **Brief**; the **Model**
      select; **Change** (open another project).
    - **`BriefDialog`:**
      - the fields: name, research questions (one per line), context, and metadata fields (one per line);
      - **Save** and **Cancel**;
      - built on `useModalDialog`, like the other dialogs.
    - **`SessionList`:** each item shows the recording name, a language code (EN, DE, FR), the duration and the
      date. The list header shows the number of sessions.
    - **`SessionSearch`:**
      - a labelled `<input type="search">` (placeholder draft: "Search transcripts");
      - debounced, roughly 250 ms;
      - results grouped by session, with the hit count, then each hit's speaker, time, snippet (matches in
        `<mark>`) and **Copy**;
      - **More** loads the next page;
      - the result count is announced through `aria-live`;
      - Escape clears the box.
    - **Copy:** move `GlossaryEditor`'s copy-with-fallback into `ui/clipboard.ts`, and use it in both places.
13. **E2E harness** (`tests/e2e/helpers.ts`)
    - `useProjectFolder(page, files, { permission })` adds an init script that replaces `showDirectoryPicker` with
      a folder seeded with `files`. Use OPFS if Phase 10 confirmed it on `file://`, otherwise an in-memory
      handle. `permission: 'prompt'` makes the stored handle ask again, to test **Reconnect**.
    - `readProjectFiles(page)` returns what the app wrote.
    - Build the seed files with the Phase 12/13 test builders (`makeCorpus`, `makeDoc`) if Playwright imports them
      cleanly. Otherwise add a generator script, and say which in the Handoff.
14. **Perf** (`test:perf`): with a generated 300-hour project, measure:
    - the first load (nothing cached);
    - a second load from the cache;
    - a search query (assert under 200 ms);
    - rendering the sessions list.

    Record the numbers in TESTING.md and in the Handoff.
15. **Docs:** a "Projects" section in USER_GUIDE (open, create, reconnect, the brief, the model, search), and an
    *Added* entry in CHANGELOG. In TESTING.md, the new specs and a manual row: open a real OneDrive project in Edge
    and in Chrome.

## Contracts introduced

```ts
// storage/folder.ts
export interface FileStat { size: number; lastModified: number }
export interface FolderEntry { name: string; kind: 'file' | 'directory' }
export type FolderErrorKind =
  | 'unsupported' | 'cancelled' | 'permission' | 'not_found' | 'offline' | 'changed' | 'invalid' | 'io';
export class FolderError extends Error {
  readonly kind: FolderErrorKind;
  readonly userMessage: string;
  readonly path?: string;
}
export interface ProjectFolder {
  readonly name: string;
  list(dir?: string): Promise<FolderEntry[]>;                        // '' = the project folder
  stat(path: string): Promise<FileStat | null>;                      // null: no such file
  readText(path: string): Promise<{ text: string; stat: FileStat }>;
  writeText(path: string, text: string): Promise<FileStat>;
}
export function isFolderAccessSupported(): boolean;
export function pickFolder(): Promise<FileSystemDirectoryHandle>;    // FolderError('cancelled') if dismissed
export function folderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState>;
export function requestFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean>;  // from a click
export function openFolder(handle: FileSystemDirectoryHandle): ProjectFolder;
export function saveFolderHandle(handle: FileSystemDirectoryHandle, projectName: string): Promise<void>;
export function loadFolderHandle(): Promise<{ handle: FileSystemDirectoryHandle; projectName: string } | null>;
export function forgetFolderHandle(): Promise<void>;

// storage/projectFiles.ts
export interface SessionFileInfo {
  name: string;
  kind: 'transcript' | 'summary';
  base: string;
  conflictCopy: boolean;
  stat: FileStat;
}
export function readProject(folder: ProjectFolder): Promise<{ project: ProjectFile; stat: FileStat }>;
export function createProject(folder: ProjectFolder, name: string): Promise<{ project: ProjectFile; stat: FileStat }>;
export function writeProject(folder: ProjectFolder, project: ProjectFile, expected: FileStat): Promise<FileStat>;
export function listSessionFiles(folder: ProjectFolder): Promise<SessionFileInfo[]>;
export function readTranscriptFile(
  folder: ProjectFolder,
  name: string,
): Promise<{ file: SessionTranscriptFile; stat: FileStat }>;
export function writeTranscriptFile(
  folder: ProjectFolder,
  doc: TranscriptDoc,
  opts?: { name?: string; expected?: FileStat | null },
): Promise<{ name: string; stat: FileStat }>;

// storage/corpusCache.ts
export function getCachedSessionText(projectId: string, file: string, stat: FileStat): Promise<SessionText | null>;
export function putCachedSessionText(projectId: string, file: string, stat: FileStat, text: SessionText): Promise<void>;
export function pruneCorpusCache(projectId: string, keep: readonly string[]): Promise<void>;
export function clearCorpusCache(): Promise<void>;

// stores/project.ts
export type ProjectStatus = 'unsupported' | 'none' | 'reconnect' | 'loading' | 'ready' | 'error';
export interface ProjectSession {
  sessionId: string;
  transcriptFile: SessionFileInfo;
  text: SessionText;
  copies: string[];             // other files with the same session id (conflict copies)
}
```

## Acceptance criteria

- [x] **New project** creates `describe-project.json` and opens the Brief dialog. **Open project** opens an
      existing project, and refuses a folder that isn't one, with the message above.
- [x] After a reload, Home shows the project's name. Project mode asks for permission again where the browser
      requires it, with one **Reconnect** click.
- [x] Sessions in the folder are listed with name, language, duration and date. A file added "by a colleague"
      appears after the window gets focus.
- [x] A second load reads no transcript that hasn't changed (the cache works). Without IndexedDB, it still loads.
- [x] Unreadable files and conflict copies are reported in a `<details>`, and the rest loads.
- [x] The brief saves, and a brief changed by someone else is never overwritten without a choice.
- [x] The model select defaults to Sonnet 5.5 and remembers Opus 5.5 across a reload.
- [x] Search finds planted phrases across sessions in English and in the original text. **Copy** puts the turn and
      its citation on the clipboard, and a bad query shows its message.
- [x] **Clear saved data** forgets the project and the cache, but not the folder's files.
- [x] Perf: search under 200 ms on 300 hours; the load times are recorded.
- [x] The axe and keyboard specs cover every Project state and the Brief dialog. The maintainer has approved the
      layout at 1280 and 375 px.
- [x] Definition of Done in AGENTS.md.

## Required tests

- `folder.spec.ts`: error mapping for each kind, paths, and `writeText` creating folders. Use fake handles: happy-dom
  has no File System Access.
- `sessionFiles.spec.ts`: slugs (accents, long names, empty names, unicode), and classification (conflict copies,
  temporary files, other files).
- `projectFiles.spec.ts`, against `memoryFolder`:
  - create, open, invalid and changed files;
  - the transcript file round trip;
  - the `expected` check.
- `corpusCache.spec.ts` (fake-indexeddb): hit, miss on a changed stat, prune, a bad entry ignored, and IndexedDB
  unavailable.
- `stores/project.spec.ts`:
  - the status transitions;
  - load with progress;
  - duplicates and unreadable files;
  - refresh reading only what changed;
  - `saveBrief`, including the conflict;
  - search.
- `settings.spec.ts`: `projectModel` default, unknown value, persistence.
- Component specs: `ProjectView` (each state), `BriefDialog`, `SessionList`, `SessionSearch` (debounce, paging,
  Copy, Escape, the announcement).
- `tests/e2e/project.e2e.ts`: create, then open; reconnect after a reload; refresh on focus; search and Copy
  (grant clipboard permission in the context).
- `a11y.e2e.ts`, `keyboard.e2e.ts`, `about.e2e.ts` (Clear saved data), and the perf measures above.

## Out of scope

- Adding sessions, summaries, statuses and **Open transcript** (Phase 15).
- The chat (Phase 17).
- Recordings in the folder, and a project glossary (PROJECTS.md §10).

## Handoff

*(The layout the maintainer approved, the FSA typings choice, the harness choice, perf numbers, UI text trimmed
under D13.)*

### 2026-10-20 — Phase 14 done (branch `phase-14-project-folder`, based on `main_phase2` at `537f1dc`)

**Layout (the maintainer's choices, from screenshots at 1280 and 375 px)**
- **Every page is 80rem wide** (DECISIONS D24, was 60rem). Chosen over 80rem for Project mode only, where "Home" in
  the top row jumped about 160 px at 1280 px, and over two panes squeezed into 60rem.
- **Two panes:** the search box and sessions on the left (18–26rem), and on the right a blank pane behind a thin
  divider until Phase 15 (kept, by choice). Below 48rem the panes stack and the empty right pane is hidden.
- **The top row** in Project mode: `Home / <project name>`, then **Brief** · the Model select · **Change** at the end
  of the row. At 375 px the controls wrap under the name. `StepNav.vue` is now `AppHeader.vue` (Phase 11's
  suggestion), and the controls are `ProjectHeader.vue`.
- **Change** shows the chooser (**Open project…** / **New project…** / **Cancel**) in place of the panes, agreed at
  planning: the phase file's "open another project" left no way to create a second project. A cancelled or refused
  pick keeps the current project.
- Everything else was approved as shown. The screenshot spec and contact sheets are in the gitignored
  `.claude/phase14-screens/`.

**Choices this file left open**
- **FSA typings:** a small `src/storage/fileSystemAccess.d.ts` (`showDirectoryPicker`, `queryPermission`,
  `requestPermission`). TypeScript 6's DOM library already has the handles, `createWritable()` and async iteration,
  and `@types/wicg-file-system-access` (2023) duplicates them.
- **E2E harness:** in-memory handles, as the reference doc decided, but **the files live in Node** behind
  `page.exposeFunction`, not in `sessionStorage`: the perf project is 188 MB. Recorded in the reference doc's "E2E
  harness". Seeds are built in the specs from `makeCorpus` and the new `src/testing/projectSeed.ts`; Playwright
  imports both directly, so there's no generator script.
- **Perf** (`npm run test:perf`, 300 hours with word timings: 148 sessions, 147,034 turns, 188 MB): first load
  1,462 ms, load from the cache 206 ms, sessions list 12 ms, every bench query 49–60 ms (budget 200). TESTING.md has
  the table. The 3-hour transcript still meets every target at 80rem (render 191 ms, rename max 28 ms, Edit text on
  118 ms).

**Changed from this file**
- **Contracts:**
  - The cache keeps `savedAt` too, because grouping copies needs it: `getCachedSession(projectId, file, stat)` returns
    `{ savedAt, text } | null`, and `putCachedSession` takes the same.
  - `saveBrief(name, brief, base)`: `base` is the project file's stat when the dialog opened, so a background refresh
    that read a colleague's brief can't hide it from the change check. Returns `{ ok }` or
    `{ ok: false, reason: 'changed' | 'failed', message }`. `reloadProject()` serves **Reload**.
  - The store also has `openProject() → boolean`, `newProject() → { created } | null`, `reconnect()`, `retry()`,
    `search(text, offset = 0)`, `citationFor(sessionId, turnId)`, `sessionTitle()`, `speakerLabel()`,
    `scheduleRefresh()`, `forget()`, and the state `progress`, `problems`, `error` and `notice`.
  - `createProject` refuses (`changed`) when the folder already has a project file; the store opens it instead.
    `writeProject` writes the project as given; the store sets `updatedAt`.
  - `ProjectFile` (with `cleanLines`) is in `domain/project.ts` and `SessionTranscriptFile` in
    `domain/sessionFiles.ts`, beside `SessionSummaryFile`, so the UI never imports storage. Their schemas are in
    `storage/projectFiles.ts`.
- **Additions:**
  - The error state also offers **Open another project…**: Try again can't help when the folder was moved.
  - `refresh()` also runs when Project mode is entered (no `focus` event fires), and re-reads the project file when
    its stat changed.
  - The search corpus is prepared in an idle callback after each load or refresh. Otherwise the first query paid for
    normalising 300 hours: 370 ms instead of 57.
  - **Enter** searches at once. A bad query hides the list as well as the results. Emptying the box brings the list
    back without waiting for the debounce. A rescan that changes the sessions repeats the search.
  - `ui/clipboard.ts` has `writeClipboard(text)`. GlossaryEditor and the search keep their own fallback (the text
    selected for Ctrl+C).
  - `formatDate(ms)` in `domain/transcript.ts`, and `--color-highlight` for `<mark>` (contrast-tested).
  - `sessionBaseName` keeps letters in any script, spells `ß` as `ss` and collapses repeated dashes.
  - The project file is indented; transcript files are compact JSON.
- **Existing tests changed:** `glossary.e2e.ts`'s long-page check now adds 120 terms, because 60 short ones no longer
  fill a 1280 px window at 80rem. `App.spec`, `AboutDialog.spec` and `shell.e2e` lost the placeholder text.

**UI text (D13)**
- Model options are "Sonnet 5.5" and "Opus 5.5" (`PROJECT_MODELS` labels trimmed). The select's label "Model" and the
  search box's label "Search transcripts" are visually hidden, since the value and the placeholder say it.
- The brief's "metadata fields" are labelled **Respondent details**, hint "One per line, for example Age or
  Country." Research questions: "One per line." Context: "Objectives, the discussion guide, anything the summaries
  should know."
- Loading says "Opening the project…" until the count is known, then "Reading 12 of 40 sessions".
- The details summary reads "2 files couldn't be read · 1 conflict copy"; a copy's line is "<file>: an older copy of
  <file>, not shown."
- New messages: "The project's describe-project.json is missing. Open the project folder again.", "Describe can't
  read this project's describe-project.json.", "Someone else changed the brief. Reload to see their version." The
  folder errors use the reference doc's drafts; `io` has one message per operation (read, write, list).
- Search: "23 hits in 9 sessions" or "No matches" (the `role="status"` line). **Copy** turns into "Copied" for 1.5 s
  and is announced. Each Copy button's name is "Copy, <speaker> at <time>".
- Clear saved data now says it removes "the link to your project", and that the project's files stay.

**For Phase 15**
- The store keeps `folder` private. Add the writes (Add to project, autosave back to the file) as project-store
  actions, or expose what the pipeline needs; `writeTranscriptFile(folder, doc, { expected })` is ready. After a
  write, put the new stat into `known` (or call `refresh()`), so the file isn't read again.
- `load()` and `refresh()` ignore summary files (`kind === 'summary'`) for now; `listSessionFiles` already returns
  them, conflict copies included.
- `sessionTitle(sessionId)` returns the recording's name. Make it the summary's title.
- `SessionList` items aren't interactive yet, and `ProjectView`'s `.detail-pane` is the empty right pane.
- `newProject()`, `openProject()` and `reconnect()` work from any click, so the Add to project dialog can use them.
  `useProjectUi()` holds the Brief dialog and the chooser.
- A hit found in the original German text shows a German snippet, but **Copy** copies the English turn, as this file
  decided. Worth a look when researchers try it.

**Open**
- TESTING.md manual rows 15 (a real OneDrive project in Edge and Chrome) and 16 (F1–F4 on a Demant-managed laptop,
  with its browser policies) need the maintainer.
- With pages at 80rem, a long turn on Output can run to about 140 characters a line (D24). If it reads badly, cap the
  text column.
