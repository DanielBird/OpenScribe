# Testing DeScribe

## Automated tests

| Command | What it runs |
|---|---|
| `npm test` | Vitest unit and component tests (`src/**/*.spec.ts`, happy-dom). |
| `npm run bench` | Vitest benchmarks (`src/**/*.bench.ts`, Node): keyword search on a generated 300-hour corpus. Kept out of `npm test`, because timings depend on the machine. |
| `npm run test:e2e` | Builds, then runs Playwright (`chromium` project) against `dist/describe.html` over `file://`. API calls are mocked with `page.route()`, and every spec fails on a console error, page error or CSP violation. |
| `npm run test:perf` | Builds, generates a 3-hour transcript (`scripts/make-large-fixture.mjs`) and times it, then times a generated 300-hour project (`perf` project). Kept out of `test:e2e` and the release run, because timings depend on the machine. |

The e2e specs in `tests/e2e/`:

| Spec | Covers |
|---|---|
| `shell` | Loads from `file://` with no network requests; the CSP is first in `<head>` and blocks other hosts. Opens on Home; **Transcribe** returns to the step left, and **Home** leads back. |
| `setup`, `glossary` | The Setup and Glossary steps, including keyboard use. A language chosen from the list goes to ElevenLabs as its ISO 639-3 code (Phase 26). |
| `transcribe` | Run, progress, errors (401, 429), Cancel, rename, reload and autosave. A run carries on while Home is shown. |
| `export` | `.docx` downloads (Original, English, renamed speakers). |
| `edit` | Edit text: nothing moves when it turns on or off (1280 and 375 px), saved across a reload, Enter then Tab, Escape, a multi-line paste and Ctrl+Z, the `.docx`, and an English translation left unchanged. |
| `translate` | Claude and Gemini translation (Gemini streamed, Phase 19), batches, Resume, Cancel, reload. A Spanish transcript named in the header, the prompt, the version toggle and the file name (Phase 26). |
| `playback` | Click to play, highlight, Follow, re-attach after reload, unplayable formats. |
| `project` | Project mode on the fake folder: New project (the Brief opens), Open project and a folder that isn't one, Change, Reconnect after the browser session ends, a colleague's session on focus, the text cache, unreadable files and conflict copies, a colleague's brief (Reload), the model across a reload, search (the chat pane's **Search**) in English and the original, Copy, a bad query, and back to **Chat** and Search with the search kept. |
| `project-add` | Phase 15: **Add to project** on a new transcript (New project, the Brief, the key; saved, translated, summarised; the list shows the summary; Copy a quote); **Summarise** a German session that is only in the folder; an edit on Output reaching the file, the summary going out of date and **Regenerate**; a file changed behind DeScribe's back and **Keep mine**; **Summarise all** past a failure; the link kept across a reload, with **Reconnect** and no false conflict; a session whose files are deleted offered **Add to project…** again on focus, and added again. Phase 19: a German session summarised with Gemini 4 Argon (the Gemini key, the data line naming Google, both requests streamed to Gemini and none to Claude, `provider: 'gemini'` in both files, the model in the details, Copy a quote); from Output, a switch to Gemini 3.8 Flash in the Add to project dialog (the Gemini key, no Claude request, the same setting in the Analyse header).; after it, **Open summary** (focused when the work ends) showing the summary in Analyse mode, and Escape back to the chat. |
| `chat` | Phase 17: a question streamed through a tool call to an answer, its details (activity and cost) and a checked quote with **Copy**; an invented quote marked, HTML-like text shown as text; a follow-up carrying the earlier turns, and **New chat**; **Stop** mid-answer and the next question; a session added during the chat (the notice and its **New chat**); a 429 and **Try again**; a missing key and the key dialog. Phase 20: the same question with Gemini 3.8 Flash (the Gemini key, a function call whose thought signature goes back with the next request, the details and cost, a checked quote and **Copy**, nothing sent to Claude). |
| `settings` | Settings from the footer and Back to Home, a Transcribe step and Analyse; Setup's **Open Settings** while the key is missing; keys kept across a reload or a new tab (remembered or not); Verify key; Forget all keys; Clear saved data (including the project and its text cache, never the folder's files). |
| `a11y` | axe-core (WCAG 2.2 A/AA rules) on Home (idle, transcribing, with a project), every step, every dialog, Output with Edit text on, every Analyse state (unsupported, none, loading, ready, Search empty and with results, a bad query, Change, error, reconnect), the Brief dialog, and Phase 15's: the Add to project dialog (no project; open, key missing), the actions row adding and failed, the folder notice, a summary with its details open, and the Summarise all confirmation; and the chat: empty, the key dialog, answering, an answer with quotes, an error, and the notices; with a Gemini model (Phases 19 and 20), the grouped select, the chat's key dialog and the Summarise dialog asking for the Gemini key. Serious or critical violations fail. |
| `keyboard` | The whole flow with the keyboard only, with a visible focus indicator at every Tab stop, and focus returning to dialog triggers and moving to the view heading on a step or mode change. Home's two buttons and **Home**. Analyse: open, the Brief, the model (the arrow keys across its Claude and Gemini groups), **Search** under the chat's box (focus moves into its box), Copy and Change; the sessions list (one Tab stop, arrow keys, Enter), a summary, Summarise all and Open transcript. Add to project: the dialog (Escape returns focus), and focus kept in the actions row while it works and after. The chat: Enter and Shift+Enter, **Stop** (focus stays on it as it turns back into **Send**), the details, **Copy**, and Escape from a summary back to the question box. |
| `robustness` | A 50 ms recording, silence, one speaker, 32 speakers, a long unicode file name, blocked `localStorage`/`sessionStorage`, IndexedDB full, offline (ElevenLabs and Claude). |

**The project folder in e2e specs** (`tests/e2e/projectFolder.ts`, re-exported by `helpers.ts`):
`useProjectFolder(page, { '<folder name>': files }, { permission })` replaces `showDirectoryPicker` with in-memory
handles. The files live in the spec's Node process: `files(name)` returns what the app wrote, `put()` and `remove()`
change a file as a colleague would, `pickNext(name | 'cancel')` chooses what the next picker returns,
`setPermission('prompt')` ends access as a new browser session does, and `holdReads(prefix)` holds reading files to
show the loading state. `withoutFolderAccess(page)` takes the API away. Seed files come from
`src/testing/projectSeed.ts` (`projectFiles(docs)`, `summaryFileText(doc)`), `makeCorpus`, and the short German
sessions in `tests/e2e/sessionDocs.ts`. `mockAnthropic(page, projectAnswer)` answers translation batches with
`englishFor` and summary requests (`isSummaryCall`) with a valid summary of the turns they sent (`summaryFor`).
`mockAgent(page, (n, call) => reply)` answers the project agent's requests (those with `tools`; others fall through
to `mockAnthropic`) with streamed messages built by `src/testing/agent.ts`, an HTTP error (sent with
`x-should-retry: false`, so the SDK doesn't retry), or a reply held on a promise. Playwright sends a reply's body all
at once, so a partial answer for **Stop** comes from an earlier, complete request of the same question.
`mockGeminiAgent(page, (n, call) => reply)` does the same for the agent with Gemini (Phase 20): requests to
`generativelanguage.googleapis.com` with `tools` get a model turn built by `src/testing/geminiAgent.ts`, streamed by
`geminiSse`; others fall through to `mockGemini`.

### Corpus

The corpus core (`src/domain/corpus/`, Phase 12) is pure TypeScript with unit specs:

| Spec | Covers |
|---|---|
| `sessionText` | The text-only view of a transcript (English and German, with and without a translation), and what changes `transcriptHash`. |
| `normalize` | Case, accents (Latin, Greek, Cyrillic, Arabic and Hebrew points, Japanese voicing marks), `ß`, typographic quotes and dashes, words split at apostrophes and hyphens, and offsets into the original text. Vowel signs kept (Thai, Hindi, Kannada, Malayalam); Japanese and Thai segmented into words (Phase 26). |
| `query` | Words (AND), `"phrases"`, `prefix*`, `OR` (binds tighter than AND), `-exclusions`, and each error. A Japanese term split into its words. |
| `search` | The query semantics, the English, original and both fields, session filter, order, paging, snippets and marks, every planted phrase in a generated corpus, and one word found and marked inside a Japanese or Thai sentence. |
| `quoteCheck` | Changed case, punctuation and accents verify; a changed or added word doesn't; omissions marked `…`, `...` or `[…]`. |
| `sessionKeys`, `citation` | `s1…sN` keys and refs; the **Copy** text with and without a translation. |

`makeCorpus({ hours, seed })` in `src/testing/corpus.ts` generates the test corpus. It is seeded, so it is the same on
every run:
- sessions of 1–3 hours, at about 8,300 words an hour, with 2–5 speakers;
- half English, the rest German and French, each with a full English translation;
- planted phrases at known turns ("charger by the bed", "Ladegerät neben dem Bett", "das Hörgerät nachts", "le
  chargeur près du lit"), listed in its `planted` result. Their words are in no vocabulary, so a search finds only
  the planted turns.

`withWords: true` adds word timings, for realistic file sizes.

### Project folder

The project folder (Phase 14) has unit specs against fakes; happy-dom has no File System Access:

| Spec | Covers |
|---|---|
| `storage/folder` | Paths, `writeText` creating folders and aborting a failed write, the error mapping for each kind (`NotReadableError` is `offline` only when offline, never `permission`), the picker and permission calls, and the remembered handle. |
| `domain/sessionFiles` | Base-name slugs (accents, other scripts, long and empty names) and file classification (conflict copies, swap and other files). |
| `storage/projectFiles` | Create, open, invalid and changed project files; the transcript-file round trip and its `expected` check. Runs on `src/testing/memoryFolder.ts`. |
| `storage/corpusCache` | Hit, miss on a changed stat, prune, a bad entry ignored, and no IndexedDB. |
| `stores/project` | The statuses, load with progress, duplicates and unreadable files, the cache on a second load, refresh reading only what changed, the brief and its conflict, search and Copy text, and Clear saved data. |
| Components | `ProjectView` (each state, Change), `ProjectHeader`, `BriefDialog`, `SessionList`, `SessionSearch` (debounce, Enter, Escape, paging, Copy and its fallback, the count announced, a hit opening to its turn, Show all and Show fewer), `ChatPane`'s Chat | Search (the mode shown, focus, a search kept, an answer announced during a search). |

### Add to project and summaries

Phase 15's specs run the stores against `memoryFolder` behind `src/testing/folderMocks.ts` (the browser side of
`storage/folder.ts`, shared with `stores/project.spec.ts`) and a fake Claude (`setLlmProviderFactoryForTests`):

| Spec | Covers |
|---|---|
| `storage/projectFiles`, `storage/idb` | The summary-file round trip and invalid summary files; the remembered project link (D25) and a damaged one. |
| `stores/project` | Summaries loaded with their sessions, conflict copies, statuses (out of date by transcript and by brief), the theme vocabulary with and without a session, and the writes and reads the pipeline and Output make, without reading a file back. |
| `stores/pipeline` | Every step order (English skips translation), the files written with their hashes and model, Resume after each step (a translation from its finished batches), Cancel and a late reply, the queue (one at a time, Add to project first, stop on `auth` or `quota`, carry on past others), `beforeunload`, the session open on Output, and the Output transcript replaced mid-translation. |
| `stores/transcriptLink` | The link set, dropped and remembered; saves debounced and in order; a conflict with Reload and Keep mine; lost access and Reconnect; after a reload: Reconnect without a false conflict, missed changes saved, a colleague's change, the same text with a new stat, relinking by id; the link dropped when its file is deleted (on a rescan and after a reload), and kept for a file that is there but unreadable. |
| Components | `OutputView` (**Open summary**: shown with a summary in the open project, opening it in Analyse mode), `AddToProjectDialog` (each project state, the key, the data line, the model select: its groups, a switch to Gemini asking for that key or not), `PipelineStatus`, `FolderNotice`, `SessionList` (selection, arrow keys, status marks, Summarise all), `SessionSummary` (each status, every section, quotes checked again, Copy all, Open transcript), `QuoteCard`, `SummariseDialog`. |

### Gemini for projects

Phase 19's specs (`src/testing/geminiSse.ts` builds the stream the SDK reads, one network read per event):

| Spec | Covers |
|---|---|
| `providers/llm/gemini` | The streamed request (`:streamGenerateContent?alt=sse`, the thinking level, the schema, the key in a header); a reply in several chunks with thought parts left out; every refusal finish reason, a blocked prompt, `MAX_TOKENS`, unreadable JSON and an unreadable event; HTTP 402 and 429 (a daily quota against a rate limit), and a 429 inside the stream, without the key; an abort before and during the stream; the summary schema with no `$ref`/`$defs` and its nullable field as a type array. |
| `providers/llm/models` | Each project model's provider and label; an unknown id (Claude, labelled with the id). |
| `stores/pipeline`, `stores/settings`, `storage/projectFiles` | A Gemini job with the Gemini key, `provider: 'gemini'` in the translation and the summary; the missing Gemini key; a Gemini rate limit stopping the queue and a Claude one not; `projectProvider` following the model; summary files with, without and with an unknown provider. |
| Components | `ProjectHeader` (the two groups), `AddToProjectDialog` and `SummariseDialog` (the Gemini key and the data line naming Google), `SessionSummary` (the Gemini label). |

Phase 20's specs, for the chat with Gemini (`src/testing/geminiAgent.ts`: a scripted fake `fetch`, request n → reply
n, each request kept, and builders for model turns, text, thought and function-call parts, usage and Google errors):

| Spec | Covers |
|---|---|
| `providers/llm/geminiAgent` | The request (instructions then context, the declarations in order, the thinking level, the output limit), unchanged on every request and on a follow-up; search → read → answer with streamed text, tool events and usage (cached tokens taken out of the input, thinking added to the output); a follow-up sending the earlier turns unchanged with their thought signatures; thought parts never in the text; parallel calls answered in one turn, in order, with their ids; a tool that throws, bad arguments, an unknown tool; `maxIterations`; `MAX_TOKENS` with and without a call; a malformed or unexpected call sent again once, then `bad_output`; `TOO_MANY_TOOL_CALLS`; every refusal finish reason and a blocked prompt; an abort mid-stream and mid-tool; HTTP 400 (`API_KEY_INVALID` and another), 401, 402, 403, 429, 5xx, a failed fetch and an error inside the stream, without the key; a conversation from another model, another provider or nowhere. |
| `providers/llm/gemini`, `providers/llm/models` | The exclusive bounds of the agent's tool schemas written as inclusive ones; the Gemini prices. |
| `stores/chat`, `ChatPane` | A Gemini model asks Gemini with the Gemini key; a chat keeps its provider when the model changes, until **New chat**; `needsKey` follows the provider; the key dialog with the Gemini label and naming Google. |

### Project chat

Phase 17's specs run the chat store against a fake `AgentProvider` (`setAgentProviderFactoryForTests`), with
`requestAnimationFrame` run by hand:

| Spec | Covers |
|---|---|
| `stores/chat` | The provider made for the chat's model; the snapshot made once and the context unchanged for a follow-up; the parse throttled to one per frame; success, the backstop (`limit`), an error (the conversation kept) and **Try again**; **Stop** (the partial answer kept, the next question going on from before it); a question while one runs; **New chat** and a new snapshot; the three notices and `needsKey`; another project; no storage written. |
| Components | `AnswerBlocks` (every block kind, HTML-like text, both quote variants), `ChatActivity` (the summary line, costs, nothing to show), `ChatInput` (Enter, Shift+Enter, IME, Send and Stop), `ChatPane` (the status for screen readers, Stop, Try again, the key dialog, the notices, following the answer), `QuoteCard` (the Copy button's name, an unknown turn), `ProjectView` (summary and chat, Escape). |

## Performance

`npm run test:perf` on a synthetic 3-hour meeting: 4 speakers, 25,001 words, 2,209 turns. It asserts the targets at
normal speed, and repeats the run at 4× CPU throttling (a slow laptop) for information.

Results for 1.0.0 (2026-10-14, the maintainer's Windows PC, Playwright Chromium):

| Measure | Target | 1× CPU | 4× CPU |
|---|---|---|---|
| Render after transcription (response → painted) | < 1 s | 198 ms | 979 ms |
| Startup with a saved transcript (to the Setup banner) | – | 123 ms | 348 ms |
| Render on **Open** | < 1 s | 113 ms | 544 ms |
| Scroll through the whole transcript | – | p95 frame 17 ms | p95 frame 33 ms |
| Rename, per keystroke (typing a 24-character name) | < 100 ms | mean 19, max 28 ms | mean 113, max 190 ms |
| Export `.docx` | < 5 s | 186 ms | 818 ms |
| Autosave (IndexedDB write) | – | 31 ms | 70 ms |

Renames were 58–100 ms per keystroke (300–420 ms at 4×) until the speaker column got a fixed width (DECISIONS D17).

Edit text, added in Phase 9 (2026-10-14, same PC):

| Measure | Target | 1× CPU | 4× CPU |
|---|---|---|---|
| **Edit text** on (click → every turn painted as a box) | < 1 s | 312 ms | 1,747 ms |
| Edit, per keystroke (typing 48 characters into a turn mid-list) | < 100 ms | mean 17, max 24 ms | mean 74, max 129 ms |

The PC was slower that day: the Phase 8 measures came out higher on the branch and on `main` alike (render 335 ms,
Open 233 ms, rename mean 49 / max 67 ms on `main` at 1×), so the table above is not comparable line by line.

### Corpus search

`npm run bench` searches a generated 300-hour corpus (`makeCorpus({ hours: 300, seed: 20261019 })`): 148 sessions,
147,000 turns and 2.5 million words. 67 sessions are German or French with an English translation. Each query runs
on English and original text (`field: 'both'`, 5 hits listed per session). The budget is 200 ms per query (DECISIONS T12). The browser measure is in Phase 14's `test:perf`.

Results (Phase 12, 2026-10-19, the maintainer's Windows PC, Node 22.19):

| Query | Mean | p99 |
|---|---|---|
| `battery` (a word) | 40 ms | 44 ms |
| `charg*` (a prefix) | 33 ms | 43 ms |
| `"charger by the bed"` (a phrase) | 41 ms | 48 ms |
| `night OR evening` | 65 ms | 75 ms |
| `battery -app` (an exclusion) | 45 ms | 52 ms |
| `charg* night OR evening` | 53 ms | 66 ms |
| `the` (in most turns; for information) | 38 ms | 45 ms |

It's a plain scan: every turn's text is normalised once (`prepareCorpus`), then each query is a few `includes`
calls per turn. Preparing the 300 hours took 405 ms, plus 42 ms to turn the transcripts into session text. Vitest
warns that its module runner slows the prepare figure, so in the app it's at most that.

### Project load and search

`npm run test:perf` also opens a generated 300-hour project in the browser: the `npm run bench` corpus with word
timings (148 sessions, 147,034 turns, 188 MB of transcript files), through the fake folder. Files are moved into
the page before each timed load, so the times are the app's own: reading, checking, converting and caching.

Results (Phase 14, 2026-10-20, the maintainer's Windows PC, Playwright Chromium):

| Measure | Budget | 1× CPU |
|---|---|---|
| First load (nothing cached): **Open project** → every session listed | – | 1,462 ms |
| Load from the text cache: **Reconnect** → every session listed | – | 206 ms |
| Search, Enter → results painted, each of the 7 bench queries | < 200 ms | 49–60 ms |

**Phase 15 (2026-10-20):** this test fails before it measures the load from the cache, on the Phase 14 commit as well
as on Phase 15. After the reload, the page shows the no-project state instead of **Reconnect** within the expect
timeout (5 s). The 3-hour transcript still meets every target: render 308 ms, rename mean 28 / max 55 ms, Edit text
on 152 ms. Summary files aren't part of the generated 300-hour project, so its load path is unchanged.

**2026-10-28 (D30):** the search moved into the chat pane, so clearing it no longer re-renders the sessions list. The
"Sessions list (148) after clearing the search box" measure (12 ms) was dropped; the test now switches the pane to
**Search** before it times the queries.

The first query used to take 370 ms, because it prepared the corpus for search (normalising 300 hours). The store
now does that in an idle callback once the list is painted. On a real OneDrive folder whose files are only in the
cloud, the first load also waits for the downloads: about a minute for 210 MB (reference doc, F8).

## Manual checklist (before every release)

Run it with the **release file, downloaded from SharePoint** (so it carries the *Mark of the Web*), in **Edge and
Chrome** on Windows. Use your own recordings and keys, and never commit either. Mark each cell ✔, or ✘ with a note
below the table.

| # | Scenario | Edge | Chrome |
|---|---|---|---|
| 1 | Open the file from Downloads (with Mark of the Web): no warnings or blocked features | ☐ | ☐ |
| 2 | 5 min English interview, 2 speakers, auto language, no glossary | ☐ | ☐ |
| 3 | 15 min German meeting, 4 speakers, language = German, glossary of 30 terms | ☐ | ☐ |
| 4 | 10 min French recording, speakers = Auto | ☐ | ☐ |
| 5 | 60+ min file: completes, the timer runs, the result is correct (records **V4**) | ☐ | ☐ |
| 6 | Rename speakers → export Original `.docx` → opens cleanly in Word | ☐ | ☐ |
| 7 | Translate the German transcript with Claude, then with Gemini → export English `.docx` (records **L3**) | ☐ | ☐ |
| 8 | Click turns → playback is in sync; Follow works; Space plays and pauses | ☐ | ☐ |
| 9 | Reload mid-way → Setup offers the last transcript; re-attach the audio → playback | ☐ | ☐ |
| 10 | Wrong key → a clear error; Cancel mid-upload → a clean state | ☐ | ☐ |
| 11 | Zero retention on (an Enterprise key if available; otherwise the expected error) | ☐ | ☐ |
| 12 | Remember key on and off, across a reload and a browser restart | ☐ | ☐ |
| 13 | **Edit text** → correct a turn → reload → **Open** → the edit is there → export Original `.docx` → it has the edit | ☐ | ☐ |
| 14 | Start a run → **Home** → Home shows *Transcribing…* → it finishes → **Transcribe** → Output shows the transcript | ☐ | ☐ |
| 15 | A real OneDrive project: **New project…** in a synced folder → Brief → close the browser → **Reconnect** → a colleague's new session appears on focus → search → **Copy** pastes the turn with its citation | ☐ | ☐ |
| 16 | On a Demant-managed laptop with `OneDrive - Demant`: run F1–F4 of [reference/file-system-access.md](reference/file-system-access.md#how-to-run-the-checklist), and note any `FileSystem` policies in `edge://policy` / `chrome://policy` | ☐ | ☐ |
| 17 | A real German session and a real English one → **Add to project** in a OneDrive project → the German one is translated, both are summarised → read each summary, **Copy** a quote → rename a speaker on Output → the session is out of date → **Regenerate** → close the browser, reopen, edit → **Reconnect** saves it (records **S1**–**S3**) | ☐ | ☐ |
| 18 | A real OneDrive project with summaries → ask a question you know the answer to → the activity and cost look right, the quotes are checked and **Copy** pastes with the citation → a follow-up → **Stop** mid-answer → **New chat** → with Opus 5.5 too (records **A1**, run in Phase 18) | ☐ | ☐ |
| 19 | With **Gemini 4 Argon** selected in Analyse mode: **Add to project** on a real German session → the dialog asks for the Gemini key and names Google → it is translated and summarised → the summary's details say "Made with Gemini 4 Argon" → **Copy** a quote (records **G1**–**G3**) | ☐ | ☐ |
| 20 | Row 18 with **Gemini 3.8 Flash**, then **Gemini 4 Argon**: the same questions, the activity and cost, the quotes checked, a follow-up, **Stop**, **New chat** (records **A1**–**A4** for Gemini) | ☐ | ☐ |
| 21 | A short Spanish recording with language = Spanish, and a Japanese one with Auto-detect → each header names the language → **Translate to English** → export both versions → add both to a project → search a word of each original (records **V7**) | ☐ | ☐ |

Where results go:
- **Scenario 5:** processing time ÷ audio length (shown on Output) goes into the V4 row of
  [reference/elevenlabs-stt.md](reference/elevenlabs-stt.md).
- **Scenario 7:** rough tokens, cost, duration and quality notes for each provider go into the L3 row of
  [reference/llm-providers.md](reference/llm-providers.md). It's also the first proof that the real APIs accept the
  browser's CORS preflight.
- **Scenarios 2–4:** the processing times go into the V4 row too.
- **Scenario 16:** the results go into the checklist and verification log of
  [reference/file-system-access.md](reference/file-system-access.md). A policy that blocks folder access is a
  no-go for projects on those laptops (PROJECTS.md §9 Q4).

**The desktop app:** for each desktop release, also run W1–W15 in
[reference/desktop.md](reference/desktop.md#checklist), on the maintainer's PC and on the work laptop.

### Results for 1.0.0

*Not run yet.* Fill in the table above, copied here with the date and the browser versions.
