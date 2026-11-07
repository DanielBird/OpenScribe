# Decision log

Short records of decisions that shape the build. Add new entries at the bottom. Do not rewrite old ones: if a
decision changes, add an entry that replaces the earlier one and mark the earlier one *Superseded by Dn*.

## Product decisions (agreed with the product owner, 2026-10-13)

### D1 — Vue 3 + TypeScript, compiled to a single HTML file
- **Decision:** Vue 3 (Composition API) + TypeScript strict + Vite + `vite-plugin-singlefile`. Pinia for state.
  Plain scoped CSS, no UI kit, no CDN.
- **Why:** The UI has real interactive state across three steps: the job lifecycle, a glossary editor, and a
  transcript that stays in sync with audio playback. Upcoming features (provider choice, AI audit) add more. A
  framework avoids hand-written DOM updates. The maintainer knows Vue. The framework adds about 35 KB, which
  doesn't matter for a single shared file.
- **Consequence:** No vue-router. Navigation is one `step` value in a store, so there are no URL concerns on
  `file://`.

### D2 — No audio chunking
- **Decision:** Upload each file whole. Before uploading, reject files over **3 GB** or **10 h** with a clear
  message.
- **Why:** ElevenLabs accepts these sizes in one request. Splitting would give each chunk independent speaker IDs
  ("Speaker 1" in chunk 2 might not be "Speaker 1" in chunk 1) and would complicate timestamps.
- **Consequence:** No chunk-length setting in the UI.

### D3 — API keys: "Remember keys on this computer" opt-in
- **Decision:** Ticked → the keys are stored in `localStorage`. Unticked → they are stored in `sessionStorage`
  (survives a reload, cleared when the tab closes). One checkbox, under the keys on Settings (D27),
  applies to the ElevenLabs, Claude and Gemini keys together. It starts ticked when any key is already in
  `localStorage`, and the other keys then move there too. A key typed in the Translate dialog follows it.
- **Why:** Balances convenience and safety. Users decide. One setting instead of one per key (2026-10-14): the
  risk is the same for every key, and one choice is simpler.
- **Consequence:** The help text must warn that in Chromium, every HTML file opened from disk shares the same
  storage, so another local HTML file could read a remembered key.

### D4 — Clean verbatim transcripts, fixed
- **Decision:** Always send `no_verbatim=true` and `tag_audio_events=false`, plus `diarize=true` and
  `timestamps_granularity=word`. The UI does not expose these options.

### D5 — Setup options
- **Decision:** Language dropdown (Auto-detect *(default)* / English / German / French). Optional "Number of
  speakers" (Auto or 1–32). "Zero retention (Enterprise only)" checkbox, off by default
  (`enable_logging=false`). *Language list widened by D37: Auto-detect and ElevenLabs' 36 most accurate languages.*

### D6 — One glossary list
- **Decision:** A single list, saved to `localStorage` after every edit. Users can paste, edit inline, delete,
  clear all, and copy the list. Terms are sent as ElevenLabs `keyterms` and given to the translation step.
- **Consequence:** Colleagues share glossaries by copy and paste (hence the "Copy list" button).

### D7 — Translation on demand from the Output tab
- **Decision:** A "Translate to English" button on the Output tab. The user picks **Claude or Gemini**. A switch
  shows Original or English. The export dialog asks which version to download.
- **Why:** ElevenLabs does not translate. On-demand means users pay for translation only when they need it.

### D8 — Speaker renaming in v1
- **Decision:** Speaker labels can be renamed. The new labels are used in the view and the export. Transcript
  text became editable in Phase 9 (D19).

### D9 — DOCX layout: one paragraph per turn
- **Decision:** A header block (title, source file, duration, date, language/version, speakers, engine), then one
  paragraph per turn: `[HH:MM:SS] Speaker: text`.

### D10 — One file per run; autosave the latest transcript
- **Decision:** Each run handles one file. The latest `TranscriptDoc` (including speaker names and translation) is
  autosaved to IndexedDB. Audio is not stored, so for playback after a reload the user re-attaches the file.

### D11 — Provider abstractions
- **Decision:** A `TranscriptionProvider` interface (only ElevenLabs is implemented now) and an `LlmProvider`
  interface (Claude and Gemini, used for translation now and the AI audit later).

### D12 — Browsers, language, name
- **Decision:** Edge and Chrome (Chromium) are the targets; Firefox is best-effort. The UI is in English. The
  product is named **Describe**. *Name superseded by D35: DeScribe.*

## Technical decisions (made while planning)

### T1 — CSP injected only in production builds
A `<meta http-equiv="Content-Security-Policy">` is added by a small Vite plugin with `apply: 'build'` (the dev
server needs inline modules and HMR websockets). The policy is:
`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:;
font-src data:; connect-src https://api.elevenlabs.io https://api.anthropic.com https://generativelanguage.googleapis.com;
base-uri 'none'; form-action 'none'`.
`'unsafe-inline'` is unavoidable because the whole app is inlined. `'unsafe-eval'` must never be added.

### T2 — XHR, not fetch, for the transcription upload
`fetch` cannot report upload progress. Files can be gigabytes in size, so users need a progress bar. The XHR is
wrapped in a small injectable `transport` so it can be tested.

### T3 — Normalized tokens between provider and domain
Providers return a `NormalizedTranscription` (a flat token list with speaker IDs and times).
`domain/buildTranscriptDoc` does the segmentation, so the turn-building rules are the same for any future
provider.

### T4 — `TranscriptDoc` held in `shallowRef`
A 3-hour recording has about 25k words. Deep reactivity on that would be slow, so the doc is replaced immutably.

### T5 — Turn IDs are `t1…tN`
IDs are short and deterministic, which keeps translation prompts compact and makes it easy to check that every
ID came back.

### T6 — LLM SDKs
Claude: `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true`. Gemini: `@google/genai`. If `@google/genai`
cannot be bundled into the single file, or adds more than 1 MB, the fallback is a direct REST call to
`generativelanguage.googleapis.com` (record the change here if it is used).

### T7 — Model lists live in one file
`src/providers/llm/models.ts` lists the selectable models and the defaults: Claude `claude-opus-5-5`
(alternative `claude-sonnet-5-5`), Gemini `gemini-3.8-flash` (alternatives `gemini-3.6-flash`,
`gemini-3.5-flash-lite`). Changing a model is a one-line edit.

### T8 — zod runs in jitless mode, imported only via `src/lib/zod.ts`
zod 4 speeds up object parsing by compiling code with `new Function`. It checks whether eval is allowed when an
object schema is *constructed* (verified in the zod 4.6.7 source: `allowsEval.value` is read in the
`$ZodObjectJIT` initialiser). Our CSP forbids eval (T1), so that check would log a CSP violation as soon as a
schema module loaded. `src/lib/zod.ts` calls `config({ jitless: true })` and re-exports `z`. Every schema module
imports `z` from there, so the config always runs before any schema is created; calling it from `main.ts` would be
too late. An ESLint `no-restricted-imports` rule blocks importing `zod` (or `zod/*`) anywhere else. Jitless parsing
is slower, but our payloads (one transcript, a few translation batches) are small.

## Later decisions

### D13 — Minimal UI: say it once, show detail only when it's needed
- **Decision** (agreed with the product owner, 2026-10-13): screens stay sparse.
  - **Say each thing once.** If a placeholder, button or label already says it, drop the heading or help text that
    repeats it. *Example:* an "Add terms" heading above a textarea whose placeholder reads "Paste terms — …" is
    one too many; the placeholder is enough.
  - **Show detail only when it's needed.** Show what the next action needs. Put explanations and rarely used
    options behind a `<details>`, and show a warning or error only when it applies.
  - **No on-screen confirmation of what the user can see happen.** *Example:* no "Added 3" when the list visibly
    grows. Screen readers still get it through a visually hidden `aria-live` region.
  - **Short copy.** Labels and buttons are a few words. Help text is one short sentence, and only for controls
    that aren't self-explanatory.
- **Why:** the first UI built from the phase files was too wordy. Colleagues should be able to take in a step at a
  glance.
- **Consequence:** UI text in the phase files is a draft. Agents trim it to fit this decision and note what changed
  in the phase's Handoff. Accessibility (AGENTS.md rule 9) is unchanged: when visible text goes, the accessible
  name or announcement stays.

### D14 — Translation runs in the actions row, not in a dialog
- **Decision** (agreed with the product owner, 2026-10-13): the **Translate to English** dialog only collects the
  choices: provider, model, the key if it's missing, and the one-line data notice. After **Translate**, the dialog
  closes and the Output actions row shows *"Translating… batch 3 of 12"*, a progress bar and **Cancel**. An error
  appears in the same row with **Resume**.
- **Why:** colleagues can keep reading and renaming speakers while a long transcript translates. It also keeps the
  dialog simple: one set of buttons instead of three states.
- **Consequences (D13):**
  - With a translation present, the button reads **Re-translate…** and the same dialog says *"This replaces the
    English translation."*. There is no second "Replace…?" dialog.
  - **Translate** is hidden, not disabled, for English transcripts.
  - The Original | English switch appears only once a translation exists.
  - The phase file's draft had all three the other way.

### T9 — Claude translation settings: effort `medium`, server-side refusal fallback
- **Effort:** `output_config.effort: 'medium'`, set explicitly (`CLAUDE_EFFORT` in `providers/llm/models.ts`).
  Opus 5.5 can't turn thinking off, so effort is the only control for cost and depth. Its API default is `medium`,
  Sonnet 5.5's is `high`, so setting it keeps both models alike. Chosen by the product owner over `low`.
- **Fallback:** every Claude request sends `fallbacks: 'default'` with the beta header
  `server-side-fallback-2026-07-01`. This follows the `claude-api` skill's default for these models. If a safety
  classifier declines a benign transcript (a false positive), the API re-runs the request on the model Anthropic
  recommends for that refusal category, instead of stopping the translation.
- **Consequences:**
  - `translations.en.model` records the model the user chose, even if a fallback model served a batch.
  - A refusal that survives the fallback is a `refused` ProviderError.
  - The adapter streams (`beta.messages.stream` + `finalMessage`, since Phase 13) and sends only the JSON schema
    from the SDK's `betaZodOutputFormat`, then parses the text itself. Like `beta.messages.parse`, a stream given the
    format's `parse` would parse the text before a refusal could be detected.

### D15 — Speaker colours: Tableau 10, as marks only
- **Decision:** speakers use the Tableau 10 palette (`--speaker-1` … `--speaker-10` in `tokens.css`), cycling after
  ten. The colour appears as a dot before the speaker's name, the Speakers panel swatch and the playing-turn bar and
  tint. Names are drawn in the normal text colour.
- **Why:** chosen by the product owner. Most Tableau 10 colours are below 4.5:1 on white, so they can't be text
  colours. The name identifies the speaker; the colour only helps tell turns apart at a glance.

### D16 — DM Sans as the UI font, bundled
- **Decision:** the UI font is DM Sans (`@fontsource-variable/dm-sans`, dev dependency, `wght.css`: Latin and
  Latin-extended). Vite inlines the woff2 files as `data:` URIs, so the single-file and CSP rules still hold
  (`font-src data:`). The system font stack stays as the fallback, and `--font-mono` is unchanged.
- **Why:** chosen by the product owner.
- **Consequences:** `describe.html` grows by about 75 KB. The `.docx` export stays Calibri, because DM Sans is not
  installed on colleagues' machines.

### D17 — Speaker column: a fixed 10rem in every turn
- **Decision** (agreed with the product owner, 2026-10-14): each turn lays out its own two columns, and the speaker
  column is always 10rem. The turn list is a plain column of turns. Before, it was one grid whose speaker column was
  as wide as the longest name (up to 12rem), and every turn used it through `subgrid`.
- **Why:** Phase 8 timed a 3-hour transcript (2,209 turns).
  - **Before:** each rename keystroke re-laid out the whole shared grid. Once the typed name became the longest, each
    keystroke also widened the column and re-wrapped every paragraph: 58–100 ms per keystroke at full speed, and
    300–420 ms at 4× CPU throttling.
  - **After:** mean 19 / max 28 ms, and 113 / 190 ms at 4×.
  - **Tried and rejected:**
    - `content-visibility: auto` on turns: a contained turn can't be a subgrid, and it clipped the playing-turn bar.
    - `content-visibility: auto` on the text only: rename and scrolling both got slower.
- **Consequences:**
  - Short names leave a wider gap before the text.
  - Names longer than 10rem wrap, as before.
  - Narrow windows still stack the timestamp, speaker and text.
- **Changed** (product owner, Phase 9, 2026-10-14): from 12rem to 10rem. The timings above were measured at 12rem.

### D18 — Storage migration policy
- **Decision:** stored data keeps the `describe.v1.*` keys and the `describe-v1` IndexedDB database. A change to the
  shape of stored data needs one of these, plus an entry here:
  - a new namespace (`describe.v2.*`, `describe-v2`); or
  - a migration function in `src/storage/` that upgrades the old shape when it's read.
- **Why:** in Chromium, every HTML file opened from disk shares one storage. Colleagues' glossaries, settings and
  remembered keys carry over to each new release, and an older release may still open data a newer one wrote.
- **Consequences:**
  - Readers validate what they load and fall back to defaults, never repair it (already true: `PrefsSchema` falls
    back field by field, and `TranscriptDocSchema` ignores a doc that doesn't match).
  - A new optional preference with a default isn't a shape change.
  - Details: [RELEASING.md](RELEASING.md#saved-data-across-versions).
  - Fields a reader doesn't know: D38.
  - The project folder's files, since 1.1.0: D40.

### T10 — The `braces` npm-audit advisory is accepted
`npm audit` reports 5 high-severity advisories for `braces` (GHSA-vfj7-8cjw-p6xm, a denial of service through
deeply nested patterns), via `micromatch`/`fast-glob` in `vite-plugin-singlefile` and
`@vue/eslint-config-typescript`.
- **Accepted** (checked 2026-10-14): these are build-time dev dependencies that only ever see the project's own
  globs, and nothing from them ships in the HTML.
- There is no fixed `braces` version. npm's only fix downgrades `vite-plugin-singlefile` to 0.9, a breaking change.
- Check again when either package updates.

### D19 — Turn text is editable
- **Decision** (agreed with the product owner, 2026-10-14): an **Edit text** button on the Output tab turns each
  turn's text into a plain text box. Only the text changes: speakers, timestamps and turns stay as they are.
  Enter finishes a turn, and text has no line breaks. This replaces the last sentence of D8.
- **Why:** colleagues need to fix misheard words and names before passing a transcript on.
- **Consequences:**
  - `Turn.text` is overwritten. `Turn.words` keep the machine transcription and no longer match an edited turn.
    Anything that later reads `words` (word highlighting, the AI audit F1) must allow for that.
  - No change to the stored shape, so D18 doesn't apply.
  - An English translation is not updated or flagged when the original changes. Users translate again if needed.
    *Changed by D39: a turn changed since it was translated is marked, and only those turns are translated again.*
  - Splitting, merging and reassigning turns, and undo across turns, stay in future.md F3.

## Release 2: Projects (agreed with the product owner, 2026-10-15)

The architecture is in [PROJECTS.md](PROJECTS.md). Its §2 lists every agreed point (A1–A18); the entries below
summarise them.

### D20 — Projects: a shared folder of transcripts and summaries
- **Decision:** a **project** is a folder that OneDrive (or SharePoint sync) keeps on each researcher's computer. It
  holds `describe-project.json` (name and brief) and, in `sessions/`, one transcript file and one summary file per
  session. Recordings stay out. A session joins a project through **Add to project** on Output: save, translate if
  needed, summarise. A new **Home** page offers two modes, **Transcribe** (Setup → Glossary → Output, unchanged) and
  **Project**. There is no import of older transcripts.
- **Why:** the research team (250–300 hours of interviews and fieldwork) needs every colleague's sessions in one
  place, without a server or IT approval. The transcript is the research object, whatever the number of
  respondents.
- **Consequences:**
  - Summaries are JSON, read only through Describe. Nothing is exported to .docx or .md.
  - Metadata belongs to the session, which lists its respondents. There is no register of respondents.
  - Test recordings stay out of a project unless someone adds them.

### D21 — Session summaries: guided by the brief, in English, regenerated not edited
- **Decision:** one Claude call per session writes a summary: title, synopsis, overview, respondents and their
  details, a finding per research question, themes, key moments and quotes.
  - The project **brief** (research questions, context, the respondent details to extract) guides every summary.
    The agent reuses the theme names the project already uses and adds emergent ones.
  - **Everything is in English.** A German or French session is translated first.
  - The agent extracts respondent details. People are named by their speaker labels, with no automatic
    pseudonymisation.
  - Summaries are **regenerated, never edited**.
- **Why:** consistent themes across sessions, without the upkeep of a fixed codebook; a summary that can't drift
  from its transcript.
- **Consequences:** to fix a summary, fix the transcript, the speaker names or the brief, then **Regenerate**. A
  summary is out of date when its transcript or the brief changes.
- **Changed (maintainer, 2026-10-28):** there are no separate key moments or quote list. Instead, each research
  question's finding and each theme has up to 2 supporting quotes, which are checked as before (T13).
  - A quote then sits next to the claim it supports, so nobody has to match the two up.
  - The summary file's shape changed before release 2 shipped, so D18 needs no migration: `schemaVersion` stays 1.
    Summary files from before the change read as invalid; summarise those sessions again.
    *1.1.0 shipped after this change (D40), so a further change to the summary file needs D18.*

### D22 — Project agent: Claude only, keyword search, quotes copied with their citation
- **Decision:**
  - A chat in Project mode answers questions about the corpus with Claude only. Translation on the Output tab keeps
    Gemini.
  - The agent runs to the end within a per-question cap: 250k tokens of transcript text and 30 tool calls. What it
    searched and read is shown, collapsed.
  - Chats are not kept.
  - Quotes leave Describe through **Copy with citation**.
  - Researchers also get the same keyword search as a search box in Project mode.
- **Why:** quotes and session summaries are the main jobs. One provider halves the agent work and testing. Not
  keeping chats avoids storage and sharing questions.
- **Consequences:** no quote collections, no .docx answers and no chat history in release 2 (PROJECTS.md §10).
- **Changed (2026-10-21, D26):** "Claude only" is replaced. Summaries and the pipeline get Gemini in Phase 19, and the
  agent in Phase 20.
- **Changed (2026-10-27, D29):** "Chats are not kept" is replaced. Chats are saved in the project folder (Phase 21).

### D23 — Project model: Claude Sonnet 5.5 by default, Opus 5.5 as the option
- **Decision:** project work (the pipeline's translation, summaries and chat) uses `claude-sonnet-5-5` unless the
  user picks `claude-opus-5-5` in Project mode. The choice is saved on each computer, as a new optional preference.
  The effort is set explicitly to `medium` for both models.
- **Why:** chosen by the product owner, for cost. Sonnet 5.5 costs half as much as Opus 5.5 for input and output.
- **Consequences:**
  - A change of model applies from the next chat. A conversation keeps its model, because thinking blocks belong to
    the model that wrote them and a switch would invalidate the cache.
  - The Translate dialog keeps its own default and choice (T7).
- **Changed (2026-10-21, D26):** the project model can also be a Gemini model. Sonnet 5.5 stays the default.

### T11 — The project folder goes through the File System Access API, not Microsoft Graph
- **Decision:** Describe reads and writes the project folder on the local disk with `showDirectoryPicker` and keeps
  the handle in IndexedDB. OneDrive does the syncing.
- **Why:** Graph would need an Azure app registration (IT approval) and new network hosts, against Product
  Principles 1 and 3.
- **Consequences:**
  - No new hosts: the CSP is unchanged.
  - `src/storage/folder.ts` is the only code that calls the API.
  - **Pending Phase 10:** the API isn't yet proven on `file://` with OneDrive Files On-Demand. PROJECTS.md §9 Q4
    lists the fallbacks if it fails.

### T12 — Search is a scan over normalised turn text, not embeddings or an index
- **Decision:** the agent writes its own keyword queries (variants, synonyms, other languages) and a pure function
  scans every turn of every session. An inverted index is built only if the 300-hour perf test misses 200 ms per
  query.
- **Why:** nothing to rebuild or re-embed while fieldwork goes on. The corpus is ~30 MB of text in memory.
- **Consequence:** the session text is cached in IndexedDB per file, keyed by name, `lastModified` and size, so a
  computer reads each transcript once.
- **Words** (maintainer, Phase 12, 2026-10-19): a word is a run of letters and digits, so apostrophes and hyphens
  separate words. "doctor" finds "doctor's" and "appareil" finds "l'appareil". A typed `don't` or `e-mail` is
  searched as a phrase, so it still matches, and "don" also finds "don't". The quote check uses the same words.
- **Measured** (Phase 12): a scan over every turn takes 33–65 ms per query on a generated 300-hour corpus in Node,
  so there is no index.

### T13 — Quotes are pointers that the app checks
- **Decision:** the agent cites a quote as `<quote ref="s12/t412">…</quote>`, and summaries store quotes with their
  turn id. Describe checks the words against that turn (normalised, split at `…`).
  - A quote that is found is shown, and copied, with the transcript's own text.
  - A quote that isn't found is marked and can't be copied. In summaries, such quotes are dropped and counted.
- **Why:** research integrity. An invented or altered quote must never look verified.

### T14 — Phase 10: the project folder works on `file://` (go)
- **Decision** (2026-10-15): Phases 14–15 go ahead on the File System Access API (T11).
  - Edge 155 and Chrome 155 pick, read and write a OneDrive folder from `file://`, and keep its handle.
  - The facts and the rules for Phase 14 are in
    [reference/file-system-access.md](reference/file-system-access.md).
- **Consequences:**
  - Access ends with each browser session, and `file://` never offers "Allow on every visit". **Reconnect** is one
    click per session (PROJECTS.md §5.2).
  - OneDrive's conflict copies put the device name before `.json` (`….summary-LAPTOP-123.json`). This replaces the
    pattern PROJECTS.md first assumed.
  - OPFS isn't available on `file://`, so the e2e harness uses an in-memory folder.
  - **Still open:** a run on a Demant-managed laptop, where a company policy could block folder access.

### D24 — Every page is 80rem wide
- **Superseded by D31** (2026-10-28): only the Transcribe steps keep the 80rem column.
- **Decision** (maintainer, Phase 14, 2026-10-20): `--content-width` is 80rem on every page. It was 60rem.
- **Why:** Project mode needs room for its two panes. With one width for every page, the top row stays in the same
  place when the mode changes, as the maintainer chose in Phase 11. The alternatives were 80rem for Project mode only,
  where "Home" jumped about 160 px at 1280 px, or two panes squeezed into 60rem.
- **Consequences:**
  - Home's tiles and the Transcribe steps are wider in large windows.
  - On Output, a long turn can run to about 140 characters a line at full width. If that reads badly, cap the text
    column, not the page.

### D25 — The last transcript remembers its project file
- **Decision** (maintainer, Phase 15, 2026-10-20): when the transcript on Output is in a project, Describe keeps a
  link to its file beside the last transcript, under the new IndexedDB key `describe.v1.lastTranscriptLink`:
  `{ docId, projectId, projectName, fileName, stat }`, the stat being the file's when Describe last read or wrote it.
  Phase 15's file had planned only to relink the transcript by its id once the project was open again.
- **Why:** on `file://` access to the folder ends with every browser session (T14). Without the link, a project
  transcript looked unlinked after a restart (**Add to project** showed), and changes made before **Reconnect**
  came back as a conflict with the folder, although they were the user's own.
- **Consequences:**
  - Output shows "In <project>" at once after a reload. A change waits for **Reconnect**, then saves with the change
    check against the remembered stat, so only a colleague's change stops it.
  - The link is dropped by a new transcript, by **Clear saved data**, and when its file is gone from the folder (someone
    deleted it), so **Add to project** is offered again. A file that is there but can't be read keeps it. A link to
    another transcript is ignored.
  - A new key with a default (no link), not a change of shape, so D18 doesn't apply.
  - Linking by id stays as the fallback when a transcript in the project has no link (the two are compared by
    `transcriptHash`).

### D26 — Project work: Claude or Gemini, in two steps
- **Status:** agreed with the maintainer on 2026-10-21. It amends A6 and A17 (PROJECTS.md §2), D22 and D23.
- **Decision:**
  - The project model can be a Claude or a Gemini model. The one select in Analyse mode lists both, grouped by
    provider. The model's id says which provider it is, so the saved preference (`projectModel`) keeps its shape.
    Sonnet 5.5 stays the default.
  - **Phase 19 (in 2.0):** the pipeline's translation and the summaries use the project model's provider and that
    provider's key.
  - **Phase 20 (after the chat, also in 2.0: maintainer, 2026-10-21):** a Gemini `AgentProvider`. Until then, the
    chat is offered only with a Claude model.
  - **The Gemini models** (PROJECTS.md §9 Q5, maintainer, 2026-10-21): Gemini 3.8 Flash and Gemini 4 Argon, a cheap
    one and a strong one, as Sonnet and Opus are for Claude.
- **Why:** a team with only a Google key, or with data rules that prefer Google, can still use Analyse mode. The
  pipeline and the summaries already go through `LlmProvider`, so the first step is small. The agent needs a
  second implementation, so it waits until the Claude agent has been proven.
- **Consequences:**
  - Summary files gain an optional `provider` field. If it's missing, the provider is Claude. Adding an optional
    field doesn't change the shape (D18), and older builds ignore it.
  - The pipeline's translation records the provider that made it.
  - The dialogs ask for the project provider's key, and the data-flow text names that provider.
  - The Gemini adapter streams, as Claude's does (T15). This also changes Gemini translation on Output.
  - Gemini has no server-side refusal fallback (T9), so a refusal ends that summary as `refused`.
  - New live checks: G1–G3 in Phase 19, and the agent checks A1–A4 with Gemini in Phase 20.

### D27 — One Settings page for keys, saved data and About (2026-10-22)
- **Decision:** a **Settings** page, opened from the only link in the footer, from any mode. It holds the three API
  keys and "Remember keys on this computer" (moved from Setup), **Forget all keys** and **Clear saved data**, and
  the About text (with where to create each key, moved from the ElevenLabs field's help on 2026-10-22), the
  privacy and terms links and the version (moved from the About dialog, which is gone). **Back**
  returns to the mode it was opened from, and Transcribe to its step. While the ElevenLabs key is missing, Setup
  shows only an **Open Settings** button where the keys used to be. The Translate, Summarise, Add to project and
  chat dialogs still ask for a missing key in place.
- **Why:** Analyse users never see Setup, so keys there were hard to find, and keys and app-wide data were split
  between Setup and a dialog. Asking in place keeps a dialog's work when only its key is missing.
- **Consequence:** messages about a rejected key say "Check it in Settings". The About section on Settings is the
  data-flow text that AGENTS.md rule 2 refers to.

### D28 — Browser Back and Forward (2026-10-22)
- **Decision:** each page change pushes a browser history entry with `history.pushState(state, '')`: state only, no
  URL. A page is Home, a Transcribe step, Project (with the session whose summary is shown, if any) or Settings.
  Back and Forward show the entry's page through the nav store; a page that can't be shown now falls back (Output
  with nothing in it → Setup; a session that's gone → the chat). All of it is in
  `src/ui/composables/useBrowserHistory.ts`. Dialogs and Edit text are not pages.
- **Why:** colleagues reach for Back (button, mouse, swipe) and today it leaves the app. State-only entries work on
  `file://` and keep D1: still no router and no URL concerns.
- **Consequence:** a reload still opens on Home (PROJECTS.md A13); the first entry is replaced with Home on load.
  In-app Back buttons are ordinary page changes, so they push an entry too.

### T15 — Gemini requests for project work (agreed 2026-10-21; built in Phase 19)
- **Streaming:** `generateStructured` uses `ai.models.generateContentStream` and builds the reply from its chunks.
  The finish reason, the prompt feedback and the usage are read from the stream, and parsing stays as it is.
- **Thinking:** set explicitly with `thinkingConfig.thinkingLevel` (`GEMINI_THINKING` in
  `providers/llm/models.ts`), as `CLAUDE_EFFORT` is for Claude. Phase 19 picks the level from Google's
  documentation for the project's Gemini model. It also checks whether thinking counts against
  `maxOutputTokens`, and sizes the summary's limit to match.
- **Schema:** `toGeminiSchema` stays. A unit test pins that the summary schema (with its one nullable field)
  converts without any keyword Gemini doesn't support. Live check G1 confirms that Gemini accepts it.
- **429:** if Google's error details can tell a spent quota apart from a rate limit, a spent quota maps to `quota`.
  If they can't, **Summarise all** also stops on Gemini's `rate_limit`, so a spent quota doesn't fail every session
  in turn.

### D29 — Chats are kept in the project folder (2026-10-27; built in Phase 21)
- **Decision:** every chat with the project agent is saved as JSON in the project folder's `chats/`, one file per
  chat (`chats/<YYYY-MM-DD-HHmm>--<id8>.chat.json`, from when it started, in UTC). The file is written again after each
  answer that ends (`done`, `limit` or `stopped`); a failed answer isn't saved. Analyse's sidebar has two tabs,
  **Sessions** and **Chats**; the Chats tab lists every chat in the folder, yours and colleagues', the last one added
  to first, and selecting one opens it. The chat pane still opens on a new chat.
  - **One writer per file.** Each browser has a chat identity: an id (not a person) and a made-up name ("Amber
    Heron"), under `describe.v1.chatAuthor`. **Your name** (Settings → Chats, optional) replaces the made-up name.
    A chat whose author id is yours is continued in place, with the change check; a colleague's chat can be read,
    and asking in it saves a copy of your own (`forkedFrom`). A save that finds the file changed also saves a copy.
  - **Resuming.** A file keeps each answer's text with its quote tags, and the session keys the chat used
    (`sessionKeys`). Opening a chat parses its answers again against the current sessions, so quotes are checked
    again. Its next question sends the earlier questions and finished answers back as plain text (`AgentProvider
    .resume`), with the stored keys kept and new sessions numbered after them. The model is the project model at
    that question, so a reopened chat can change model.
- **Why:** researchers want to come back to a conversation, and a team in one OneDrive folder wants to see each
  other's questions. One file per chat, written only by its author's browser, avoids the shared-file conflicts that
  D22 avoided by not keeping chats at all. The provider's own conversation (thinking blocks, signatures, tool results)
  can't leave its provider (AGENTS.md rule 5), so a resumed chat starts from the text.
- **Consequences:**
  - Changes A9 and D22's "Chats are not kept". Everyone who can open the project folder can read its chats; the
    About text says so.
  - A resumed chat doesn't remember what the agent read; it searches again if it needs to.
  - **Clear saved data** forgets this browser's chat identity, so your earlier chats then read as a colleague's.
  - Not in this decision: deleting or renaming chats, searching them, and a chat updating while a colleague adds to
    it (opening it again shows the latest).

### D30 — Keyword search lives in the chat pane (2026-10-28)
- **Decision:** the researchers' keyword search (A16) moves from the top of the Sessions tab into the chat pane. A
  small **Chat | Search** toggle under the question box switches the pane: in Search the box searches the transcripts
  and the results (grouped by session, with **Copy**) fill the place of the conversation. Both modes stay mounted, so
  a search and the chat survive switching, and opening a summary. Opening a saved chat switches back to Chat. The
  sidebar keeps the **Sessions** and **Chats** lists only.
- **Why:** both ways of asking the project something, by keyword or in a chat, start from the same box, and the
  results get the wide pane instead of the narrow sidebar. The sessions list no longer disappears behind a query.
- **Consequences:** the Sessions tab has no search box; the chat's notices show only in Chat mode. *(Later: **New chat** is at the
  top of the Chats tab, and switches back to Chat mode.)*
  `npm run test:perf` no longer times the sessions list after clearing a search, since clearing it doesn't re-render
  the list.

### D31 — Full-width pages, except Transcribe (2026-10-28)
- **Decision** (maintainer): the top row, Home, Settings and Analyse use the window's width, with a gutter of 1rem
  (`--page-gutter`, 1.5rem above 48rem). The Transcribe steps keep D24's centred 80rem column. In Analyse the sidebar
  sits at the left edge, and the summary or chat keeps the 59rem it had in the 80rem page, centred in the space beside
  the sidebar; its scrollbar stays at the page's edge.
- **Why:** a wide screen left the top row and Analyse's panes in the middle with empty margins. The detail pane keeps
  its width so the chat and summaries don't stretch into long lines.
- **Consequences:** the top row still stays put between modes (now at the left gutter on every page), but on
  Transcribe it starts at the gutter while the step's content is centred.

### D32 — The top row names the current page, and unfolds to the path (2026-10-29)
- **Decision** (maintainer): the top row shows only the current page's name (a Transcribe step, the project, Settings,
  or Home). While the pointer is over the row (not over Analyse's **Brief**, **Change** and model controls), or the
  keyboard is in it, the whole path unfolds one place at a time from the left; it folds back from the right when the
  pointer leaves. A page change while it's closed swaps the name: the old one folds away as the new one slides in.
  Opening Transcribe or Analyse from Home doesn't: the page's name is simply there, where it rests (maintainer,
  2026-10-29). Without a hovering pointer (touch), the whole path shows as before. With reduced motion it opens and closes at once.
- **Why:** the path is only needed to go somewhere; the rest of the time the row just names the page.
- **Consequences:** the current name glides right as the places before it unfold, an exception to keeping text in
  place while something opens: the row is left-aligned, so it can't stay put. Each place is a `.slot` whose width moves
  between 0 and `max-content` (`interpolate-size`; Chromium doesn't interpolate a flex item's `auto`). E2E specs click
  a page in the row with `clickInHeader(page, name)`. Open, the row is unchanged to the pixel.

### D33 — A long chat can be compacted with `/compact` (2026-10-30; built in Phase 22)
- **Decision** (maintainer): `/compact` in the question box, with optional text after it saying what to keep, has the
  agent summarise the chat so far. From then on the chat carries on from that summary alone. The long-chat notice
  recommends it. The earlier messages stay on screen above a divider, with the summary behind a `<details>`.
  - **How:** one ordinary request on the conversation, with the same instructions, context, tools, effort and
    `tool_choice`, so its whole prefix comes from the cache. It ends with the compaction prompt, and its tools run on a
    spent budget. The next question goes out as a new conversation made with `AgentProvider.resume`: a fixed
    question, the summary as the answer, then the new question. This is the `claude-api` skill's "simple compaction".
  - **Not server-side:** Claude's compaction betas (`compact-2026-01-12`, on demand `compact-2026-09-04`) aren't typed
    by `@anthropic-ai/sdk` 0.133, Gemini has nothing like them, and a reopened chat resumes from text (D29) anyway.
  - **Saved chats** gain a third message kind, `role: 'compaction'` (the summary, its focus text, cost and model).
    `CHAT_SCHEMA_VERSION` stays 1, since no release has written a chat file yet. A reopened chat resumes from its
    latest summary and the questions and answers after it.
    *1.1.0 shipped chat files with this kind (D40), so a further change to them needs D18.*
- **Why:** past 600k tokens, starting a new chat lost everything the agent had worked out. A summary keeps the
  conclusions, the evidence and what was searched, at a small fraction of the size.
- **Consequences:**
  - The agent remembers only what the summary says. Its quotes are checked again when shown, as in any answer.
  - The summary request costs about as much as reading the chat from the cache once. The next question writes a
    new, small cache.
  - Not in this decision: compacting automatically, keeping the latest turns as they were, a **Compact** button.

### D35 — A Windows desktop app from the Microsoft Store, beside the HTML file (2026-10-31; from Phase 24)
- **Decision** (maintainer): Describe also ships as a Windows desktop app, free in the Microsoft Store, built with
  Tauri 2 from the same source. The single-file HTML build stays, as a separate build.
  - **Tauri:** on Windows it draws with WebView2, the Edge engine Describe already targets, so the Vue app runs
    unchanged. The app is small, and the Rust side is mostly configuration.
  - **MSIX through Microsoft's `winapp` CLI**, not Tauri's MSI or NSIS installers. The Store signs, hosts and updates
    MSIX itself. Its route for MSI and EXE installers needs a paid code-signing certificate, an installer we host, an
    updater in the app and the offline WebView2 installer (over 100 MB).
  - **First on a listing that only a direct link reaches** (Phase 24), to prove the pipeline on a work laptop before
    anything else changes.
  - **The name is DeScribe,** reserved in Partner Center on 2026-10-31. Both builds use it wherever users see it.
    Storage keys, database names and project file names keep `describe`, so saved data and existing project folders
    still work. The app identifier is `io.github.danielbird.describe`.
  - **Not chosen:**
    - Electron ships a second copy of Chromium, about 100 MB, for what WebView2 already provides.
    - A PWA needs hosting, and it runs inside Edge, so Edge's policies still apply.
    - .NET with WebView2 is the same web view, written in C#.
- **Why:** colleagues install Describe from the Store, and the Store keeps it up to date, instead of each new version
  being downloaded from SharePoint. Folder access may also escape Edge's folder-write block (Phase 23); Phase 24 checks.
- **Checked on a Demant work laptop (2026-10-31):**
  - Store installs from other publishers work.
  - It is x64 (AMD Ryzen 5 PRO 215).
  - Controlled folder access is off.
  - WebView2 156.0.4314.50 is installed.
  - The HTML build transcribes.

  All three APIs also accept the desktop app's origin, `http://tauri.localhost`.
- **Consequences:**
  - Two builds. Hard rule 1 (one file) applies to the HTML build. The desktop build has its own CSP, in
    `tauri.conf.json`, with the same three hosts.
  - The desktop app's saved data is its own: keys, glossary and settings don't carry over from the HTML file.
  - Desktop builds need Rust, the MSVC build tools and the `winapp` CLI. The app is x64 only at first.
  - The Store listing needs a public privacy policy.

### T16 — The desktop app opens links in the default browser, from Rust (2026-10-31; Phase 24)
- **Decision:** `src-tauri/src/lib.rs` builds the window from its config (`create` is false in `tauri.conf.json`)
  with an `on_new_window` handler. It refuses every new window and opens `http` and `https` URLs with
  `tauri_plugin_opener::open_url`. The crate is only a Rust dependency: the plugin isn't registered.
- **Why:** in the installed 1.0.0 the links in Settings (`target="_blank"`) opened nothing (W8). Registering the
  plugin would inject a link-click script whose IPC calls the empty capability refuses; calling its function from Rust
  needs neither.
- **Consequence:** a second window would need the same handler. A link without `target="_blank"` would still navigate
  the app's window away; the app has none.

### T17 — The installed desktop app keeps its data in its package folder (2026-10-31; Phase 24)
- **Decision:** when the app has package identity (installed as MSIX), `src-tauri/src/lib.rs` sets the window's
  `data_directory` to `ApplicationData.Current.LocalFolder`, `%LOCALAPPDATA%\Packages\<family name>\LocalState`
  (the `windows` crate, the version Tauri already uses). Without identity (`tauri dev`, the bare exe) Tauri's default
  stays, `%LOCALAPPDATA%\io.github.danielbird.describe`.
- **Why:** WebView2's processes run outside the package, so Windows doesn't redirect their writes. Installed 1.0.0
  kept its profile in the unpackaged folder: uninstalling would have left the saved data behind, remembered keys
  included (W15), and on a developer's PC the installed app and `tauri dev` shared it. Settled before the first Store
  release, so no colleague's data has to move.
- **Consequence:** the installed app and `tauri dev` no longer share saved data. On the maintainer's PC, the first
  build with this starts empty.

### T18 — The desktop app grants folder access itself (2026-10-31; Phase 24)
- **Decision:** the window's `on_permission_request` (Tauri 2.12) answers `PermissionKind::FileSystemAccess`
  (WebView2's `FILE_READ_WRITE`) with **Allow**. Every other permission keeps WebView2's default.
- **Why:** after the folder picker, WebView2 asked twice, in prompts that name the page's address ("http://tauri.localhost
  will be able to edit files in …"), and again on each **Reconnect** (W10). Their wording can't be set. The user has
  already chosen the folder in Windows' own picker, which is the consent a desktop app asks for.
- **Consequences:** access still covers only folders the user picks, and the page is DeScribe's own bundled code
  (the CSP allows no outside scripts). The HTML build is unchanged: Edge and Chrome still ask.

### D36 — MIT licence, and Settings lists the software DeScribe includes (2026-11-01)
- **Decision:** the source is under the MIT License (`LICENSE`). Settings → About has a **Licences** disclosure that
  shows it, then `THIRD-PARTY-NOTICES.txt` (the npm packages in the bundle) and, in the desktop app only,
  `THIRD-PARTY-NOTICES-DESKTOP.txt` (the Rust crates and Microsoft's WebView2 loader, which `webview2-com-sys` links
  statically). `npm run notices` (`scripts/make-notices.mjs`) generates both: the npm list from the production
  build's module graph, the Rust list from `cargo metadata` for `x86_64-pc-windows-msvc`, without build-only crates
  and proc macros.
- **Why:** DeScribe is offered free from the Microsoft Store as open source. The licences of the code it bundles (MIT,
  Apache-2.0, BSD, ISC, OFL for the font) ask for their notices to go with every copy, and the HTML file and the MSIX
  are copies: a page on GitHub is in neither. Reading the build, not `package.json`, lists exactly what ships,
  including the DM Sans font (a dev dependency) and the libraries `docx` inlines.
- **Consequences:** run `npm run notices` after any dependency change; `release` and `desktop:pack` fail while the
  files are out of date. A package whose own files contain other software (`docx`, `webview2-com-sys`) is listed in
  the script's PREBUNDLED tables with the version that was checked, and a new version stops the script until its
  contents are checked again. Licence texts that a package doesn't ship, or ships too much of (Vite's lists Vite's own
  dependencies; JSZip's adds the GPL it is also offered under), are kept in `scripts/notices/`. Of "MIT OR …", only
  the MIT text is shown. The web build leaves out the desktop notices (`__DESKTOP__`).

### D37 — Recordings in more languages: ElevenLabs' most accurate tier on Setup (2026-11-01; Phase 26)
- **Decision:** Setup's **Language** list is Auto-detect and the 36 languages ElevenLabs rates "Excellent" (a word
  error rate of 5% or less, `providers/transcription/elevenlabs/languages.ts`), A–Z by English name. Any other
  language still works through Auto-detect. Codes are kept in one form (`normalizeLanguage()`, `Intl.Locale`: ISO
  639-1 where there is one) and named in English by `Intl.DisplayNames`, so every language ElevenLabs returns is
  named properly in the header, the export, the session list and the prompts. The request sends ElevenLabs' own
  ISO 639-3 code. Translation stays English-only (D7, PROJECTS.md A4).
- **Why:** the maintainer asked for languages other than English, German and French (2026-11-01), and chose the most
  accurate tier so that what Setup offers transcribes well. The translation step already accepted any language;
  only the names, the list and search were missing.
- **Consequences:**
  - `languageHint` in prefs and in `TranscriptDoc` is any string. By D18 that's a widening: newer releases read
    everything older ones wrote. An **older** release ignores a last transcript, and reports a project transcript as
    unreadable, when its hint is one of the new languages. Auto-detected transcripts and English/German/French ones
    are unaffected. Landing this before the 2.0 release (Phase 18) keeps project folders out of it.
    *It shipped in 1.1.0, the first release with projects (D40), so no release reads project folders with the
    narrower hint.*
  - A saved hint the provider doesn't offer falls back to Auto-detect.
  - Right-to-left display and export (Arabic, Hebrew, Persian, Urdu) are not handled: `future.md` F4.

### T19 — Words in scripts without spaces come from `Intl.Segmenter`; accents are not vowel signs (2026-11-01; Phase 26)
- **Decision:**
  - In `domain/corpus/normalize.ts`, a run of letters containing Han, Hiragana, Katakana, Thai, Lao, Khmer or Myanmar
    is split into words by `Intl.Segmenter` (`'und'`, `granularity: 'word'`). Each word keeps its own offsets.
  - Matching removes only accents: the combining marks shared by every script (Latin, Greek and Cyrillic accents,
    Arabic vowel points, Japanese voicing marks) and Hebrew points. Until now it removed every mark, which also
    deleted the vowel signs of Thai and Indic scripts (Kannada and Malayalam are on the list), so many different words
    became one.
  - The agent's `estimateTokens()` counts each Han, Hiragana, Katakana and Hangul character as a token, the rest at
    3.5 characters a token.
- **Why:** T12's search is a scan over words. Without a word boundary, a whole Chinese, Japanese or Thai sentence was
  one word that no single-word query could find. Search, queries, snippets and the quote check share one walker, so
  they still agree. Chinese, Japanese and Korean text runs about a token per character, so the agent's budget
  (`transcriptTokensPerQuestion`) undercounted an untranslated session of theirs about 3.5×.
- **Consequences:** the en/de/fr benchmark is unchanged (the ASCII fast paths are untouched). Dictionary segmentation
  depends on the browser's ICU, so a word boundary can differ slightly between Chromium versions; queries and text are
  segmented the same way in one browser.

### D38 — Readers keep the fields they don't know (2026-11-03; audit DES-1)
- **Decision:** data that DeScribe reads and writes back keeps every field this build doesn't know, at every level.
  Its zod schemas are `z.looseObject`, and its writers start from the object that was read:
  - the project file and its brief (`saveBrief` spreads both);
  - the transcript doc, in the project folder and in IndexedDB (Output's edits spread);
  - chat files, their author and their messages (a saved message is written back exactly as it was read).
- **Why:** colleagues on different builds share one project folder: the HTML file is downloaded by hand, and the Store
  app updates itself. Plain `z.object` strips unknown keys, so the first older build to edit the brief, a transcript
  or a chat deleted every field a newer build had added, for everyone. D18 promises that an older release may open
  data a newer one wrote, and D26 that older builds ignore a new optional field; both need this.
- **Consequences:**
  - A new optional field isn't a shape change (D18), and builds from this one on keep it.
  - 1.0.0 and 1.1.0 still strip unknown fields. While colleagues may run them, a field whose loss would matter needs
    a `schemaVersion` bump instead, which those builds refuse to read or write.
  - Still shape changes, because older builds report the file as unreadable: a new enum value, a new chat message
    `role`, a field that becomes required.
  - Not covered, because they are replaced rather than rewritten:
    - summary files: an older build that regenerates one writes it without the newer fields;
    - the transcript file's wrapper (`kind`, `schemaVersion`, `savedAt`, `doc`), made anew on every save, so new
      fields go in `doc`;
    - a copy of a colleague's chat, a new file that keeps its messages' fields but not the file's own;
    - the corpus cache and the transcript link, which are rebuilt from the files.

### D39 — English that is out of date is marked, and only its turns are translated again (2026-11-03; audit DES-2)
- **Decision:** a translation records what it was made from: `Translation.sourceHashes`, the hash of each turn's text
  when it was translated (`domain/translation.ts`). A turn whose text has changed since has **out-of-date** English.
  - Project features treat it as untranslated: search's English, summaries, the agent and the quote checks never use
    it (`SessionTurn.en` is `null`). A session with such turns needs translating, so **Summarise**, **Regenerate** and
    **Add to project** translate first, sending only the batches that hold a changed turn.
  - On Output, the English view marks each changed turn, **Translate** becomes **Update English…**, which translates
    only those turns, and the export dialog says how many turns of the English are out of date. The export itself
    still writes the stored English.
  - The translation's `provider` and `model` name the last run.
- **Why:** D19 accepted stale English when it was only a view and an export. In release 2 the English is the research
  object: summaries are written from it, and the agent reads and quotes it. After a German transcript was corrected,
  **Regenerate** summarised the uncorrected English, and nothing said so.
- **Consequences:**
  - A new optional field (D18, D38). A translation without it, made before this change, counts as current, as it did
    before. The first edit with this build records the turns as they were before it, so that edit and later ones
    are noticed.
  - 1.0.0 and 1.1.0 drop the field when they save a transcript (D38). Its translation then counts as current until
    the next edit with a newer build: no worse than before, so no `schemaVersion` bump.
  - The corpus cache isn't cleared. Its entries were made from files without the field, which read the same as before.
    The one gap is a file this build wrote that an older build on the same computer cached first: until the file
    next changes, that computer counts its English as current, and Output may ask to **Reload** or **Keep mine**.
  - `transcriptHash` covers only English that is current, so a summary made from stale English is out of date, and
    the hash of a transcript with no changed turns stays as it was.
  - D19's bullet on translations is replaced.

### D40 — Release 2 is in 1.1.0; the next release is the first colleagues get with projects (2026-11-03; audit DOC-1)
- **Decision** (maintainer): 1.1.0 (2026-11-01) holds release 2, Phases 10–22, with Edit text (Phase 9), the desktop
  app (24) and more languages (26). It counts as released: its version and CHANGELOG entry stay as they are, and its
  source is on GitHub. It hasn't been given to colleagues: no HTML file on SharePoint, no Store upload.
  - Phase 18 hardens release 2. Its release takes the next version by RELEASING.md's rules (1.2.0 unless it drops
    support for something), so 2.0.0 is no longer kept for it. "Release 2" stays the name of the Projects work.
  - That release is the first that colleagues get with projects.
- **Why:** from Phase 11 on, `main` held release-2 work that was to wait for Phase 18 (Phase 10), and 1.1.0 was cut
  from it first. Its commit didn't pass the e2e gate (audit BUG-1), and it lacks the audit's fixes, D38 and D39 among
  them. Several decisions relied on no release having written a project file.
- **Consequences:**
  - "No release has written it yet" no longer excuses a shape change. 1.1.0 writes every project file:
    `describe-project.json`, `sessions/*.transcript.json` and `*.summary.json`, and `chats/*.chat.json`. D18 covers
    them as it covers browser storage, with each file's `schemaVersion` in place of a namespace: a new optional field
    (D38), or a `schemaVersion` bump with a reader for the old shape in `src/storage/`.
  - D21, D33 and D37 changed shapes before or in 1.1.0, so each held when it was made. Each now points here.
  - Phase 18 starts with robustness and the live checks. Its CHANGELOG entry covers what 1.1.0 added too, since
    colleagues never had 1.1.0.
  - D38 and D39 still name 1.1.0: anyone can build it from GitHub.
  - Not covered: Phase 24's Store listing that only a direct link reaches. Only the maintainer uses it, and any build
    can go there.

### D41 — Errors keep their technical details behind Technical details (2026-11-03; audit DES-3)
- **Decision:** under each provider error the app shows, a closed **Technical details** (`ErrorDetails.vue`) holds
  what a report needs: the build (`DeScribe v…`), the error's kind and HTTP status, and its `detail`, such as the
  service's own reason, an ElevenLabs request id or a Claude refusal category (`technicalDetails` in
  `providers/errors.ts`).
  - It is shown under transcription, translation, pipeline (Output, a summary, the queue's stop) and chat errors,
    and only when the error has a status or a detail.
  - It sits outside the error's alert, so screen readers hear only the message. The text selects in one click.
  - Every saved key is redacted from it as well. Providers already redact the key they used, but stores wrap
    unexpected errors with their raw message, which was never shown before.
- **Why:** providers filled `detail` carefully and nothing read it. A colleague's "Claude declined to process this
  text" arrived with no category, reason or request id, and with Phase 18's live checks open, field reports are the
  main evidence. D13 allows detail behind a `<details>`.
- **Consequences:**
  - Not covered: key tests in Settings (providers return only a message), folder errors (they have no detail), and
    Claude's request id, which `claude.ts` doesn't record yet.
  - `detail` is now user-visible text. It stays technical and short, and never holds a key (AGENTS.md rule 3).

### D42 — A turn that comes back empty twice keeps its original text (2026-11-03; audit BUG-8)
- **Decision:** when a translation batch's reply leaves turns empty, the batch is retried once, as before. If the
  retry still leaves turns empty, and nothing else is wrong with it, those turns keep their original text as their
  English (`checkReply`'s `keepOriginal` in `features/translation/translate.ts`).
  - It applies to at most a third of the batch's turns, and always to one, so a batch of one turn can't get stuck.
    A reply that leaves more empty still fails, as does one with a missing, extra or duplicate id.
  - Nothing records which turns were kept (maintainer). The English view shows their original text.
- **Why:** a turn the model keeps returning empty, such as one that is only "(lacht)" or a name, stopped the run,
  and **Resume** sent the same batch again. A session in another language could then never be translated, so its
  **Add to project**, **Summarise** and **Regenerate** couldn't finish either.
- **Consequences:**
  - No new field, so no D18 or D40 question.
  - The kept text counts as current English (D39) until the turn is edited. **Update English…** doesn't offer it,
    and an edit makes it out of date, so it is sent again.
  - The English view, the export, search, summaries, the agent and the quote checks see the original text as that
    turn's English, as they do for a turn the model returns unchanged.
  - A third matches the summaries' retry threshold.

### D43 — The project rescans every two minutes while it is visible; no refresh button (2026-11-07; Phase 27)
- **Decision:** besides the rescans on focus, on becoming visible and on entering Project mode, the project store
  rescans the folder every two minutes while a project is open and the window is visible (`RESCAN_INTERVAL_MS` in
  `stores/project.ts`). There is no refresh button.
  - Keyword search no longer runs again under the reader. When a rescan changes the sessions, the results stay and
    **Update results** takes **More**'s place; a search that found nothing runs again at once.
- **Why:** a window that stays in front, such as the desktop app kept maximised, never gets focus again, so a
  colleague's work never appeared. A button wouldn't help: nothing tells the user when OneDrive has delivered a file,
  so a click before then would seem to do nothing. A rescan that finds nothing costs one listing with the files'
  sizes and dates (about 70 ms for 300 files, reference/file-system-access.md F7) and changes nothing on screen.
- **Consequences:**
  - A colleague's session appears within two minutes of OneDrive delivering it, or at once on focus.
  - **More** can't page across a rescan: results are ordered by hit count, so the old offset would repeat or skip
    sessions in the new ones.
  - `FileSystemObserver` (Chromium 133+) could add a rescan on each change later. It is unproven on `file://` and with
    OneDrive's cloud-only files, so it would need a Phase 10-style check first.
