# Phase 39 — Edit a summary by hand

**Goal:** a researcher can correct a session's summary in Project mode, by hand. **Edit** turns the summary into a
document they type in, as in Word: it looks the same as when it's read, the caret goes where they click, and the arrow
keys and Enter move through it as through one page. There are no form fields. Edits are autosaved to the summary file,
with the change check the transcript already has. **Regenerate** still makes a new summary and replaces the edits.
Editing a summary with AI, and renaming or merging a theme across the project, are later work. Both builds get it.

**Status of the plan:** planned on 2026-11-22 from the maintainer's answers (DECISIONS.md **D60**, below). All UI text
here is a draft (D13).

**Depends on:** Phase 15 (summaries and the summary view), Phase 14 (the project folder and its change check), Phase
21 (the chat's notice of new sessions). Nothing in Phases 33–38.

**Read first:**
- DECISIONS.md D13, D18, **D21**, D38, T4, T13, D44, D57, and **D60** (below); PROJECTS.md A5, **A11**, §5.2, §5.3,
  §5.5 (the read-only tools) and §5.6;
- [Phase 9](09-edit-text.md), its Handoff included: the per-turn draft, Enter and Escape, the debounced save, the paste
  handler that keeps Ctrl+Z;
- `src/domain/summary.ts`, `src/features/summary/check.ts` and `themes.ts`, `src/domain/corpus/quoteCheck.ts`;
- `src/storage/projectFiles.ts` (`writeTranscriptFile`'s `expected`, `writeSummaryFile`, the summary schema),
  `src/storage/schemas.ts` (`z.looseObject`, D38);
- `src/stores/project.ts` (`saveSessionSummary`, `saveSessionTranscript`, `groupSessions` and its `newestFirst`, the
  rescans), `src/stores/transcript.ts` (the folder conflict, **Reload** / **Keep mine**), `src/stores/chat.ts`
  (`newSessionCount`, `takeSnapshot`), `src/stores/unloadGuard.ts`;
- `src/ui/components/SessionSummary.vue`, `QuoteCard.vue`, `FolderNotice.vue`, `src/ui/views/ProjectView.vue`
  (`onDetailKeydown`);
- `tests/e2e/project.e2e.ts`, `tests/e2e/projectFolder.ts`, `tests/e2e/edit.e2e.ts`.

## What the maintainer decided (2026-11-22)

1. **Hand edits only.** No AI edits for now: no prompt box under the summary, no `@` in the chat, no new agent tool.
   The project agent's tools stay read-only (§5.5).
2. **Why people edit:** to correct the AI's mistakes, and to reshape themes. Redoing one part with AI is the AI
   editing that comes later.
3. **Like editing a Word file, not a form.** The summary is edited in place, in the same layout and type as when it's
   read, without input boxes around each field.
4. **What can change:** the text (title, synopsis, overview, findings, respondents' details, theme names and
   descriptions), and the structure: add and remove themes and quotes.
5. **A researcher's own text is trusted.** It doesn't go through `checkSummary`. Quotes are still checked when they're
   shown, as now: one that isn't found in its turn is marked and can't be copied (T13).
6. **Autosave as you type**, as the transcript does. No **Save** button.
7. **The change check, as for transcripts.** Before each save, DeScribe checks that the file hasn't changed since it
   was read. If a colleague's save got there first, autosave stops and the user picks **Reload** or **Keep mine**.
8. **Regenerate replaces the edits, without a warning.** Edits are fixes to this version of the summary.
9. **Nothing extra in the file.** No "edited by", no edit date, no earlier versions. The file's shape doesn't change.
10. **Theme rename and merge across every summary,** without AI, is a separate phase (future.md).

## Decided in this file (the maintainer can change them)

### The editing surface

1. **An Edit / Done toggle, not always-on editing.** **Edit** sits in the summary's header next to **Open
   transcript**, and reads **Done** while editing. This is the same toggle as Phase 9's **Edit text**. It keeps a
   stray click from changing a file the team shares, and it keeps the quote cards' **Copy** and **Open** where they are
   when reading. The state is local to the view: selecting another session, Escape out of the summary, or leaving
   Project mode ends editing (after the save is flushed).
2. **The text is edited where it stands.** In edit mode, each piece of text the user can change becomes
   `contenteditable="plaintext-only"` on **the element that already shows it**: the `<h2>` title, the synopsis `<p>`,
   each overview `<p>`, the finding `<p>`, the respondent's `<h4>` and their `<dt>`/`<dd>` pairs, the theme's `<dt>`
   and `<dd>`. Nothing changes size or moves when **Edit** is pressed, and headings stay headings for a screen reader.
   - The only visual change is a faint tint under the block that has the caret, and a caret. There are no borders.
     The focus ring follows D13's tokens, so keyboard users can see which block they're in.
   - Why not textareas (as in Phase 9): a textarea can't be a heading or a list item, and each one looks like a box.
     Why not one `contenteditable` for the whole summary: the summary is structured data (every quote belongs to a
     turn, every finding to a brief question), and mapping a free document back to it would need an editor library,
     which is a new runtime dependency. One block per field, made to behave as one page (below), gets the feel without
     either.
   - `plaintext-only` keeps formatting and HTML out: paste is plain text, and Ctrl+B does nothing. **Never render the
     edited text with `v-html`** (§5.5). Text goes in with `textContent` and is read back with `textContent`.
   - Each block has `role="textbox"`, an accessible name ("Title", "Overview, paragraph 2", "Finding: <question,
     shortened>", "Theme name", "Description of <theme>", "<field> of <label>"), and `aria-multiline` where Enter
     makes a new paragraph. This is the one place where AGENTS.md rule 9's "real `<input>`" is met by a `textbox` role
     instead: record it in D60.
   - `spellcheck` is on and the summary's `lang` is `en` (A4).
3. **Vue doesn't re-render a block while it has focus.** The caret would jump. Render each block's text once when
   editing starts and when the block isn't focused; while it is, the DOM is the truth, and `input` sends its
   `textContent` to the store. (A `v-once` per block, keyed on the edit generation, or setting `textContent` from a
   directive, works. Interpolating `{{ text }}` inside a contenteditable does not.)

### Moving through the document

4. **The arrow keys cross blocks**, as in one Word page:
   - **↑** on the first line of a block goes to the end of the block above, and **↓** on the last line goes to the
     start of the block below. **←** at the very start and **→** at the very end do the same. Compare the caret's rect
     (`Selection.getRangeAt(0).getClientRects()`) with the block's first and last line boxes to decide.
   - The order is the reading order: title, synopsis, overview paragraphs, respondents, findings, themes. The question
     text and the quote cards are skipped, because they aren't editable (5 and 9).
   - **Tab** and **Shift+Tab** keep their usual meaning (the next focusable thing), so the page stays keyboard
     reachable in the ordinary way too.
5. **Enter works like it does in Word, within what the summary's shape allows:**
   - **Overview:** each paragraph is a block. Enter splits the paragraph at the caret, and the caret goes to the start
     of the new one. **Backspace** at the start of a paragraph joins it to the one above, with the caret at the join;
     **Delete** at the end joins the next one. The file keeps paragraphs as now: one string, separated by a blank line.
   - **Theme description:** Enter at the very end adds a new, empty theme after this one, with the caret in its name.
     Enter anywhere else in a description, as in every other block, moves to the start of the next block. Text never
     contains a line break, except between overview paragraphs.
   - **Respondent's value:** Enter at the very end adds an empty detail row under it, with the caret in its field.
   - **Shift+Enter** is the same as Enter. Enter while `event.isComposing` is left alone.
6. **Removing things:**
   - **Backspace in an empty theme name, when its description is empty too,** removes the theme, and the caret goes to
     the end of the block above. The same goes for an empty detail row (field and value both empty). So nothing that
     has text in it is removed by the keyboard.
   - A theme also has a **Remove theme** button (an icon, named for screen readers) at its end, shown only in edit
     mode. It removes the theme with its quotes. There's no confirmation and no undo; Ctrl+Z inside a block is the
     browser's own and stays inside that block (as Phase 9).
   - **Respondents** can't be added or removed (that's not in the maintainer's answer 4); only their label and
     details change.
7. **Empty blocks when they're left** (blur, arrow out, Done):
   - an empty **title** gets back the text it had when it was focused (the sessions list needs a title);
   - an empty **finding** becomes "Not discussed in this session." (`NOT_DISCUSSED`), shown muted as now; its quotes
     stay;
   - an empty **theme name** with a description gets back its text; an empty **overview paragraph** disappears; an
     empty synopsis is allowed.
8. **Text is cleaned on the way into the store,** as `cleanTurnText` does: line breaks become spaces (they can only
   arrive by paste or drop), and each block is trimmed when it's left (not while typing, so the caret doesn't jump).
   A pasted multi-line text in an overview paragraph splits into paragraphs at its blank lines. Use
   `execCommand('insertText', …)` in the `paste` handler, as Phase 9 does, so Ctrl+Z still works.

### Quotes

9. **A quote's words aren't edited.** They're the transcript's words, checked against it (T13); changing one by hand
   would make it a misquote that looks verified. In edit mode a quote card:
   - shows a **Remove quote** button (icon, named) in place of **Copy** and **Open**;
   - is skipped by the arrow keys (4).
10. **Adding a quote:** in edit mode, under each finding and each theme, an **Add quote** link-button opens an empty
    quote block (styled as a quote card, editable) with the caret in it. The user pastes or types the respondent's
    words.
    - When the block is left, DeScribe looks for the words in the session's English text with `checkQuote`, turn by
      turn in order, and takes **the first turn where it's verified**. The quote is stored with that turn's id and the
      transcript's own words (`sourceText`), and its card shows the speaker and time, as every other card.
    - If no turn has it, the quote is still kept (decision 5), with `turnId: ''`, and its card is marked as not found,
      as a model quote that fails is today. The card says so in its existing words; nothing new is announced.
    - An empty quote block that's left is removed.
    - The entry's `turnIds` are not changed by adding or removing quotes.
    - A summary still has at most 3 quotes per entry (`SUMMARY_LIMITS.quotesPerEntry`): **Add quote** is hidden at 3
      (D13: hidden, not disabled).

### What stays as the model wrote it

11. **The research question's wording** is the brief's (D21's alignment) and isn't editable. The brief dialog
    changes it, and that makes the summary out of date.
12. **Turn ids, `speakerId`, `transcriptHash`, `briefHash`, `createdAt`, `model`, `provider` and `droppedQuotes`**
    don't change. So an edited summary keeps the status it had: up to date stays up to date, and out of date stays
    out of date. "Made with Sonnet 5.5 on 14 Nov 2026" stays as it is (answer 9).
13. **`isNew`:** a renamed or added theme gets `isNew: true` unless its `themeKey` is in the vocabulary of the
    project's *other* sessions, so the next summaries see the vocabulary as it now is (A3). The theme vocabulary and
    `list_themes` pick up renamed themes from the files, with no other change.
14. **No limits on hand-written length** (no 80-character title, no 4–10 themes). Those limits steer the model, and
    `check.ts` keeps applying them only to its output.

### Saving, conflicts, and other people's changes

15. **The store keeps a draft.** While editing, the summary on screen is a draft held in the store (a `shallowRef`,
    replaced immutably: T4), not the file as last read. A rescan that reads a newer file doesn't replace the draft
    under the caret; the next save's change check catches it (16).
16. **Autosave:** each change is saved after the same delay as the transcript (`SAVE_DELAY_MS`), and flushed on
    **Done**, on leaving the summary, and on `pagehide` (through `unloadGuard`). The file written is the file as read,
    with `summary` replaced, and every other field (and any field this build doesn't know, D38) kept.
    - `writeSummaryFile` gets the same `expected` option as `writeTranscriptFile`: the stat the file must still have,
      or `changed`.
    - On `changed`, autosave stops, and the summary shows the notice `FolderNotice` shows for a transcript:
      "Someone else changed this summary." with **Reload** (their version replaces the draft and editing goes on from
      it) and **Keep mine** (the draft overwrites theirs). Reuse `FolderNotice`'s wording and layout; don't write a
      second one.
    - A failed save (folder gone, permission lost) shows the existing folder error with **Reconnect**, and the draft
      is kept until it's saved or the user leaves.
    - Nothing is shown when a save succeeds (D13: the user sees their text).
17. **While the pipeline works on the session** (queued or running), **Edit** is hidden. **While editing**,
    **Regenerate**, **Summarise** and **Try again** are hidden; after **Done** they're back, and **Regenerate** replaces
    the edits (answer 8).
18. **OneDrive conflict copies.** Today the copy with the newest `createdAt` wins. An edit doesn't change
    `createdAt`, so two edited copies of one summary tie. Break the tie with the file's `lastModified`, newest first.
    That's in `groupSessions`, and needs no new field.

### The chat

19. **A chat already open keeps the summaries it started with** (frozen for the cache, §5.5). `get_summaries` and the
    cards show the version from when the chat started.
20. **Its notice counts edited summaries too.** `newSessionCount` counts sessions added or summarised again since the
    chat started, by `createdAt`. Make it also count a session whose summary file is no longer the one the snapshot
    took. Compare the `SessionSummaryFile` object: `knownSummaries` keeps the same object while the file's stat is the
    same, and a save makes a new one. Trim the notice's wording so it covers both ("3 sessions changed since this chat
    started.", with **New chat**), and note the new text in the Handoff.

### Where things live (the layering rules)

21. - `src/domain/summaryEdit.ts` (pure, with `summaryEdit.spec.ts`): the edits as functions from a `SessionSummary` to
      a new one, each returning the same object when nothing changes. For example `setTitle`, `setSynopsis`,
      `setOverviewParagraphs`, `setFinding`, `setRespondentLabel`, `setAttribute`, `addAttribute`, `removeAttribute`,
      `setThemeName`, `setThemeDescription`, `addTheme`, `removeTheme`, `addQuote`, `removeQuote`, and the
      "when left" rules of decision 7.
    - `src/domain/corpus/quoteCheck.ts` (or beside it): `findQuoteTurn(session, text)` for decision 10.
    - `src/storage/projectFiles.ts`: `writeSummaryFile`'s `expected`, and `z.looseObject` for the summary file and
      `SessionSummarySchema`, so unknown fields survive a hand edit's save (D38). Change the comment that says a
      summary is never read and written back.
    - `src/stores/summaryEdit.ts` (new): which session is being edited, the draft, the debounced save, the conflict
      state, `reload()`, `keepMine()`, `flush()`, `done()`. It calls a new `project.saveEditedSummary(sessionId, file,
      expected?)`, which writes through `writeSummaryFile` and updates `knownSummaries`, the listing and the sessions
      as `saveSessionSummary` does.
    - `SessionSummary.vue` keeps reading, and gets a child for the editable document if it grows too large (e.g.
      `SummaryEditor.vue`, with the keyboard handling in a composable such as `useBlockNavigation`). Components talk
      to the store only.

## Tasks

1. **Record the decision** (first, on branch `phase-39-edit-summaries`)
   - `docs/DECISIONS.md`: add D60 (below) under *Later decisions*. Under D21, add a **Changed** line pointing to D60.
   - `docs/PROJECTS.md`: A11 ("Summaries aren't edited, only regenerated") → "Summaries are regenerated by the model
     and can be corrected by hand (D60)". §5.2: "The summary changes when someone regenerates it" → "… regenerates or
     edits it"; the bullet on two people writing one file includes editing one summary. §5.6 *Session summary*: add
     **Edit**.
   - `docs/ROADMAP.md`: Phase 39 in the §7 table (◐ while building); §2's in-scope list: "Correct a session summary by
     hand (Phase 39)".
   - `docs/phases/future.md`: add **F6 — More summary editing**: editing a summary with AI (a prompt box under the
     summary, or `@` a session in the chat with an edit tool that only reaches the summaries named; the maintainer's
     answers so far: one summary per request, written directly, the model's output checked as any summary), renaming
     and merging a theme in every summary without AI, undo across blocks, adding and removing respondents, and an
     edit history.

   ```md
   ### D60 — Summaries can be corrected by hand (2026-11-22; Phase 39)
   - **Decision** (maintainer, answering Phase 39's planning questions): in Project mode, **Edit** turns a session's
     summary into a document the user types in, in place, as in Word: its text, and its themes and quotes added or
     removed. Edits are autosaved to the summary file with the transcript's change check (**Reload** / **Keep mine**).
     A researcher's text is trusted and not checked; quotes are still checked when shown, and a quote's words aren't
     edited. **Regenerate** replaces the edits, without a warning. No AI edits yet. This changes D21's "regenerated,
     never edited" and PROJECTS.md A11.
   - **Why:** researchers need to correct the model's mistakes and reshape its themes. Fixing the transcript or the
     brief and regenerating can't do either, and the summaries are what the project chat reads first.
   - **Consequences:**
     - The summary file is now read and written back, so it keeps unknown fields (D38). Its shape doesn't change:
       nothing records who edited it or when, so D18 doesn't apply and `createdAt` stays the model's.
     - An edited summary keeps its status; its hashes are the model's. OneDrive conflict copies of an edited summary
       tie on `createdAt`, and the newest `lastModified` wins.
     - A summary is no longer only the model's checked output: a hand-written finding or quote reaches the project
       agent as if the model had written it. Quotes that aren't found are marked, as before.
     - The editable text uses `contenteditable="plaintext-only"` with `role="textbox"` on the elements that show it,
       not `<textarea>`, so headings stay headings (an exception to AGENTS.md rule 9's "real `<input>`").
     - The project agent stays read-only.
   ```

2. **`src/domain/summaryEdit.ts`** and `findQuoteTurn` (decisions 5–14, 21), with their specs.
3. **Storage:** `writeSummaryFile(folder, file, name, { expected })`, the loose schemas, the new comment. `groupSessions`'
   tie-break (decision 18).
4. **`stores/summaryEdit.ts`** and `project.saveEditedSummary` (decisions 15–17). The pipeline (`stores/pipeline.ts`)
   asks the edit store whether a session is being edited before it starts it, and the edit store won't start on a
   session the pipeline is working on.
5. **The editable summary** (decisions 1–10): the toggle; the blocks; the keyboard (4–6); the empty-block rules (7);
   paste (8); quotes (9, 10); the notice (16). `ProjectView.vue`'s `onDetailKeydown` must not close the summary for an
   Escape inside a block: add `[contenteditable]` to its `closest(…)`.
   - **Escape** in a block leaves it (focus goes to **Done**) and keeps the text, as Word would; a second Escape closes
     the summary as now.
   - Announce the mode change through a visually hidden `aria-live` region ("Editing" / "Editing finished"), as Phase 9.
6. **The chat's notice** (decision 20).
7. **User docs:** `docs/USER_GUIDE.md`: a short "Correct a summary" section (Edit, typing, Enter, removing and adding
   quotes, Done; that **Regenerate** replaces the edits; that a chat already open uses the summary from when it
   started). `docs/TESTING.md`: a manual row: edit a summary on two computers sharing a OneDrive folder → **Keep mine**
   on one → both show it. `CHANGELOG.md`: an *Added* entry under *Unreleased*.

## Contracts introduced

```ts
// src/domain/summaryEdit.ts (selection)
export function setOverviewParagraphs(s: SessionSummary, paragraphs: readonly string[]): SessionSummary;
export function addTheme(s: SessionSummary, after: number, vocabulary: ReadonlySet<string>): SessionSummary;
export function removeTheme(s: SessionSummary, index: number): SessionSummary;
export type QuotePlace = { kind: 'question'; index: number } | { kind: 'theme'; index: number };
export function addQuote(s: SessionSummary, place: QuotePlace, quote: SummaryQuote): SessionSummary;
export function removeQuote(s: SessionSummary, place: QuotePlace, quoteIndex: number): SessionSummary;

// src/domain/corpus/quoteCheck.ts (addition)
/** The first turn whose English text verifies `text`, with the transcript's own words; `null` if none. */
export function findQuoteTurn(session: SessionText, text: string): { turnId: string; text: string } | null;

// src/storage/projectFiles.ts (changed)
export function writeSummaryFile(
  folder: ProjectFolder, file: SessionSummaryFile, name: string, opts?: { expected?: FileStat },
): Promise<{ name: string; stat: FileStat }>;

// src/stores/summaryEdit.ts (new)
sessionId: string | null; draft: SessionSummary | null; conflict: boolean;
start(sessionId: string): void; change(next: SessionSummary): void;
flush(): Promise<void>; done(): Promise<void>; reload(): Promise<void>; keepMine(): Promise<void>;
```

## Acceptance criteria

- [ ] **Edit** turns the summary into editable text without moving or resizing anything, and **Done** turns it back.
      No text box borders are shown; the block with the caret is tinted.
- [ ] Clicking anywhere in the text places the caret there. ↑ / ↓ / ← / → cross from block to block in reading order;
      Tab still moves between focusable things.
- [ ] Enter splits an overview paragraph, and Backspace at a paragraph's start joins it to the one above. Enter at the
      end of a theme's description adds a theme; at the end of a respondent's value, a detail row. Elsewhere Enter
      moves on. No block gets a line break.
- [ ] Backspace in an empty theme (name and description empty) removes it; **Remove theme** removes one with text.
- [ ] A quote's words can't be edited. **Remove quote** removes it. **Add quote** takes pasted words, finds their turn
      and shows the card with speaker and time; words that aren't in the transcript are kept and marked. Add quote is
      hidden at 3 quotes.
- [ ] The empty-block rules hold (title restored, finding "Not discussed in this session.", empty paragraph removed).
- [ ] Pasting formatted or multi-line text gives plain text; Ctrl+Z works after a paste.
- [ ] Edits are in the file after the save delay and after a reload. Every other field of the file is unchanged, and an
      unknown field in the file survives the save.
- [ ] A file changed by someone else stops autosave and offers **Reload** and **Keep mine**; each does what it says.
- [ ] The session's status (up to date / out of date) doesn't change with an edit. **Regenerate** replaces the edits.
- [ ] **Edit** is hidden while the pipeline works on the session; Regenerate / Summarise / Try again are hidden while
      editing.
- [ ] The sessions list shows an edited title; the chat's next new chat sees the edit; a chat already open shows the
      notice counting the edited session.
- [ ] Escape inside a block doesn't close the summary.
- [ ] Every block has an accessible name and the `textbox` role; the axe spec passes with Edit on; a keyboard-only
      pass works; the mode change is announced.
- [ ] D60, PROJECTS.md, ROADMAP, future.md, USER_GUIDE, TESTING and CHANGELOG are updated.

## Required tests

- `domain/summaryEdit.spec.ts`: each edit returns a new summary only when something changes, and leaves the other
  entries' identity; overview split and join; the empty-block rules; `isNew` against the other sessions' vocabulary;
  quotes added and removed; `turnIds` untouched.
- `domain/corpus/quoteCheck.spec.ts`: `findQuoteTurn` finds the first verifying turn, returns the transcript's words,
  handles `…` omissions as `checkQuote` does, and returns `null` when no turn has the words.
- `storage/projectFiles.spec.ts`: `writeSummaryFile` with `expected` writes when unchanged and throws `changed`
  otherwise; an unknown field in a summary file survives read → write.
- `stores/project.spec.ts`: `saveEditedSummary` updates the session (title, summary) without a rescan; the
  conflict-copy tie-break by `lastModified`.
- `stores/summaryEdit.spec.ts`: debounced save (fake timers); flush on Done and `pagehide`; `changed` → `conflict`;
  `reload` and `keepMine`; a rescan doesn't replace the draft; no start while the pipeline works on the session.
- `stores/chat.spec.ts`: `newSessionCount` counts an edited summary.
- `SessionSummary.spec.ts` (and `SummaryEditor.spec.ts` if split): the toggle; blocks are `contenteditable` with names
  and roles; `input` updates the store; Enter / Backspace / arrow handling (with a stubbed caret position); paste
  cleaning; Remove / Add quote; buttons hidden as decision 17 says; Escape leaves a block.
- `ProjectView.spec.ts`: Escape in a block doesn't close the summary.
- `tests/e2e/summary-edit.e2e.ts` (on the project folder fixture in `projectFolder.ts`): edit the title and a finding →
  reload → the edits are there and the sessions list shows the new title; Enter in the overview → two paragraphs in
  the file; add a pasted quote → its card has speaker and time; a file changed behind the page → **Keep mine**.
- `tests/e2e/a11y.e2e.ts`: a summary with Edit on.

## Out of scope

- Any AI editing (a prompt box, `@` mentions, an edit tool for the agent).
- Renaming or merging a theme in every summary.
- Undo/redo across blocks, or of a removed theme or quote.
- Adding or removing respondents; changing a quote's words or turn by hand; editing the research question's wording.
- Recording who edited a summary, or when, or keeping earlier versions.
- Warning before **Regenerate** replaces edits.
- Updating a chat already open with an edited summary (it shows the notice instead).

These go in [future.md](future.md) F6.

## Handoff

### 2026-11-22 — built (Claude Code)

All tasks are done. The Definition of Done checks pass: typecheck, lint, 2213 unit tests, build and single file,
`cargo test` (114), and 165 of 166 e2e specs. Not yet committed.

The one e2e failure is `a11y` "Project: every state, search results and the Brief dialog". It times out at 30 s when
the whole suite runs in parallel on the maintainer's PC: on `main` without this phase too (33.5 s), and in about 11 s
alone. It's outside this phase, so it's left for the maintainer, e.g. `test.slow()` on it.

`cargo test` also failed twice in `stt::download_tests` while the e2e suite ran at the same time, and passed alone;
they are timing tests. Manual row 24 in TESTING.md (two computers on OneDrive) is open, and so
is the feel of the arrow keys in Edge and in the desktop app's WebView2: the e2e spec checks them in Playwright's
Chromium only.

**Where it is:** `domain/summaryEdit.ts` (the edits), `findQuoteTurn` in `domain/corpus/quoteCheck.ts`,
`stores/summaryEdit.ts` (the draft, autosave, the change check), `project.saveEditedSummary` and
`project.readSessionSummary`, `ui/composables/useSummaryEditing.ts` (blocks, keys, paste, quotes, `vBlockText`) and
`useBlockNavigation.ts` (the caret across blocks). `SessionSummary.vue` keeps one template for reading and editing:
each editable element gets its attributes from `blockAttrs()`, so there's no separate `SummaryEditor.vue`.

**Changed from the decisions and contracts above:**
- **Respondents' details and theme names:** the `textbox` sits on a `span` or `div` *inside* the `dt`/`dd`, not on
  them. axe found that a `dt` with `role="textbox"` breaks the definition list (`definition-list`, serious).
- **`isNew`:** `addTheme(s, after)` takes no vocabulary. A new theme is `isNew: true`, and naming or renaming one
  sets `isNew` from `isKnownTheme(name)`, which the store builds from `project.themesExcept()` with `themeKey` (the
  domain can't import `features/`).
- **The store's names** follow the transcript store's, so `FolderNotice` serves both through a `source` prop:
  `resolveConflict('reload' | 'keep')`, `retryFolderSave()`, `reconnectFolder()`. There is also `stop()`: leaving
  the summary saves what it can and ends editing, while `done()` keeps editing (with the notice) if the file can't
  be written yet.
- **Done tidies:** themes with no name, description or quotes, and detail rows with neither field nor value, are
  removed, and the title and synopsis trimmed (`tidySummary`).
- **Added:** **Add theme** at the end of the themes in edit mode (a summary without themes had no way to get one),
  and Enter at the end of a respondent's name adds their first detail when they have none. Backspace at the start of
  any other block moves to the end of the one above.
- **The overview's paragraphs** are held in the editor while editing, each with an id, so an emptied one stays until
  it's left and removing it doesn't move the caret.
- **The chat notice** compares summary files by identity, then by `createdAt` and content, so a reload of the folder
  doesn't count every session. `summaryStamps` is gone.
- **Writes go to the summary file that won** (`session.summaryFile.name`), which may be a conflict copy.

**UI text (D13):**
- The chat notice now reads "N sessions added or changed since this chat started." (was "N new sessions…").
- The block names are "Title", "Synopsis", "Overview, paragraph N", "Respondent", "Detail of <label>", "<field> of
  <label>", "Finding: <first six words of the question>", "Name of theme N", "Description of <theme>" and "New
  quote".
- The buttons are "Remove quote: <words>", "Remove theme: <name>", "Add quote" and "Add theme".
- The conflict notice says "The project's copy of this summary has changed."

**Left as is:** **Add to project** on Output doesn't check for an edit in progress. If it summarises a session that
is being edited, the next save finds the changed file and shows **Reload** / **Keep mine**. Focus is shown by the
tint alone, with no outline: decision 2 asks for no borders.
