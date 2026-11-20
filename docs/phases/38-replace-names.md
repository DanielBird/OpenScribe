# Phase 38 — Find and replace names

**Goal:** a **Find and replace** dialog on the Output page lets a colleague replace a name in a transcript (for
example *Anna* with *Participant 1*) before it is translated, summarised or added to a project. They step through the
matches as in Word, or replace them all after a confirmation. It is the first, manual, way to take personal names out
of a transcript before it reaches Claude or Gemini; finding them automatically (NVIDIA's GLiNER PII model) stays in
[future.md](future.md) F5. Both builds get it.

**Status of the plan:** planned on 2026-11-20 from the maintainer's answers (DECISIONS.md **D59**). All UI text here is
a draft (D13).

**Depends on:** Phase 9 (Edit text) and D39 (English that is out of date). Nothing in Phases 33–37.

**Read first:**
- DECISIONS.md D13, D18, D19, **D39**, T4, T12, T19, and **D59** (below);
- [Phase 9](09-edit-text.md), its Handoff included: `editTurnText`, the debounced save, why `Turn.words` no longer
  match an edited turn;
- `src/domain/transcript.ts`, `src/domain/translation.ts` (`staleTurnIds`, `turnSourceHashes`),
  `src/domain/corpus/normalize.ts` (`wordsWithOffsets`, `normalizeForMatch`);
- `src/stores/transcript.ts` (`editTurnText`, `renameSpeaker`, the save), `src/ui/views/OutputView.vue`,
  `src/ui/components/ConfirmDialog.vue` and `src/ui/composables/useModalDialog.ts`, `TurnList.vue` (*Changed since
  translation*);
- `tests/e2e/edit.e2e.ts`, `tests/e2e/large-transcript.perf.ts`.

## What the maintainer decided (2026-11-20)

The answers to the planning questions, recorded in D59.

1. **A modal dialog opened from the Output page.** Nothing on Setup, Project or Settings.
2. **It changes the turns' text: the Original, and the English translation.** Not the speaker labels (the speaker
   panel renames them already) and not the recording's file name.
3. **Only the version on screen.** In the Original view the dialog searches the original text; in the English view, the
   English text. To change both, the user replaces in one, switches the view, and replaces in the other.
4. **One name at a time.** One **Find** box and one **Replace with** box. Nothing is saved: the boxes are empty, or
   start from the selection (below), each time the dialog opens.
5. **Whole words, any case, any accents.** *Anna* finds *anna* and *ANNA* but not *Annabel*; *Zoe* finds *Zoë* and
   *Muller* finds *Müller*.
6. **The dialog lists every match in context, and the user steps through them like Word:** **Next**, **Replace** and
   **Replace all**.
7. **Replace all asks first** ("Replace all 14?"). There is no undo.
8. **The page behind the dialog doesn't move.** The list, with each match's speaker, time and the words around it, is
   enough.
9. **The replacement must have text.** Replace and Replace all are disabled until **Replace with** has some.
10. **The machine's word list is changed too.** A replaced name is gone from `Turn.words` as well as `Turn.text`, so it
    isn't left in the autosave or the project folder's session file.
11. **A summary made before is left alone.** A text change already shows it as out of date, as after any edit; the user
    makes it again.

## Decided in this file (the maintainer can change them)

1. **Matching uses the search's words** (T12, T19): `wordsWithOffsets` from `domain/corpus/normalize.ts`, so case,
   accents, `ß`/`ss`, typographic quotes and punctuation are ignored, and scripts without spaces are split by
   `Intl.Segmenter`. A match is a run of consecutive words equal to **Find**'s words.
   - So *Anna's* is a match for *Anna* (apostrophes separate words) and becomes *Participant 1's*. *Anna-Lena* is a match
     too, since hyphens separate words; the list shows it, and the user presses **Next** to keep it.
   - In a name of several words (*Anna Schmidt*) only whitespace may come between the words in the text: *Anna,
     Schmidt* is not a match.
   - **Find** with no letters or digits in it has no matches.
2. **The replacement goes in exactly as typed**, trimmed at both ends. Its case isn't adapted to the match. Replacing
   *anna* with *Anna* is allowed, and fixes the case.
3. **The matches are found once per search, not again after each replacement.** The list is a snapshot taken when
   **Find** changes (debounced, about 150 ms). A replaced match leaves the list; a skipped one stays. So a replacement
   that contains the name (*Anna* → *Anna B.*) can't match again and loop. Later matches in the same turn still point at
   the right text after an earlier one in that turn is replaced.
4. **Next and Replace move on, and wrap.** **Next** makes the following remaining match current, back to the first after
   the last. **Replace** replaces the current match and moves on. Clicking a row in the list makes it current. **Enter**
   in **Find** or **Replace with** is **Next**.
5. **Replace all asks inside the dialog,** not in a second dialog on top: the buttons give way to "Replace all 14?" with
   **Cancel** and **Replace all**. Focus starts on **Cancel**, as `ConfirmDialog` does for an action that can't be
   undone. It replaces every remaining match in one new doc and one save.
6. **English and D39.** A replacement in the Original changes the turns' text, so those turns show *Changed since
   translation* in the English view, and **Update English…** (or Add to project's pipeline) translates them again, from
   the text with the name replaced. A replacement in the English view changes only `translations.en.texts`; its
   `sourceHashes` stay as they are, so it doesn't make a stale turn current. This costs a re-translation of the changed
   turns; the maintainer chose it over treating a turn as current when its English has no match left (2026-11-20).
7. **The word list (decision 10).** Only the Original has words.
   - A word-run match in `Turn.words` uses the same matcher over each `Word.text`, and may start and end inside a word
     (*Anna's*). The first word of the run becomes the text before the match + the replacement + the text after it,
     with `start` of the first word, `end` of the last and `logprob: null`. The other words of the run are removed.
   - **Replace** changes, in that turn's words, the occurrence with the same index as the replaced text match, when the
     words had as many occurrences as the text did; otherwise every occurrence in that turn's words. (Words and text
     differ after Edit text, and erring towards removing the name is the safe side.)
   - **Replace all** changes every occurrence in every turn's words, also in turns whose text no longer has one.
8. **When it's offered:** the **Find and replace** button sits beside **Edit text**, and is hidden (D13: hidden, not
   disabled) while editing, while a translation runs, while the pipeline works on this transcript, and when there are
   no turns, as **Edit text** is.
9. **A selection starts the search.** If, when the dialog opens, the user has text selected inside one turn's text, it
   fills **Find** (one line, at most 100 characters). Otherwise **Find** is empty. Focus goes to **Find**.
10. **The English view says so.** The dialog's title is **Find and replace**; in the English view a line under it reads
    "In the English translation". The Original needs no such line.

## Tasks

1. **Record the decision** (first, on branch `phase-38-replace-names`)
   - `docs/DECISIONS.md`: add D59 (below) under *Later decisions*.
   - `docs/ROADMAP.md`: Phase 38 is in the §7 table already (set it to ◐ while building). Add to §2's in-scope list:
     "Find and replace names in a transcript (Phase 38)".
   - `docs/phases/future.md`: add **F5 — Finding personal data**: NVIDIA's GLiNER PII model, or another, suggesting
     names and other personal data for this dialog to replace. Also the parts this phase leaves out (see *Out of
     scope*).

   ```md
   ### D59 — Find and replace names, by hand (2026-11-20; Phase 38)
   - **Decision** (maintainer, answering Phase 38's planning questions): a **Find and replace** dialog on the Output
     page replaces one name at a time in the version on screen (the Original or the English). Matching is by whole
     words, ignoring case and accents. The user steps through the matches (Next, Replace) or replaces them all after
     a confirmation; there is no undo. A replacement in the Original also changes the machine's word list. Speaker
     labels, the file name and summaries are not changed.
   - **Why:** colleagues need to take participants' names out of a transcript before it is sent to Claude or Gemini.
     Reading through and editing each turn is slow and misses some. Finding names automatically (future.md F5) is
     later work; this is the manual step it will feed.
   - **Consequences:**
     - `Turn.text`, `Turn.words` and `translations.en.texts` change; the stored shape doesn't, so D18 doesn't apply.
     - `Turn.words` no longer always hold the machine transcription: a replaced word has the replacement and
       `logprob: null`. Anything that reads words (F1, word highlighting) must allow for that, as for D19.
     - A replacement in the Original makes those turns' English out of date (D39), and a summary out of date, as any
       edit does.
     - Names stay in the audio, the speaker labels, the file name and the glossary terms saved with the request.
   ```

2. **`src/domain/replace.ts`** (pure, with `replace.spec.ts`)
   - `findMatches(texts, find)`: the matches of `find` in an ordered list of `{ turnId, text }`, each as
     `{ turnId, start, end }` (offsets in that text), in transcript order. Decision 1's rules. No matches for a `find`
     without words.
   - `replaceInText(text, matches, replacement)`: the text with those ranges replaced (applied from the end, so
     offsets hold).
   - `replaceInWords(words, find, replacement, which: 'all' | number)`: decision 7. Returns the same array when
     nothing changes.
   - `snippet(text, match)`: about eight words either side of the match, with `…` where it's cut, as
     `{ before, match, after }`, so the dialog can mark the match without `v-html`.
   - Reuse `wordsWithOffsets` and `normalizeForMatch`; don't write a second normaliser.
3. **`stores/transcript.ts`: `replaceMatches(version, matches, replacement, find)`**
   - `version` is `'original'` or `'en'`. Trims `replacement`; does nothing for an empty one or no matches.
   - Replaces the doc immutably (T4): new objects only for the turns that change (`{ ...turn, text, words }`), every
     other turn keeps its identity, so `v-memo` skips it. For `'en'`, a new `translations.en` with a new `texts`
     object and the same `sourceHashes`.
   - `matches` from one turn are applied together. For `'original'`, `which` for the words is the match's index among
     that turn's matches when one match is replaced, and `'all'` for Replace all (decision 7, including turns with no
     text match).
   - Uses the existing debounced save, so the `pagehide` flush and the project folder's save cover it.
4. **`src/ui/components/ReplaceDialog.vue`** (native `<dialog>` through `useModalDialog`)
   - Props: `open`, `version`, `initialFind`. Emits `close`. It reads the doc and calls `replaceMatches` through the
     transcript store, as `OutputView` would.
   - Layout: title (and the English line, decision 10); **Find** and **Replace with** as labelled inputs; the count
     ("3 of 14", or "No matches" once **Find** has text and none were found); the list; then **Next**, **Replace**,
     **Replace all** and **Close**.
   - The list: one row per remaining match, a `<button>` showing the time, the speaker's label and the snippet with
     the match in `<mark>`. The current row has `aria-current="true"`, a visible highlight, and is scrolled into view
     inside the list only. The list scrolls within the dialog; the dialog fits a 375 px wide window.
   - **Replace all**: the inline confirmation (decision 5). After it the list is empty and the count reads "14
     replaced".
   - Announce through a visually hidden `aria-live` region what a screen reader can't see happen: the current match
     after **Next** or **Replace** ("3 of 13: Speaker 1, 00:04:10"), and "14 replaced".
   - Escape and **Close** close it. Closing returns focus to the **Find and replace** button. Matches are plain
     arrays, never reactive deeply (rule 8).
5. **`OutputView.vue`**
   - The **Find and replace** button beside **Edit text** (decision 8). It opens the dialog with `version` from
     `transcript.view` and `initialFind` from the selection (decision 9).
   - `OutputView.spec.ts` covers when it's shown.
6. **Performance:** extend `tests/e2e/large-transcript.perf.ts` (2,209 turns) with:
   - typing a name into **Find** to the list painted: target < 100 ms after the debounce, like a keystroke;
   - **Replace all** of a name in most turns to the transcript repainted: target < 1 s, like render.

   Record the numbers in `docs/TESTING.md` (Performance) and the Handoff. If a target is missed, ask the maintainer
   before changing the design (the fallback is a list that shows only the first 200 rows and the count).
7. **User docs:**
   - `docs/USER_GUIDE.md`: in *4. Correct the text*, a short "Replace a name" part: the dialog, Next / Replace /
     Replace all, that it works on the version on screen, and that the English needs its own pass. In *9. Privacy*:
     replace names **before** translating or adding to a project, since both send the text to Claude or Gemini; names
     stay in the audio, the speaker labels and the file name.
   - `docs/TESTING.md`: a manual checklist row: replace a name in the Original and the English → reload → export → the
     `.docx` has the replacement; Add to project → the session file has no trace of the name in its words.
   - `CHANGELOG.md`: an *Added* entry under *Unreleased*.

## Contracts introduced

```ts
// src/domain/replace.ts
export interface TextMatch { turnId: string; start: number; end: number }
export function findMatches(texts: readonly { turnId: string; text: string }[], find: string): TextMatch[];
export function replaceInText(text: string, matches: readonly TextMatch[], replacement: string): string;
export function replaceInWords(
  words: readonly Word[], find: string, replacement: string, which: 'all' | number,
): Word[];
export function snippet(text: string, match: TextMatch): { before: string; match: string; after: string };

// stores/transcript.ts (addition)
/** Replaces the matches in the Original (text and words) or the English. Ignores an empty replacement. Debounced save. */
replaceMatches(version: TranscriptVersion, matches: readonly TextMatch[], replacement: string, find: string): void;

// ReplaceDialog.vue
props: { open: boolean; version: TranscriptVersion; initialFind?: string }    emits: { close: [] }
```

(`find` goes to `replaceMatches` for the word list, which is matched on its own.)

## Acceptance criteria

- [ ] **Find and replace** on the Output page opens the dialog, with focus in **Find**; text selected in a turn fills
      it. The button isn't offered while editing, translating, during the pipeline's work, or without turns.
- [ ] Typing a name lists every whole-word match in the version on screen, ignoring case and accents, each with its
      time, speaker and the words around it. *Annabel* is not a match for *Anna*; *Müller* is for *Muller*.
- [ ] **Next** moves through the matches and wraps. **Replace** replaces the current one and moves on. A skipped match
      stays in the list.
- [ ] **Replace all** asks "Replace all 14?" first, and Cancel changes nothing. After it, no match is left.
- [ ] Replace and Replace all are disabled until **Replace with** has text.
- [ ] A replacement in the Original changes those turns' text and their words; speakers, times and the number of turns
      don't change. After a reload the change is still there. The Original `.docx` has it.
- [ ] In the English view the dialog says so and changes only the English; the English `.docx` has it, and the Original
      is unchanged.
- [ ] After a replacement in the Original, the English view shows those turns as *Changed since translation*.
- [ ] In a project, the session file's text and words have the replacement, and the summary shows as out of date.
- [ ] Keyboard only: Tab reaches every control, Enter is Next, Escape closes and focus returns to the button. The axe
      spec passes with the dialog open, and the current match is announced.
- [ ] The performance targets are met on the large fixture, and the numbers are recorded.
- [ ] D59, ROADMAP, future.md F5, USER_GUIDE, TESTING and CHANGELOG are updated.

## Required tests

- `domain/replace.spec.ts`:
  - `findMatches`: case, accents (*Zoë*, *Müller*), `ß`; whole words (*Annabel* not, *Anna's* and *Anna-Lena* yes);
    two-word names with one or more spaces, and not across a comma; a `find` of punctuation only; several matches in
    one turn; transcript order; a script without spaces (a Japanese name).
  - `replaceInText`: several ranges in one turn keep their offsets; text around is untouched.
  - `replaceInWords`: a one-word name; a two-word name merged into one word with the first `start` and last `end`;
    punctuation kept (*Anna,* → *Participant 1,*); `which` as an index and as `'all'`; the index falling back to all
    when the counts differ; the same array back when nothing matches.
  - `snippet`: cut with `…` at both ends; a match at the start or end of the turn.
- `stores/transcript.spec.ts`: `replaceMatches`
  - only changed turns are new objects (`toBe` on the others);
  - `'original'` changes text and words, not speakers, times or translations;
  - `'en'` changes only `translations.en.texts`, and `sourceHashes` stay;
  - after an Original replacement, `staleTurnIds` has those turns;
  - an empty replacement or no matches leaves the same doc and doesn't save;
  - the save is debounced (fake timers).
- `ReplaceDialog.spec.ts`: the list and count as **Find** changes (fake timers for the debounce); **Next** wraps;
  **Replace** removes the row and moves on; clicking a row makes it current; Enter is Next; the inline confirmation and
  its Cancel; the buttons disabled without **Replace with**; the English line only for `'en'`; the live region's text.
- `OutputView.spec.ts`: the button's visibility (editing, translation running, pipeline working, no turns); the dialog
  gets the view's version; a selection fills **Find**.
- `tests/e2e/replace.e2e.ts`:
  - step through with Next and Replace, then Replace all with its confirmation;
  - the change survives `reloadApp`;
  - the Original `.docx` has the replacement (reuse the JSZip reading in `export.e2e.ts`);
  - with a mocked translation: replace in the English view, the English `.docx` has it, the Original doesn't change;
    replace in the Original, those turns show *Changed since translation*;
  - in a project (the mocked folder in `projectFolder.ts`): the session file's words no longer contain the name.
- `tests/e2e/a11y.e2e.ts`: the Output page with the dialog open.
- `tests/e2e/large-transcript.perf.ts`: the two measurements.

## Out of scope

- Finding names or other personal data automatically (future.md F5).
- Several names at once, or a saved list of names, per project or on this computer.
- Speaker labels, the recording's file name, and the glossary terms saved in `request.keyterms`.
- Summaries, quotes and chats already in a project, and the project's other sessions.
- Undo, a match-case or regex option, and highlighting the match in the transcript behind the dialog.
- The audio, which still has the names.

## Handoff

*(Performance numbers, UI text trimmed under D13, and any change to the decisions above.)*

**2026-11-20, planning:** the maintainer kept D39 as it is (decision 6): replacing a name in both versions leaves those
turns flagged and re-translated by **Update English…** or Add to project. If the cost or the flags bother colleagues
later, the alternative was: a replacement in the Original keeps a turn current when its translation was current and its
English has no match for **Find** left.

**2026-11-20, Tasks 1–3 (`domain/replace.ts`, `replaceMatches`):**
- **Two contract changes** (the maintainer, 2026-11-20):
  - `replaceInWords(…, which: 'all' | { index: number; of: number })`. `of` is the number of matches in the turn's
    text, so `replaceInWords` can fall back to every occurrence itself when the words have a different number (or the
    index is out of range).
  - `replaceMatches(version, matches, replacement, find, scope: 'one' | 'all')`. **Replace** passes `'one'` and
    **Replace all** passes `'all'`, even when only one match is left. `'all'` also changes the words of turns whose
    text has no match.
- **Decision 1, made exact:** between Find's words, the text must have what Find has once both are normalised
  (`normalizeForMatch`). Whitespace normalises to nothing, so a space in Find matches any whitespace, or none in
  scripts without spaces, but not *Anna, Schmidt*. An apostrophe or hyphen typed in Find must also be in the text, in
  any typographic form: Find *Anna's* finds *Anna’s*.
- **`shiftMatches(remaining, replaced, replacement)`** is an extra export for the dialog (Task 4, decision 3). It drops
  the replaced match and moves the later matches in its turn. The dialog should keep its snapshot with it, not search
  again.
- **The store checks each match against the doc as it is now** (`findMatches` on that turn's current text) and skips a
  match whose offsets no longer point at Find. That check also gives `{ index, of }`. A replacement that changes
  nothing (*Anna* for *Anna*) leaves the doc and doesn't save. The replacement is cleaned with `cleanTurnText` (D19).
- **Words:** they are matched in the turn's words joined by single spaces. In a script without spaces, the joined
  words can be segmented differently from the turn's text, and then the counts differ and Replace changes every
  occurrence in that turn's words (the safe side).
- **The ASCII prefilter:** `matchString` runs only on ASCII text, before the word walk. Measure it in Task 6.

**2026-11-20, Tasks 4–5 (`ReplaceDialog.vue`, the button on Output):**
- **The list is a listbox, not a column of buttons** (changes Task 4's "a `<button>` … `aria-current`"): `role="listbox"`
  named *Matches*, one `role="option"` per match, `aria-selected` on the current one, and one Tab stop through
  `useRovingListbox` (arrows, Home, End; Enter or Space makes a row current), as the session list does. Hundreds of
  matches would otherwise be hundreds of Tab stops before **Next**. Next and Replace move the Tab stop to the new
  current match.
- **The dialog keeps the Find it searched for** (`searchedFor`) and passes that to `replaceMatches`, so a Replace
  pressed while a new Find is still waiting for its debounce works on the list shown. **Enter** in **Find** while a
  search is waiting searches at once (and announces the first match) instead of moving on.
- **In the English view only turns with their own English are searched.** A turn without one shows its Original in
  the list, and `replaceMatches('en')` leaves it, so listing it would offer a Replace that does nothing.
- **The dialog shifts its snapshot by the cleaned replacement** (`cleanTurnText`), the text the store puts in.
- **UI text and behaviour (D13), in the plan the maintainer approved (2026-11-20):**
  - The button reads **Find and replace…**, with the ellipsis the app's other dialog buttons have.
  - When Replace empties the list, the count reads "3 replaced", as after Replace all, not "No matches". The count is
    of replacements since **Find** last changed.
  - After Replace all, focus goes to **Find**, ready for the next name.
  - A selection longer than 100 characters, on more than one line, or across turns leaves **Find** empty rather than
    cut short.
  - The live region doesn't say the count when a typed search settles; only after Next, Replace, Replace all, and
    Enter's immediate search. Revisit if a screen-reader user finds that thin.
- **Layout:** the list scrolls inside the dialog (`max-height: 40vh`), and the current row is kept in view by setting
  the list's `scrollTop`, so the page never moves. Checked in Chromium at 1265 px and 375 px wide with an axe run on
  the open dialog (no serious violations); the e2e spec and the a11y entry are still Task 6/required tests.
- **A closed dialog holds nothing:** closing clears Find, the rows and the English line. Left in the page, they were
  found by `getByText` (which counts hidden elements) and broke `project-add.e2e.ts`; they would also leave the
  names in the DOM.
- **A flaky e2e test, not fixed, and not from this phase:** `a11y.e2e.ts` *Project: every state…* sometimes times out
  (30 s) on the Analyse click after `page.reload()` in a full run. Run as 12 copies at once it failed 12 of 12 both
  with the Output change and with `OutputView.vue` from before it (`a8a88a3`) (2026-11-21), so it is load, not
  Phase 38. It passes alone. Give it `test.slow()`
  or split it.
- **Not done here:** `tests/e2e/replace.e2e.ts`, the a11y spec's dialog state, the performance measurements (Task
  6), and the user docs (Task 7).

**2026-11-21, Task 6 (performance):**
- **The targets are met at 1× on the 3-hour fixture** (2,209 turns): Find's list of 1,545 matches painted 67–80 ms
  after the 150 ms wait (target < 100 ms), and Replace all of them 177–187 ms (target < 1 s). At 4× CPU (reported
  only): 302 ms and 218 ms. The full table is in `docs/TESTING.md` (Performance).
- **The first run missed Find's target: 139–155 ms.** The search wasn't the cost (`findMatches` about 3 ms in Node,
  the snippets 1.5 ms, and the ASCII prefilter as planned); laying out 1,545 rows was. `content-visibility: auto` on the
  rows (with `contain-intrinsic-size: auto 4.25rem`) brought it under the target, so the design's fallback (only the
  first 200 rows) wasn't needed and the maintainer wasn't asked to change it. Rows out of view keep an estimated
  height until scrolled to, so a row's `offsetTop` far down the list is approximate until it has been shown once;
  keeping the current row in view still works, since the row itself is laid out when it's measured.
- **The fixture has a name now:** `scripts/make-large-fixture.mjs` puts *Anna,* in place of the first word of 7
  utterances in 10. The word count, timings and the random sequence are unchanged, so the earlier measures stay
  comparable.
- **`tests/e2e/project.perf.ts` fails in this working tree, before and after Phase 38:** after the reload it waits
  for **Reconnect**, which doesn't come. It fails the same with `OutputView.vue` from before this phase (`a8a88a3`),
  so it isn't from Phase 38; not looked into further (rule 10).

**2026-11-21, Task 7 (user docs):**
- `USER_GUIDE.md`: *Replace a name* under *4. Correct the text* (a selection fills Find; whole words, case and
  accents; Next, Replace, Replace all and no undo; the version on screen, so the English needs its own pass; what keeps
  the name), and a **Names** bullet in *9. Privacy*. Beyond the phase's draft, it says that the speaker names and the
  glossary go to Claude or Gemini with a translation too, so rename the speakers and leave names out of the glossary.
- `TESTING.md`: manual checklist row 23. `CHANGELOG.md`: an *Added* entry under *Unreleased*.
- `ROADMAP.md`: Phase 38 stays ◐. **Left for the phase to be done:** `tests/e2e/replace.e2e.ts` (the *Required tests*
  list) and the dialog's state in `tests/e2e/a11y.e2e.ts`, then the Definition of Done run and the spec tables in
  `TESTING.md` (`replace`, and `ReplaceDialog` among the components).

**2026-11-21, the e2e tests and the Definition of Done:**
- `tests/e2e/replace.e2e.ts` (4 tests). ElevenLabs answers the German fixture with *Anna* in three turns, in three
  cases, and *Annabel* in a fourth (`namedFixture()`, changed in the spec, not in `fixtures/`). Step through and Replace
  all, with the saved words and the `.docx`; the keyboard; the English view and the Original's out-of-date turns; and a
  project, through **Add to project**, whose session file loses the name from text and words and whose summary goes
  out of date. `a11y.e2e.ts` checks the open dialog and its Replace all confirmation on Output.
- **Definition of Done (2026-11-21):** typecheck, lint, 2,146 unit tests, build and `verify:single-file`, and
  `cargo test` (114 passed, 4 opt-in ignored) pass. `test:e2e`: 161 of 162 passed; the one failure was
  *Project: every state…* in `a11y`, the intermittent one `TESTING.md` records, which fails the same without this
  phase. `test:perf`: both of this phase's targets met (above); `project.perf.ts` fails without this phase too.
- **Every acceptance criterion is met by the tests above,** except what only a person can check: manual row 23
  (a real transcript, OneDrive). D13 review: the UI text is the plan's, trimmed as recorded under Tasks 4–5.
- **Not committed on `phase-38-replace-names`:** Tasks 1–5 went into the maintainer's commit `151dde1` on
  `phase-37-local-stt-gpu` with Phase 37; Tasks 6 and 7 and the e2e tests are uncommitted on that branch.

**2026-11-21, fixes from an audit of this phase:**
- **`replaceInWords` with several matches in one run of words:** it rebuilt each match from the original word, so
  with two matches in one word (`Anna-Anna`, or `田中さんと田中` from a speech engine that gives longer words) the
  second one stayed, and matches sharing a word (*Anna Lena* in `Anna` · `Lena-Anna` · `Lena`) brought the name back
  and lost the last end time. Matches that share a word are now replaced together, in one new word.
- **A name only the words still have** (after Edit text took it out of the text) could not be removed: Find said
  "No matches" and Replace all was disabled, so the name stayed in the autosave and the session file (decision 10).
  Now, once the list is empty, the count reads "N left in the saved word timings" and Replace all ("Replace all N?")
  takes them out. Replacing the last match with **Replace** does the same without asking, since every match the text
  showed has then been replaced. UI text new here (D13): "N left in the saved word timings".
- **Changes decision 7's last point:** Replace all changes the words of a turn without a listed match only when its
  words have more occurrences than its text (`hiddenInWords`), and every occurrence in the words leaves out those
  inside an exact occurrence of the replacement (`withoutReplacements`). Before, Replace all after a Replace whose
  replacement contained Find (*Anna* → *Anna B.*) turned those words into *Anna B. B.*. Still not covered: a match
  kept with **Next** keeps the list from emptying, so a name only the words have elsewhere stays until Replace all.
- **Focus:** after the last **Replace** (Replace is disabled then) focus goes to **Find**, as after Replace all.
  **Replace all** pressed while a Find waits for its debounce searches first, and asks about what that Find finds,
  so the search can't take the confirmation (and the focused **Cancel**) away a moment later.
- **`replaceMatches` returns how many matches it replaced** (one that already reads as the replacement counts). When a
  Replace or Replace all skips a match whose text no longer reads as Find, the dialog no longer counts it or shifts
  the turn's other rows; it lists that turn's matches again from its text (`relist`), leaving out those inside the
  replacement.
- **The dialog's look (2026-11-21), picked from three design variants:** Find and Replace with are one bordered block
  with a hairline between them and their labels beside the fields; Close is an × in the corner (aria-label "Close");
  the count shares the bottom row with the actions; **Replace** is the one filled button and comes last, after **Next**
  and **Replace all**; the list is a grey tray whose current match sits on white, with no coloured edge. Tab order is
  now Close, Find, Replace with, the list, Next, Replace all, Replace. `useSmoothHeight` is unchanged.
