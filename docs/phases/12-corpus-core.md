# Phase 12 — Corpus core: session text, keyword search, quote check

**Goal:** The pure TypeScript that every later phase searches and quotes with:
- a light text-only view of a transcript (`SessionText`);
- a normalisation shared by search and quotes;
- a query parser and a scan-based keyword search over many sessions;
- the quote check that decides whether a quote really is in a turn.

No UI, no storage, no network.

**Depends on:** nothing. It can run alongside Phases 10 and 11. Phases 13 and 16 start when this phase is done.

**Read first:** [PROJECTS.md](../PROJECTS.md) §3, §4, §5.4, §5.5 (quote format and check); [DECISIONS.md](../DECISIONS.md)
D19, D21, D22, T4, T5, T12, T13; `src/domain/transcript.ts`; `src/testing/transcriptDoc.ts`.

## Decided in this file (the maintainer can still change them)

- **Search is a scan, not an index** (T12). The budget is 200 ms per query on 300 hours. Phase 14 checks it in the
  browser. This phase measures it in Node with a benchmark.
- **Matching works on words.** Case, accents and punctuation are ignored, so "Hörgerät", "horgerat" and "Hörgerät,"
  all match. There is no stemming: the agent and the researchers use `prefix*` and variants.
- **The English text of a turn** is its translation (`translations.en.texts[id]`) if the session has one, or the
  turn text for an English session. A German or French session without a translation has no English text yet.
- **A verified quote shows the transcript's words, not the model's.** The check returns the matched span of the
  turn's own text.

## Tasks

1. **`domain/hash.ts`**: `hashText(text)` and `hashParts(parts)`. A small, fast, non-cryptographic 53-bit hash
   (cyrb53, or similar), returned as hex. It's used only to notice changes, never for security. `hashParts` joins
   with `\u0000`, so `['ab','c']` and `['a','bc']` differ.
2. **`domain/corpus/sessionText.ts`**
   - `toSessionText(doc)` keeps what search, cards and quotes need and drops the word timings (contract below).
   - `transcriptHash(doc)` covers the speaker labels and every turn's id, speaker, text and English text. A
     rename, a text edit or a new translation changes it; a playback or view change doesn't.
   - `englishText(session, turn)` returns the English text as defined above, or `null`.
   - `isTranslatedSession(session)` is true when the language isn't English and a translation exists.
3. **`domain/corpus/normalize.ts`**
   - `normalizeForMatch(text)`: NFKD, combining marks removed, lower case, `ß` → `ss`, typographic quotes and
     dashes made plain, whitespace collapsed.
   - `wordsWithOffsets(text)` returns the words (runs of `\p{L}`/`\p{N}`), normalised, each with the start and end
     offset of the word in the *original* text. Search snippets and quote spans map back through these offsets.
   - **Apostrophes and hyphens separate words** (maintainer, 2026-10-19; this replaces "an inner apostrophe is
     allowed"). "doctor" finds "doctor's" and "appareil" finds "l'appareil". A typed `don't` is the phrase
     `don t`, so it still finds "don't".
4. **`domain/corpus/query.ts`**: `parseQuery(input)` returns a `Query` or a `QueryError` with a short message.
   - Words separated by spaces must all appear in the turn (AND).
   - `OR` (upper case) between two terms makes them alternatives, and binds tighter than AND: `charg* night OR
     evening` means `charg*` AND (`night` OR `evening`).
   - `"exact phrase"` matches consecutive words. `word*` is a prefix (at least 2 letters before `*`). `-word` and
     `-"phrase"` exclude a turn.
   - No parentheses. A query with nothing but exclusions, or an empty one, is an error.
   - Terms are normalised like the text. NFKD turns "ö" into "o", not "oe", so `Hörgerät` matches "Horgerat" but
     not "Hoergeraet". The Phase 16 tool description tells the agent to add such spelling variants itself.
5. **`domain/corpus/search.ts`**
   - `prepareCorpus(sessions)` builds a `SearchableCorpus` once: per session, the normalised English and original
     texts with their word offsets. Rebuilt only when the sessions change.
   - `search(corpus, query, options)` scans and returns hits grouped by session (contract below):
     - Sessions are ordered by hit count, then by date, newest first. Hits are in turn order.
     - A snippet is about 12 words either side of the first match in the turn, cut at word boundaries with `…`,
       taken from the original text. Its `marks` are the matched ranges within the snippet.
     - `field: 'both'` reports a turn once. The English hit is preferred when both texts match.
     - Paging uses `offset` and `limit`, counted in sessions. `maxHitsPerSession` caps the hits listed per
       session; `hitCount` stays the full count.
     - It is fast enough to call on every keystroke after a short debounce (Phase 14).
6. **`domain/corpus/quoteCheck.ts`**: `checkQuote(turnText, quote)`
   - Remove straight or typographic quotation marks around the quote.
   - Split at `…`, `...` and `[…]`/`[...]`. Each part must be non-empty, and must match a run of consecutive words
     in the turn (compared with `wordsWithOffsets`). The parts must appear in order.
   - Return `{ status: 'verified', sourceText }`, where `sourceText` is the turn's own text for each matched run,
     joined with ` … `. Otherwise return `{ status: 'not_found' }`.
7. **`domain/corpus/sessionKeys.ts`**
   - `assignSessionKeys(sessions)` gives `s1…sN` in a stable order: recording date, then `sessionId`.
   - `parseRef('s12/t412')` returns `{ sessionKey, turnId }` or `null`.
8. **`domain/corpus/citation.ts`**: `formatCitation({ text, speakerLabel, start, sessionTitle, translatedFrom })`
   gives `"<text>" — <speaker>, <HH:MM:SS>, <session title>`, with ` (translated from <Language>)` when
   `translatedFrom` is set. It uses `formatTimestamp` and `languageName`. One quote is one line. `formatCitations`
   joins several with a blank line.
9. **`src/testing/corpus.ts`**: `makeCorpus({ hours, seed, languages? })` builds `TranscriptDoc`s, deterministic and
   seeded like `scripts/make-large-fixture.mjs`:
   - sessions of 1–3 hours;
   - several speakers;
   - a share of German sessions with a translation;
   - a few planted phrases (e.g. "charger by the bed") at known turns, so tests can assert exact hits.
10. **`src/domain/corpus/search.bench.ts`** and `"bench": "vitest bench --run"` in `package.json`:
    - prepare a 300-hour corpus once;
    - benchmark five typical queries (a word, a prefix, a phrase, an OR, and an exclusion) over `both`.

    Record the numbers in `docs/TESTING.md` (Performance) and in the Handoff. If a query takes over 200 ms, try a
    faster scan first (one regex per session over joined text, with turn offsets, rather than per turn). Only then
    consider an inverted index, and ask the maintainer before adding one.
11. **Docs:** add a "Corpus" subsection to `docs/TESTING.md` and the bench command to AGENTS.md's command table.

## Contracts introduced

```ts
// domain/hash.ts
export function hashText(text: string): string;
export function hashParts(parts: readonly string[]): string;

// domain/corpus/sessionText.ts
export interface SessionTurn {
  id: string;
  speakerId: string;
  start: number;               // seconds
  text: string;                // original language
  en: string | null;           // the English translation; null for English sessions and untranslated ones
}
export interface SessionText {
  sessionId: string;           // TranscriptDoc.id
  recordingName: string;       // doc.source.fileName
  recordedAt: number;          // doc.source.lastModified (ms epoch)
  durationSec: number | null;  // result.audioDurationSec ?? source.durationSec
  languageCode: string;        // doc.result.languageCode
  speakers: Speaker[];
  turns: SessionTurn[];
  transcriptHash: string;
}
export function toSessionText(doc: TranscriptDoc): SessionText;
export function transcriptHash(doc: TranscriptDoc): string;
export function englishText(session: SessionText, turn: SessionTurn): string | null;
export function isTranslatedSession(session: SessionText): boolean;

// domain/corpus/query.ts
export type Query = { readonly kind: 'query' /* parsed form is internal */ };
export interface QueryError { kind: 'error'; message: string }
export function parseQuery(input: string): Query | QueryError;

// domain/corpus/search.ts
export type SearchField = 'english' | 'original' | 'both';
export interface SearchOptions {
  field: SearchField;
  sessionIds?: readonly string[];  // default: all
  maxHitsPerSession: number;
  offset?: number;                 // in sessions; default 0
  limit?: number;                  // sessions per page; default all
}
export interface SearchHit {
  turnId: string;
  start: number;
  speakerId: string;
  field: 'english' | 'original';
  snippet: string;
  marks: [start: number, end: number][];  // within snippet
}
export interface SessionHits { sessionId: string; hitCount: number; hits: SearchHit[] }
export interface SearchResult {
  totalHits: number;
  totalSessions: number;
  sessions: SessionHits[];
  nextOffset: number | null;
}
export function prepareCorpus(sessions: readonly SessionText[]): SearchableCorpus;
export function search(corpus: SearchableCorpus, query: Query, options: SearchOptions): SearchResult;

// domain/corpus/quoteCheck.ts
export type QuoteCheck = { status: 'verified'; sourceText: string } | { status: 'not_found' };
export function checkQuote(turnText: string, quote: string): QuoteCheck;

// domain/corpus/sessionKeys.ts
export function assignSessionKeys(sessions: readonly SessionText[]): Map<string, string>; // sessionId → 's1'
export function parseRef(ref: string): { sessionKey: string; turnId: string } | null;

// domain/corpus/citation.ts
export interface CitationParts {
  text: string;
  speakerLabel: string;
  start: number;
  sessionTitle: string;
  translatedFrom: string | null;  // language code of the original, when the text is a translation
}
export function formatCitation(parts: CitationParts): string;
export function formatCitations(parts: readonly CitationParts[]): string;
```

## Acceptance criteria

- [x] All the modules above exist, are pure (lint passes: no Vue, storage, DOM globals or features), and are
      fully unit tested.
- [x] Search on the generated corpus finds every planted phrase, with the right turn ids and times.
- [x] `npm run bench` runs, and its numbers are in TESTING.md. If a query takes over 200 ms, the Handoff says what
      was tried.
- [x] A quote with changed case, punctuation or accents verifies. A quote with one changed or added word does not.
      A quote with an omission marked `…` verifies, and its `sourceText` shows the omission.
- [x] `npm run typecheck`, `lint`, `test`, `build`, `verify:single-file` and `test:e2e` pass. The app is unchanged.

## Required tests

- `hash.spec.ts`: stable output, different for small changes, `hashParts` boundaries.
- `sessionText.spec.ts`:
  - English and German docs, with and without a translation.
  - `transcriptHash` changes on a rename, a text edit and a new translation, and not on anything else.
  - No words in the output.
- `normalize.spec.ts`: accents, `ß`, typographic quotes, apostrophes inside words, offsets into the original text
  (including after an NFKD expansion).
- `query.spec.ts`: every syntax form, the OR precedence, the errors (empty, only exclusions, `a*` too short, an
  unclosed quote).
- `search.spec.ts`:
  - the AND, OR, phrase, prefix and exclusion semantics;
  - English, original and both fields, and the both-fields preference;
  - session filter, ordering and paging;
  - snippets cut at word boundaries, with correct marks;
  - an empty corpus.
- `quoteCheck.spec.ts`: the cases in the acceptance criteria, plus quotes across a sentence boundary, a quote
  longer than the turn, `[…]`, and an empty quote.
- `sessionKeys.spec.ts`, `citation.spec.ts`: stable keys; citation format with and without a translation.

## Out of scope

- Reading files, caching and loading (Phase 14).
- The search box UI (Phase 14) and the agent's tools (Phase 16).
- Stemming, fuzzy matching, synonyms, an inverted index.

## Handoff

*(Benchmark numbers, the scan strategy chosen, any change to the contracts.)*

### 2026-10-19 — Phase 12 done (branch `phase-12-corpus-core`, based on `phase-11-home-modes` at `ccc2b23`)

**Benchmark and scan.** A per-turn scan meets the budget, so there's no joined-text scan and no index.
- `prepareCorpus` normalises every turn once into a `' w1 w2 … '` string, and a query is a few `includes` calls per
  turn.
- On the generated 300-hour corpus (148 sessions, 147,000 turns, 2.5M words), every query over `both` takes
  33–65 ms on average, with p99 at 75 ms or less. Node 22.19, the maintainer's PC. The full table is in
  TESTING.md (Corpus search).
- `prepareCorpus` takes about 405 ms for 300 hours, and `toSessionText` 42 ms. Vitest's module runner inflates
  the first figure.
- Run it with `npm run bench`. The script adds `--reporter=verbose`, because the default reporter printed no
  table when its output wasn't a terminal.
- Vitest 5 changed the bench API: benchmarks are registered inside a `test()` through its `bench` fixture
  (`search.bench.ts`).

**Changed from this file**
- **Apostrophes and hyphens separate words** (the maintainer's choice; task 3 above, DECISIONS T12). "doctor"
  finds "doctor's" and "appareil" finds "l'appareil". A typed `don't` is the phrase `don t`, and "don" also matches
  "don't".
- **`makeCorpus` returns `{ docs, planted }`**: `planted` lists each phrase's session, turn, time and field.
  - Turns have `words: []` unless `withWords: true` is passed. Phase 14's load test needs `withWords` for realistic
    file sizes.
  - `src/testing/corpus.ts` imports only domain types, so Playwright should be able to import it.
- **`checkQuote` ignores an ellipsis at the start or end** of a quote ("…charger by the bed"). It doesn't change
  which words must match. An empty part *between* two ellipses still fails.
  - `(…)` also counts as an omission mark.
  - `sourceText` keeps `.?!…` directly after a run, so "…at night?" keeps its question mark.
- **Snippets come from the text that matched**: the translation for an English hit, the turn text for an original
  hit.
  - "Taken from the original text" above meant the text as written, not normalised.
  - A snippet that reaches the start or end of the turn keeps the turn's punctuation there. A cut gets `…`.
- **`prepareCorpus` memoises each session** in a `WeakMap` keyed by the `SessionText` object. A rebuild after a
  rescan only normalises new sessions, if Phase 14 keeps the unchanged `SessionText` objects.

**Contract details added** (all inside the contracts above)
- `Query` carries `clauses` and `exclusions` of `TermPattern`s. They are internal to `domain/corpus`, and other
  code passes the `Query` to `search()` unchanged.
- `QUERY_MESSAGES` (drafts, D13):
  - "Type a word to search for.";
  - "Add a word to find, not only words to leave out.";
  - "Put at least 2 letters before *.";
  - "Close the quotation marks.";
  - "Put a word on both sides of OR."
- Query rules the file left open:
  - `OR` next to an exclusion is an error;
  - a term with no words (`!!!`, `""`) is ignored;
  - `*` inside quotation marks is punctuation;
  - `“ ” „ ‟ « »` work as quotation marks.
- `normalize.ts` also exports `matchString(text)`, the string the scan uses. `sessionText.ts` also exports
  `isEnglishSession(session)`. `search.ts` exports `SNIPPET_CONTEXT_WORDS` (12).
- `transcriptHash` covers the speakers (ids and labels), each turn's id, speaker, text and English text, and
  whether a translation exists. An English session's translation is ignored, as in `toSessionText`.

**For Phase 16** (agent tool description)
- Umlaut spellings need their own queries: `Hörgerät` finds "Horgerat" but not "Hoergeraet".
- There is no infix search: `Akku` doesn't find "Hörgeräteakku".
- A prefix works only at the end of an unquoted term.
