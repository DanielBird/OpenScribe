# Phase 26 — Recordings in more languages

**Goal:** A recording in any language ElevenLabs transcribes well can be chosen on Setup, and is named, translated to
English, exported and searched properly. Until now the app assumed English, German or French: the Language list
offered only those, `languageName()` named only those (Spanish came out as `SPA`, in the translation prompt too), and
keyword search took a whole Chinese, Japanese or Thai sentence as one word.

**Status of the plan:** asked for by the maintainer on 2026-11-01 (DECISIONS.md **D37**, **T19**). Phase 25 is the
desktop follow-up ([reference/desktop.md](../reference/desktop.md), "Input for Phase 25"), so this is 26.

**Depends on:** nothing unfinished. Land it before Phase 18 (the 2.0 release): see *Compatibility* below.

**Read first:**
- [DECISIONS.md](../DECISIONS.md) D5, D13, D18, T12, D37, T19;
- [reference/elevenlabs-stt.md](../reference/elevenlabs-stt.md): "Request fields DeScribe sends" and "Supported
  languages";
- the `claude-api` skill before touching `features/agent/instructions.ts` (CLAUDE.md).

## Agreed with the maintainer (2026-11-01)

- **The list:** Setup offers Auto-detect and only ElevenLabs' most accurate tier (≤ 5% word error rate, 36
  languages), A–Z by English name. Any other language still works through Auto-detect.
- **Also in this phase:** word search in scripts written without spaces (Chinese, Japanese, Thai, Lao, Khmer,
  Burmese), and the agent's token estimate for Chinese, Japanese and Korean text.
- **Not in this phase:** right-to-left display and export (Arabic, Hebrew, Persian, Urdu), and translating into any
  language other than English.

## Tasks

1. **`domain/transcript.ts`:** `normalizeLanguage()` canonicalises with `Intl.Locale` (ISO 639-2/3 → 639-1 where one
   exists: `spa` → `es`, `ger` → `de`, `en-GB` → `en`). `languageName()` names a code with `Intl.DisplayNames` in
   English; an unknown code still comes back in capitals. `LanguageHint` is `'auto'` or a normalised code.
2. **`providers/transcription/elevenlabs/languages.ts`:** `ELEVENLABS_LANGUAGES`, the tier's ISO 639-3 codes as the
   docs list them. `TranscriptionProvider.languages` holds them normalised. The request sends ElevenLabs' own code for
   the hint (`de` → `deu`; V5 showed both are accepted).
3. **`stores/settings.ts`, `storage/schemas.ts`:** the saved hint is any string, and settings fall back to Auto-detect
   for a code the provider doesn't list. The store exposes `languages` (`{ code, label }`, sorted by label).
4. **`ui/views/SetupView.vue`:** the list is Auto-detect followed by `settings.languages`.
5. **`domain/corpus/normalize.ts`:** a run of letters that contains Han, Hiragana, Katakana, Thai, Lao, Khmer or
   Myanmar is split into words with `Intl.Segmenter`. Search, queries, snippets and the quote check all share this
   walker. The ASCII fast paths don't change.
6. **`features/agent/limits.ts`:** `estimateTokens()` counts each Han, Hiragana, Katakana and Hangul character as a
   token. **`instructions.ts`:** "For sessions in another language" instead of "For German or French sessions".
7. **Docs:** D5, D37, T19; the reference doc (supported languages, V7); the User Guide, ROADMAP, PROJECTS.md,
   llm-providers.md and TESTING.md wording; `future.md` (right-to-left text).

## Compatibility

A transcript transcribed with one of the newly listed languages chosen on Setup has a `languageHint` older releases
don't accept. An older release then ignores it as the last transcript, and reports it as unreadable in a project
folder. Transcripts made with Auto-detect, English, German or French are unaffected, and newer releases read
everything older ones wrote. Project folders aren't released yet (2.0), so landing this before Phase 18 limits the
effect to the last transcript.

## Live checks (pending until the maintainer runs them)

- **V7:** ElevenLabs accepts `language_code` for a sample of the listed codes (`spa`, `jpn`, `nor`, `msa`) and returns
  the same language.

## Acceptance criteria

- [x] Setup lists Auto-detect, then the 36 languages A–Z. A saved English, German or French choice is kept.
- [x] Choosing Spanish sends `language_code=spa`.
- [x] A transcript ElevenLabs returns as `spa` reads "Spanish" in the header, the export dialog, the file name, the
      session list and the translation prompt ("from Spanish").
- [x] Searching a Japanese or Thai session's original text finds a single word, with the right marks.
- [x] The agent's token estimate for Japanese text is about one token per character.
- [x] `npm run bench` is no slower on the en/de/fr corpus.
- [x] Definition of Done in AGENTS.md, except the commit (waiting for the maintainer). No real API calls; V7 recorded
      as pending.

## Required tests

- `domain/transcript.spec.ts`: normalising and naming Spanish, Japanese, Norwegian, `en-GB`, an unknown code, `''`.
- `providers/transcription/elevenlabs/request.spec.ts`, `provider.spec.ts`: the code sent, the languages offered.
- `stores/settings.spec.ts`: a saved hint that is listed, one that isn't.
- `ui/views/SetupView.spec.ts`: the options and the summary.
- `domain/corpus/normalize.spec.ts`, `query.spec.ts`, `search.spec.ts`: Japanese and Thai words, offsets and marks.
- `features/agent/limits.spec.ts`: the estimate for English, Japanese and Korean text.
- `tests/e2e/setup.e2e.ts` (Spanish is sent), `tests/e2e/translate.e2e.ts` (a Spanish transcript end to end).

## Out of scope

- Translating into languages other than English.
- Right-to-left layout and Word export (`future.md` F4).
- Translating the UI.
- Listing languages below the top accuracy tier.

## Handoff

### 2026-11-01 — Phase 26 done (branch `phase-26-more-languages`, from `main`)

**Checks:** typecheck, lint, 1,658 unit tests, 134 e2e specs, build and `verify:single-file` pass. Not committed yet:
the maintainer commits when they're ready. Setup was also checked in the dev server: 37 options, and the closed
Options reads "Language: Japanese · Speakers: Auto".

**Benchmark** (`npm run bench`, `main` and this branch run back to back on the same machine): `prepareCorpus` 422 →
406 ms, searches 33–66 → 35–67 ms. That's the same within noise. A first baseline run earlier in the session was much
slower everywhere (673 ms), including `toSessionText`, which this phase doesn't touch, so it was discarded.

**Beyond the plan, found while testing Thai:** matching removed *every* combining mark, so the vowel signs of Thai,
Hindi, Kannada and Malayalam disappeared (ฉัน matched as ฉน). Kannada and Malayalam are on the new list, so
`normalize.ts` now removes only accents: `(?=\p{M})\p{Script=Inherited}` (Latin, Greek and Cyrillic accents, Arabic
vowel points, Japanese voicing marks) plus Hebrew points. `NON_WORD` keeps marks inside a word. Recorded in T19.

**Changed tests:** `fileName.spec.ts` expected `ita` to have no name; it is now "Italian" (and `zzz` keeps the code).
`request.spec.ts` now expects ElevenLabs' codes (`deu`, not `de`).

**For later phases:**
- **Compatibility (D37):** an older release ignores a last transcript, and can't read a project file, whose
  `languageHint` is a newly listed language. Ship this before or with 2.0 (Phase 18) and say so in the release notes.
- **V7** is pending: one short real recording each with language = Spanish, Japanese, Norwegian and Malay
  (TESTING.md manual row 21 covers it).
- **Right-to-left text** (Arabic, Hebrew, Persian, Urdu) arrives through Auto-detect but displays left-to-right, and
  the `.docx` doesn't mark it RTL: `future.md` F4 has the sketch.
- `languageName()` gives Chromium's English names. Mandarin comes back as "Chinese" and `nor` as "Norwegian". The
  Setup list shows those names too.
- Search: Japanese voicing marks still count as accents (ベッド matches ヘット), as before this phase. A one-letter
  prefix (`充*`) is refused like any other: two letters are needed before `*`.
