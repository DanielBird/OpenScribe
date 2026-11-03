# Phase 9 — Edit transcript text

**Goal:** An **Edit text** button on the Output tab turns every turn's text into a plain text box, so the user can
correct misheard words and names. Edits are autosaved and used by the `.docx` export and by any later translation.
There is no formatting and there are no line breaks. The turns themselves don't change: their speakers, timestamps
and number stay the same.

**Depends on:** Phase 8 (start from `main` after the 1.0 release).

**Read first:** [DECISIONS.md](../DECISIONS.md) D8, D10, D13, D14, D17, D18, T4; [future.md](future.md) F3; the
Handoffs of [Phase 4](04-output-tab.md) (speaker rename) and [Phase 7](07-audio-playback.md) (click to play,
Follow); `tests/e2e/large-transcript.perf.ts`.

## Agreed with the maintainer (2026-10-14)

- One page-level **Edit text** toggle, not an edit button on each turn.
- Only a turn's text changes. Turns are not split or merged, and a turn can't be moved to another speaker. There is
  no undo/redo across turns: the browser's own Ctrl+Z inside a text box is enough.
- Enter finishes editing. Turn text never contains line breaks.
- An existing English translation is left alone when the original is edited. It may go out of date. Show no notice
  and take no action; users translate again if they need to.

## Decided in this file (the maintainer can still change them)

- **Edits change the original transcript only**, never the English translation. Turning Edit on shows the Original.
- **A turn can't be emptied.** Leaving a box empty restores the text it had before. Deleting turns is out of scope.
- **While editing,** the Original | English switch and **Translate** are hidden (D13: hidden, not disabled).
  **Download .docx** stays: it uses the text as typed. **Edit text** is hidden while a translation runs, so a
  translation can't finish and switch the view mid-edit.
- **Follow playback doesn't scroll while a text box has focus**, so a user can listen and type without the list
  moving away. The highlight still moves.
- **No schema change.** `Turn.text` is overwritten. `Turn.words` keep the machine transcription. There is no
  `originalText` field, so no storage migration is needed (D18).

## Tasks

1. **Record the scope change** (do this first, on branch `phase-9-edit-text`)
   - `docs/DECISIONS.md`: add D19 (below) under *Later decisions*. In D8, replace "Transcript text is not editable
     in v1." with "Transcript text became editable in Phase 9 (D19)."
   - `docs/ROADMAP.md`:
     - Add Phase 9 to the §7 table (depends on 8) and to the mermaid graph.
     - In §2, change the out-of-scope item "Editing transcript text" to "Splitting, merging or reassigning turns".
   - `docs/phases/future.md` F3: keep only what is left. That is splitting and merging turns, reassigning a turn's
     speaker, undo/redo across turns, `originalText` (restore the machine text), and editing the English
     translation.

   ```md
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
     - Splitting, merging and reassigning turns, and undo across turns, stay in future.md F3.
   ```

2. **`src/domain/transcript.ts`: `cleanTurnText(text)`**
   - Every line break becomes one space: `\n`, `\r\n`, `\r`, U+2028 and U+2029, including any spaces around it.
   - Leading and trailing whitespace is removed. Other spaces stay as typed.
3. **`stores/transcript.ts`: `editTurnText(turnId, text)`**
   - Cleans `text` with `cleanTurnText`. Does nothing for an unknown id, an empty result or unchanged text: no new
     doc and no save.
   - Otherwise it replaces the doc immutably (T4). The new `turns` array has a new object only for that turn
     (`{ ...turn, text }`). Every other turn keeps its identity, so `v-memo` skips it. `words`, `start`, `end`,
     `speakerId` and `translations` don't change.
   - It uses the same debounced save as `renameSpeaker`, so the existing `pagehide` flush covers it. Renaming
     `RENAME_SAVE_DELAY_MS` to `SAVE_DELAY_MS` is fine.
4. **`TurnList.vue` / `TurnItem.vue`: editable text**
   - New prop `editable`. When true, each turn's text is a `<textarea>` instead of the `<p>`.
     - It looks like the text (same font, line height and width), with a light border and a visible focus ring.
     - Its height follows the content through CSS `field-sizing: content` (Chromium 123+). Use `rows="1"` and
       `resize: none`. No resize JavaScript.
   - Each box has an accessible name that includes the speaker and the time, e.g. "Speaker 1, 00:01:23". Tabbing
     between boxes only reads the name, not the list item around it.
   - `spellcheck` stays at the browser default (on). The list's `lang` is the original language, so Chromium checks
     spelling in that language when it has the dictionary.
   - Editing works like `SpeakerPanel`'s draft:
     - On focus, remember the turn's text (`before`). While the box has focus it shows exactly what was typed. On
       every `input`, it emits the text, and the store saves the cleaned version.
     - **Enter** (with or without Shift, but not while `event.isComposing`) inserts nothing and finishes editing:
       the box loses focus. Tab must then go on from that turn. If Chromium starts again from the top of the page
       instead, move focus to the next turn's box and note it in the Handoff.
     - **Escape** puts `before` back, in the box and in the store, and finishes editing.
     - **Leaving the box empty** (by Enter, Escape, Tab or a click elsewhere) puts `before` back.
     - **A pasted line break** shows as a space at once. Hint: in the `paste` event, insert the cleaned text with
       `document.execCommand('insertText', …)`, which keeps Ctrl+Z working. Setting `value` would clear the undo
       history. Any line break that still gets in (e.g. by drag and drop) is replaced on `input`.
   - Clicking a box places the caret; it doesn't play. The timestamp button still plays, so the user can listen to a
     turn while correcting it. Space and K already type normally in a textarea (AudioBar's `KEEP_KEYS_IN`).
   - `TurnItem` stays presentational. It emits `edit: [turnId, text]`, `TurnList` passes it on, and `OutputView`
     calls the store. Add `editable` to `TurnList`'s `v-memo` list.
   - Follow: `TurnList`'s scroll watcher does nothing while focus is in one of its text boxes.
5. **`OutputView.vue`: the toggle**
   - Add a button to the actions row. It reads **Edit text**, and **Done** while editing. The state is local to
     `OutputView`, so editing is off whenever the Output tab is opened again.
   - Turning it on sets `transcript.view = 'original'` and passes `editable` to the list. Focus stays on the button.
   - While editing, hide `VersionToggle` and `TranslateButton`. Keep `ExportButton` and the speaker panel.
   - Hide the button while `translation.isRunning`.
   - Announce the change of mode through a visually hidden `aria-live` region (draft: "Editing" / "Editing
     finished"). The visible label already shows it.
6. **Performance:** extend `tests/e2e/large-transcript.perf.ts` with two measurements:
   - From clicking **Edit text** to the text boxes painted. Target < 1 s, like render.
   - The time per keystroke typed into a box, mean and max. Target < 100 ms, like rename.

   Record the numbers in `docs/TESTING.md` (Performance) and the Handoff. If turning Edit on misses its target, ask
   the maintainer before changing the design. The fallback is a textarea only for the turn being edited, which
   needs its own keyboard and accessibility design.
7. **User docs:**
   - `docs/USER_GUIDE.md`: a short "Correct the text" section. Cover Edit text, Enter and Escape, and Done. Say that
     the export uses the corrected text and that an English translation is not updated (translate again).
   - `docs/TESTING.md`: a manual checklist row: edit a turn → reload → export → the `.docx` has the edit.
   - `CHANGELOG.md`: an *Added* entry under *Unreleased*.

## Contracts introduced

```ts
// src/domain/transcript.ts
/** Line breaks become single spaces; leading and trailing whitespace is removed. */
export function cleanTurnText(text: string): string;

// stores/transcript.ts (addition)
/** Replaces one turn's text (cleaned). Ignores an unknown id, empty or unchanged text. Debounced save. */
editTurnText(turnId: string, text: string): void;

// TurnList.vue and TurnItem.vue
props: { editable?: boolean }    emits: { edit: [turnId: string, text: string] }
```

## Acceptance criteria

- [x] **Edit text** turns every turn's text into a box, and **Done** turns it back. Speakers, timestamps and the
      number of turns never change.
- [x] Typing changes the turn's text at once. After a reload (**Open** on the Setup banner), the edit is still there.
- [x] Enter never inserts a line break. It finishes editing, and Tab then goes on from that turn. Pasting text with
      several lines gives one line.
- [x] Escape restores the text from before the box got focus. Leaving a box empty restores it too.
- [x] The Original `.docx` contains the edited text. With a translation, the English `.docx` is unchanged.
- [x] With a translation, turning Edit on shows the Original. While editing, the version switch and Translate are
      hidden. After **Done** they are back, and the English text is unchanged.
- [x] **Edit text** is not offered while a translation runs.
- [x] While editing, clicking a box doesn't start playback, but the timestamp button does. Space types a space in a
      box. Follow doesn't scroll while a box has focus.
- [x] Every box has an accessible name with the speaker and time. The axe spec passes with Edit on. A keyboard-only
      pass works: Tab reaches each box, Enter finishes, **Done** leaves.
- [x] The performance targets are met on the large fixture, and the numbers are recorded.
- [x] D19, ROADMAP, future.md, USER_GUIDE, TESTING and CHANGELOG are updated.

## Required tests

- `domain/transcript.spec.ts`: `cleanTurnText` with `\n`, `\r\n`, several breaks in a row, spaces around a break,
  U+2028, leading and trailing whitespace, inner double spaces kept, and whitespace only → `''`.
- `stores/transcript.spec.ts`: `editTurnText`
  - Only the edited turn is a new object (`toBe` on the others).
  - Words, times, speaker and translations are unchanged.
  - The text is cleaned.
  - An unknown id, empty text or unchanged text leaves the same doc and doesn't save.
  - The save is debounced (fake timers) and flushed on `pagehide`.
- `TurnList.spec.ts`:
  - `editable` renders named textareas.
  - `input` emits `edit` with the turn id.
  - Enter is prevented, emits, and blurs. Enter while `isComposing` is ignored.
  - Escape restores. A box left empty restores.
  - A paste with line breaks gives one line.
  - Clicking a box emits no `select`; the timestamp button still does.
  - There's no follow scroll while a box has focus.
- `OutputView.spec.ts`:
  - The toggle works and sets the view to Original.
  - The switch and Translate are hidden while editing.
  - Edit is hidden while a translation runs.
  - Editing is off after the view mounts again.
- `tests/e2e/edit.e2e.ts`:
  - An edit survives a reload.
  - Enter, then Tab.
  - A multi-line paste: dispatch a `paste` event with a `DataTransfer`.
  - The `.docx` has the edit (reuse the JSZip reading in `export.e2e.ts`).
  - With a mocked translation, the English export is unchanged.
- `tests/e2e/a11y.e2e.ts`: add the Output tab with Edit on.
- `tests/e2e/large-transcript.perf.ts`: the two new measurements.

## Out of scope

- Splitting, merging or deleting turns.
- Moving a turn to another speaker, or changing timestamps.
- Undo/redo across turns.
- Editing the English translation.
- Flagging an out-of-date translation or edited turns.
- Restoring a turn's machine text (`originalText`).
- Any formatting.

These stay in [future.md](future.md) F3.

## Handoff

*(Performance numbers, UI text trimmed under D13, and any change to the decisions above.)*

### 2026-10-14 — Phase 9 done (branch `phase-9-edit-text`, based on `main` at `0251595`)

**Decided while building**
- **Edit text comes first in the actions row** (the maintainer's choice): `[Edit text] [Download .docx] [Translate…]
  [Original | English]`, and `[Done] [Download .docx]` while editing. The button doesn't move when clicked. The
  keyboard spec passes one more Tab stop before Translate.
- **`joinLines(text)`** was added to `domain/transcript.ts` next to `cleanTurnText` (which is `joinLines` + trim).
  Paste and the `input` fallback use it, so a pasted " and more" keeps its leading space.
- **A run of line breaks becomes one space:** two line breaks between "a" and "b" give "a b", not "a  b". Spaces
  around a break go with it.
- **Escape is ignored while an IME is composing**, like Enter (the phase file only said Enter).
- **Tab after Enter:** Chromium goes on from the finished turn (its timestamp button, then the next box), so no
  focus fallback was needed. `edit.e2e.ts` checks it.
- **The text doesn't move when Edit text turns on or off** (the maintainer's request after the first build, whose
  box padding and a wider row gap pushed every turn down 18px and re-wrapped some). `.text` now has the same box in
  both modes: a 1px border sitting on the line box (transparent in read mode), side padding taken back on the left
  by a negative margin, and `white-space: pre-wrap` (how a textarea wraps). Editing only colours the border. Checked
  on the 3-hour transcript at 1280px and 375px: every turn's text, speaker and timestamp keep their position and size,
  and screenshots of both modes (border hidden) are pixel-identical. `edit.e2e.ts` asserts the positions.
- **Read mode changes slightly** (the maintainer chose these trade-offs):
  - The text wraps 8px narrower, so the edit box ends at the column's right edge. 21 of 2,209 turns re-wrap at
    1280px, 114 at 375px.
  - Double spaces in a turn now show, as they would in the box.
  - Under 30rem the box starts 8px into the left page margin, so the text stays lined up with the timestamp.
- **Timestamps keep the 4px gap above the text** (the maintainer's choice). The box sits 3px under the timestamp.
  A first draft used a 12px gap in edit mode only, but that moved the text.
- **Box look:** a light border (`--color-border`, stronger on hover) and the global focus ring.
- **UI text:** kept as drafted: **Edit text** / **Done**, live region "Editing" / "Editing finished", box names
  "Speaker 1, 00:01:23". Nothing to trim under D13.

**Performance** (`npm run test:perf`, 2,209 turns; table in `docs/TESTING.md`)
- 1×: Edit text on 312 ms (target < 1 s); per keystroke mean 17 / max 24 ms (target < 100 ms).
- 4× (reported only): Edit text on 1.7 s; per keystroke mean 74 / max 129 ms.
- The PC was slower that day. The Phase 8 measures came out about twice their 1.0.0 values, and the same on an
  untouched `main` worktree (render 335 ms, rename max 67 ms), so this phase didn't regress them.
- Rename was close to its 100 ms target that day (max 97–111 ms over four runs on the branch). An A/B in one page
  load showed the new text box isn't the cause: rename mean 37 ms with it, 39 ms with 1.0's text styling.
- One textarea per turn met the targets, so the fallback (a box only for the active turn) wasn't needed.

**For later**
- The light border is below 3:1 against the page (WCAG 1.4.11 non-text contrast), unlike `--color-border-strong`,
  which other form controls use. It follows this file's "light border", and edit mode is entered on purpose with
  **Done** in view. Revisit if an accessibility review asks for it.
- `SpeakerPanel`'s turn counts are now recomputed on each edit keystroke, because an edit replaces the `turns`
  array. That's about 2,000 iterations and didn't show up in the timings.
- **Timestamps under the pinned bars (WCAG 2.5.8):** a scroll sweep with axe's `target-size` rule shows that 1.0
  already fails when a timestamp is half under the pinned step nav: the visible strip is too close to the nav
  buttons, in about 12 of 20 positions. In edit mode the same happens under the sticky AudioBar, with the box below
  as the neighbour, in about 5 more. The a11y spec checks stable scroll states and passes. A possible fix for both is
  `scroll-padding`/`scroll-margin`, or a 24px hit area for the timestamp. Accepted for now.
- No live API calls were made in this phase.

### 2026-11-03 — Translations of edited turns (audit DES-2)
- D39 replaces this phase's rule that an English translation is neither updated nor flagged when the original
  changes. A translation now records the text of each turn it was made from; a turn edited since shows **Changed
  since translation** in the English view, and **Update English…** translates only those turns.
