# Phase 3 — Glossary tab

**Goal:** Users keep one list of project terms (product names, jargon, people's names). They can paste many terms at
once, edit or delete individual terms, clear the list, and copy it. The list is saved after every change. **Run**
starts the transcription.

**Depends on:** Phase 0. It can run in parallel with Phases 1 and 2. It uses the `job.start()` stub and the
`nav` store; the real job arrives in Phase 4.

**Read first:** [DECISIONS.md](../DECISIONS.md) D6, [reference/elevenlabs-stt.md](../reference/elevenlabs-stt.md)
(keyterm limits and cost).

## Tasks

1. **`src/domain/glossary.ts`** (pure)
   - `parseTerms(raw)`: split on `/[\r\n,;\t]+/`, trim each piece, collapse internal whitespace to single spaces,
     strip surrounding quotes (`"…"`, `'…'`, `“…”`), and drop empty pieces.
   - `mergeTerms(existing, incoming)`: removes duplicates **case-insensitively** (`toLocaleLowerCase()`, with
     Unicode NFC normalisation). Keeps the first casing seen and the order (existing first, then new). Returns
     `{ terms, added, duplicates }`.
   - `validateTerm(term, limits)`: issues `too_long` (> `maxChars` characters), `too_many_words`
     (> `maxWords` words) and `unsupported_chars` (contains any character of `forbiddenChars`).
   - `validateList(terms, limits)`: returns `{ valid, invalid: { term, issues }[], overLimit: string[] }`. Terms
     beyond `maxTerms` (after the invalid ones are removed) go into `overLimit`.
   - The limits are passed in: use `ELEVENLABS_LIMITS.keyterms` from Phase 1
     (`src/providers/transcription/elevenlabs/limits.ts`), passed into the domain function by the store.
     **Live check V1 showed that a single invalid term makes ElevenLabs reject the whole transcription** (400
     `invalid_keyword`). Filtering invalid terms out of `validTerms` is what keeps a run from failing. The values
     are `maxChars: 49` (the API requires *under* 50) and `forbiddenChars: '<>{}[]\\'`.
2. **`stores/glossary.ts`** (implement the skeleton)
   - `terms` is loaded from `describe.v1.glossary` (a string array, with a guard) at init.
   - Every mutation writes synchronously via `writeJson`. **"Saved after each edit" is a requirement.**
   - `addFromText(raw)` returns `{ added, duplicates }` for the UI summary.
   - `updateTerm(index, value)` returns `{ ok: true } | { ok: false, reason: 'empty' | 'duplicate' }`.
   - `removeTerm(index)`, `clear()`.
   - Getters: `validation` (`validateList` result), `validTerms` (what is sent), `count`.
3. **`ConfirmDialog.vue`:** a generic modal based on `<dialog>`. Props: title, message, confirm label, danger
   style. Returns a promise via a small `useConfirm()` composable. Escape cancels, and focus returns to the
   trigger.
4. **`GlossaryEditor.vue`**
   - **Add terms:** a `<textarea>` with placeholder *"Paste terms — one per line, or separated by commas or
     semicolons"*, and an **Add** button (Ctrl+Enter also adds). Shows *"Added 12 · skipped 3 duplicates"* in an
     `aria-live` region and clears the textarea.
   - **List** headed *"23 terms"*, a simple vertical list (wraps on narrow screens). Each row:
     - The term text. Clicking it, or its **Edit** button, switches the row to an input. Enter or blur saves, Escape
       cancels. A duplicate or empty value shows an inline error and keeps editing.
     - A **Delete** button with `aria-label="Delete term <term>"`.
     - Invalid terms show the reason (*"50 characters or more"*, *"more than 5 words"*, *"contains < > { } [ ] or
       \\"*) and a "skipped" badge.
   - Toolbar: **Copy list** (newline-joined, via `navigator.clipboard.writeText`; falls back to selecting the text
     in a read-only textarea), and **Clear all** (with confirmation *"Remove all 23 terms? This can't be undone."*).
   - Empty state: *"No terms yet. A glossary is optional, but it helps the transcription spell product names and
     jargon correctly."*
   - Notices:
     - When `invalid.length + overLimit.length > 0`: *"N terms will be skipped (see highlighted)."*
     - Always: *"Using a glossary adds about 20% to ElevenLabs transcription cost."*
5. **`GlossaryView.vue`**
   - The editor, plus a footer with **◀ Back** (to Setup) and **Run ▶**.
   - Run is disabled if `!settings.isReady` (with the reason shown).
   - On click: call `job.start()` **first**, then `nav.goTo('output')`. The nav guard only opens Output once
     `job.status !== 'idle'`, and Phase 4's `start()` sets `uploading` synchronously before its first `await`.
     Until Phase 4 lands, `start()` is the Phase 0 stub (it throws), so the test for Run stubs it, e.g.
     `vi.spyOn(job, 'start')` with an implementation that sets `job.status = 'uploading'`. (Phase 4 adds the
     "replace last transcript?" confirmation.)

## Contracts introduced

```ts
// src/domain/glossary.ts
export interface KeytermLimits { maxTerms: number; maxChars: number; maxWords: number; forbiddenChars: string }
export type TermIssue = 'too_long' | 'too_many_words' | 'unsupported_chars';
export function parseTerms(raw: string): string[];
export function mergeTerms(existing: string[], incoming: string[]): { terms: string[]; added: number; duplicates: number };
export function validateTerm(term: string, limits: KeytermLimits): TermIssue[];
export function validateList(terms: string[], limits: KeytermLimits):
  { valid: string[]; invalid: { term: string; issues: TermIssue[] }[]; overLimit: string[] };
```

## Acceptance criteria

- [x] Pasting `"Oticon\nPhilips; hearing aid, Hörgerät\n\n oticon "` adds 4 terms and reports 1 duplicate.
- [x] Edits, deletes and Clear all are reflected in `localStorage` immediately. After a reload, the list is
      identical.
- [x] A 50-character term is shown as skipped and is not in `validTerms`; a 49-character term is kept.
- [x] A term containing `[` (or any of `< > { } ] \`) is shown as skipped with the reason, and is not in
      `validTerms`.
- [x] Copy list puts the newline-separated terms on the clipboard. *(Checked once against the real clipboard; the
      e2e stubs `writeText` so the suite doesn't overwrite the developer's clipboard. See Handoff.)*
- [x] Keyboard only: add, edit (Enter/Escape), delete, clear (confirm/cancel) all work.
- [x] Back returns to Setup with its state intact. Run navigates to Output. *(Run is covered by
      `GlossaryView.spec.ts` with `job.start` stubbed; the e2e only checks that it is enabled, because the Phase 0
      stub throws. Phase 4 adds the e2e path.)*

## Required tests

- `domain/glossary.spec.ts`: separators, whitespace, quotes, umlauts and accents, case-insensitive duplicates,
  word and character limits (49 kept, 50 skipped), each forbidden character, over 1000 terms.
- `stores/glossary.spec.ts`: persistence on every mutation; corrupt storage falls back to `[]`.
- `ui/components/GlossaryEditor.spec.ts`: add summary, inline edit success/duplicate/escape, delete, clear with
  confirm.
- `tests/e2e/glossary.e2e.ts`: paste, reload, terms persist; clear all.

## Out of scope

Multiple glossaries, file import/export, sending terms to the API (Phase 4 wires `validTerms` into the job).

## Handoff

*(Notes for the next agent.)*

### 2026-10-13 — Phase 3 done (branch `phase-3-glossary-tab`, based on `main` at `743281d`)

**Domain (`domain/glossary.ts`).** The contract is as specified. Additions:
- **`normalizeTerm(raw)`** trims the term, collapses whitespace, strips one pair of surrounding quotes and applies
  NFC. `parseTerms` uses it on each piece, and the store uses it for edits and when loading.
- **Extra quote pairs:** besides `"…"`, `'…'` and `“…”`, it also strips `„…“`, `‘…’` and `«…»`. German and French
  users paste these.
- **`termKey(term)`** (NFC + `toLocaleLowerCase()`) is the duplicate identity.
- **Counting:** characters are counted as code points and words are split on whitespace. These are assumptions,
  not live-checked; see the note under *Limits & cost* in `reference/elevenlabs-stt.md`.

**Glossary store.** Names are as in Phase 0. New:
- **`limits`:** `ELEVENLABS_LIMITS.keyterms`.
- **`validation`** and **`count`**.
- **`saveFailed`:** true when the last write failed. The editor then warns that the list lasts only for this tab.
- **Saving:** a sync watcher saves every change. Actions replace the array, so plain assignments persist too.
- **Loading:** the saved list is normalised and deduplicated. Anything that isn't a string array becomes `[]`.
- **`validTerms`** is what Phase 4 sends. It excludes invalid terms and anything after the first 1000 valid ones.

**Confirm dialog.** For Phase 4 (Run confirmation), Phase 7 (file mismatch) and Phase 8 (Clear saved data):
- **Usage:** `const { confirm, dialog } = useConfirm()` (`ui/composables/useConfirm.ts`). Render
  `<ConfirmDialog v-bind="dialog" />` in the same component, then `if (!(await confirm({ title, message,
  confirmLabel, danger }))) return;`.
- **Per component:** each component owns its own dialog, so Phase 4 adds one to `GlossaryView`, which doesn't have
  one yet.
- **Behaviour:**
  - `danger` gives a red confirm button and puts focus on Cancel.
  - Escape cancels.
  - Focus returns to the element that was focused when the dialog opened.
  - If the dialog is closed by the browser (Chromium may ignore `preventDefault` on a repeated Escape), it counts
    as Cancel.

**Styles and tokens.**
- New tokens: `--color-danger-hover`, `--color-warning-bg` (skipped rows) and `--color-backdrop`.
- New shared `.button-danger` class in `base.css`.
- `tokens.spec.ts` now checks white text on accent, accent-hover, danger and danger-hover, and warning text on the
  warning background (4.51:1).

**Editor details.**
- **Separator:** the "skipped" badge is followed by a visually hidden `": "`, so screen readers hear "skipped:
  contains …".
- **Edit errors:** a rejected edit (empty or duplicate) keeps the row in edit mode but does not pull focus back on
  blur.
- **Delete:** deleting cancels any open edit, because indexes shift.

**Run.** Run calls `void job.start()` and then `nav.goTo('output')`. Phase 4 adds the "replace last transcript?"
confirmation in front of that and the e2e path. Clicking Run in the built app throws until then, so no e2e clicks
it.

**Clipboard in e2e.**
- **Real clipboard:** a first run with clipboard permissions passed. Over `file://`, `navigator.clipboard` works,
  and on Windows the OS clipboard holds `\r\n` line breaks, which is fine for pasting into Word or Notepad.
- **Why it's stubbed:** headless Chromium writes to the *real* system clipboard, so the spec now stubs `writeText`
  with `addInitScript`.
- **Fallback:** a second test makes `writeText` reject and checks the selected fallback textarea.

**Built-in browser pane.** It shows `dist/describe.html` as a `data:` snapshot without `localStorage`, so the "isn't
saving" notice appears there. That is expected, and the real `file://` page saves normally (e2e).

**Tests:** 387 unit tests (up from 268) and 18 e2e tests (up from 11). Mutation spot checks, each caught by at least
one test:
- dropping the focus restore in `ConfirmDialog`
- removing `preventDefault` on `cancel`
- swapping the Run order
- removing the own-row exclusion in the duplicate check
- returning all terms as `validTerms`
- not cancelling an open edit on delete

**Bundle:** 202 KB (69 KB gzip), up from 191 KB.

### 2026-10-13 — UI follow-up (maintainer's changes, same branch)

These changes replace parts of the task list above.

**Glossary editor**
- **Cost note removed:** the *"adds about 20%"* line is gone. The maintainer removed it; the cost is still recorded
  in `reference/elevenlabs-stt.md`.
- **New placeholder:** *"Add new terms (write or paste one per line, or separated by commas)"*.
- **No visible label:** the "Add terms" label is visually hidden but still names the textarea.
- **Add result for screen readers only:** *"Added 4 · skipped 1 duplicate"* is still announced, but sighted users
  don't see it. *"No terms found."*, and the delete, copy and clear results, stay visible.

**`StepFooter.vue`, for all tabs**
- **What it is:** the step buttons (Back / Next / Run) now live in a shared component.
- **Where it sits:** at the bottom of the window on short pages, and pinned to the bottom edge while a long page
  scrolls (`position: sticky`).
- **How it fills the window:** `.app-main` is a flex column, and each view is `display: flex; flex: 1;
  flex-direction: column`, so the footer's `margin-top: auto` pushes it down.
- **Slots and props:**
  - `back`
  - `primary`, which receives `describedBy` for `aria-describedby`
  - `missing`, which lists why the primary button is disabled
- **Focus:** `html { scroll-padding-bottom: 6rem }` keeps focused elements clear of the bar.
- **Phase 4:** OutputView should put any step buttons it adds (e.g. *Back to setup*) in a `StepFooter` and give
  its root the same flex layout.

**Tests:** 391 unit tests and 19 e2e tests. A new e2e test checks where the bar sits on Setup (pinned), on an empty
Glossary (bottom of the window) and on a 60-term Glossary (pinned).
