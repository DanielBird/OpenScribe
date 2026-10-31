# Phase 6 — English translation (Claude / Gemini)

**Goal:** On the Output tab, **Translate to English** sends the transcript text, never the audio, to Claude or
Gemini (the user chooses). It translates turn by turn and keeps speakers and timestamps. The user can switch the
view between Original and English and export either version. The translation is autosaved.

**Depends on:** Phase 1 for the core (LLM providers, batching, translate loop). Phases 4 and 5 for the UI.

**Read first:** [reference/llm-providers.md](../reference/llm-providers.md) (all of it), [DECISIONS.md](../DECISIONS.md)
D6, D7, T5, T6, T7. **Claude Code agents: load the `claude-api` skill before writing `claude.ts`.**

## Tasks

### Core (no UI)

1. **Dependencies:** `@anthropic-ai/sdk`, `@google/genai` (zod v4 is already installed since Phase 1). Build
   straight away and check that the single file still works. Record the size delta and any CSP or `eval` errors
   (L1, L2). Import zod only as `import { z } from '../../lib/zod'`, which already runs it in jitless mode for the
   CSP (DECISIONS T8). If an SDK pulls in its own copy of zod, check it doesn't trigger eval either. **Never** add
   `'unsafe-eval'`.
2. **`src/providers/llm/types.ts`:** the `LlmProvider` and `StructuredRequest` contract from the reference doc.
3. **`src/providers/llm/models.ts`**

   ```ts
   export const LLM_MODELS = {
     claude: { default: 'claude-opus-5-5', options: [
       { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
       { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' } ] },
     gemini: { default: 'gemini-3.8-flash', options: [
       { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
       { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
       { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (cheapest)' } ] },
   } as const;
   ```

4. **`src/providers/llm/claude.ts`:** `createClaudeProvider({ apiKey, model, fetch? })`.
   - Use `messages.parse` + `zodOutputFormat`. Set `output_config.effort` explicitly.
   - Handle `stop_reason === 'refusal'` and enable fallbacks as the `claude-api` skill directs.
   - Map typed SDK errors to `ProviderError`. Accept an injectable `fetch` for tests.
   - Optional `verifyKey()`: a minimal request (e.g. `max_tokens` small, a trivial prompt), or the models list
     endpoint if the SDK exposes it.
5. **`src/providers/llm/gemini.ts`:** `createGeminiProvider({ apiKey, model })`.
   - Use `generateContent` with a JSON-schema response (check the current field name). Validate the output with
     the zod schema and map errors.
   - Apply the REST fallback (T6) if bundling fails, and record it in DECISIONS.
6. **`src/features/translation/batching.ts`:** `makeBatches(turns, { maxChars = 6000, maxTurns = 60,
   contextTurns = 3 })`.
   - Turns are grouped in order. A single turn longer than `maxChars` gets its own batch.
   - Each batch carries the previous `contextTurns` turns as read-only context.
7. **`src/features/translation/prompt.ts`**
   - The system prompt:

     > You are a professional translator. Translate the transcript segments from {SourceLanguage} into natural,
     > faithful English.
     > - Translate every segment in `segments`. Return exactly one item per input `id`, using the same `id`.
     > - Do not merge, split, summarise, shorten, explain or omit anything. Keep the speaker's tone, hedges and
     >   informal style.
     > - Keep names, product names and the glossary terms exactly as written, unless a standard English form
     >   exists.
     > - `context` segments are earlier turns, provided only for understanding. Do not translate or return them.
     > - If a segment is already in English, return it unchanged.

   - `buildInput(batch, glossary, speakerLabels)` returns a JSON string
     `{ glossary: string[], context: {speaker, text}[], segments: {id, speaker, text}[] }`.
   - `TranslationBatchSchema = z.object({ translations: z.array(z.object({ id: z.string(), text: z.string() })) })`.
8. **`src/features/translation/translate.ts`:** `translateTranscript(doc, provider, opts)`.
   - Process the batches **sequentially**.
   - Validate each batch: the set of returned ids must equal the requested ids, and every text must be non-empty.
     On a mismatch or `bad_output`, retry the batch once. On a second failure, throw
     `TranslationError { completed: Record<turnId, text>, failedBatchIndex }` so the UI can resume.
   - Supports `resumeFrom` (a partial map) and `signal`. Reports `onProgress({ batch, totalBatches })`.
   - The glossary used is `doc.request.keyterms`. The source language is `languageName(doc.result.languageCode)`.

### UI

9. **`stores/translation.ts`:** `status: 'idle' | 'running' | 'error' | 'cancelled'`, `progress`, `error`,
   `partial`. `start(providerId, model)`, `cancel()`, `resume()`. On success it writes
   `doc.translations.en = { provider, model, createdAt, texts }` via the transcript store (immutable update +
   autosave) and switches `view` to `'en'`.
10. **`TranslateDialog.vue`**
    - Provider radio (Claude / Gemini) and a model select from `LLM_MODELS`.
    - Key status. If the key is missing, show an `ApiKeyField` inline, the same component and storage as Setup.
    - The data notice from the reference doc (provider-specific wording). A "Don't show again" checkbox is
      stored in prefs.
    - **Translate** starts. The dialog then shows *"Translating… batch 3 of 12"* with a progress bar and
      **Cancel**.
    - On error it shows the message and **Resume** (continues from the failed batch) or **Close**.
11. **`VersionToggle.vue`:** a segmented control *Original (German) | English*. The English option is disabled
    until a translation exists. `TurnList` passes the translated text when `view === 'en'`. Speaker labels and
    timestamps don't change.
12. **`OutputView` actions**
    - **Translate to English** is enabled when a doc exists, no translation job is running, and
      `normalizeLanguage(languageCode) !== 'en'`. When English is detected, the tooltip reads *"This transcript is
      already in English."*
    - If a translation already exists, the button reads **Re-translate…** and asks *"Replace the existing English
      translation?"*.
13. **Export:** the English option in `ExportDialog` is enabled (Phase 5 already supports it in the model).

## Contracts introduced

```ts
// src/features/translation/translate.ts
export interface TranslateOptions {
  signal?: AbortSignal;
  onProgress?: (p: { batch: number; totalBatches: number }) => void;
  resumeFrom?: Record<string, string>;
}
export class TranslationError extends Error {
  constructor(public readonly cause: ProviderError, public readonly completed: Record<string, string>,
              public readonly failedBatchIndex: number) { super(cause.userMessage); }
}
export function translateTranscript(doc: TranscriptDoc, provider: LlmProvider, opts?: TranslateOptions):
  Promise<Record<string, string>>;   // complete turnId → English text map

// src/features/translation/batching.ts
export interface Batch { index: number; turns: Turn[]; context: Turn[]; }
export function makeBatches(turns: Turn[], opts?: { maxChars?: number; maxTurns?: number; contextTurns?: number }): Batch[];

// src/providers/index.ts (addition)
export function getLlmProvider(id: LlmProviderId, apiKey: string, model: string): LlmProvider;
export function setLlmProviderFactoryForTests(f: typeof getLlmProvider): void;
```

## Acceptance criteria

- [x] With `api.anthropic.com` mocked to return valid structured JSON, translating the German fixture produces an
      English view with identical timestamps and speakers. Switching back shows the original.
- [x] The same works with `generativelanguage.googleapis.com` mocked (Gemini).
- [x] A response that is missing one id is retried once. A second failure shows the error with **Resume**, and
      resuming finishes the translation without repeating the batches already done.
- [x] Cancel stops after the current request is aborted. No partial translation is saved as complete.
- [x] The translation survives a reload (autosave) and can be exported as English `.docx`.
- [x] The Translate button is disabled for an English transcript. *(Hidden rather than disabled: D13, D14.)*
- [x] No CSP violations in the console. `verify:single-file` passes. The bundle size is recorded.
- [ ] **Live (manual, user's keys):** translate a real 5–10 min German transcript with each provider. Record the
      quality notes, duration and approximate cost in L3. *(Pending: not run yet. See Handoff.)*

## Required tests

- `features/translation/batching.spec.ts`: limits, oversized turns, context, empty input.
- `features/translation/translate.spec.ts` with a fake `LlmProvider`: happy path, missing id → retry → success,
  persistent failure → `TranslationError` with `completed`, resume, abort, glossary and language passed into the
  input.
- `providers/llm/claude.spec.ts`: an injected fake `fetch` returns a canned response, a refusal, and 401/429.
- `providers/llm/gemini.spec.ts`: a mocked SDK or fetch, with the equivalent cases.
- `tests/e2e/translate.e2e.ts`: the mocked Claude flow end to end, including the English export.

## Out of scope

Translating into other languages, the AI audit, editing translations, streaming partial results into the view.

## Handoff

*(L1–L3 results, effort setting chosen, bundle delta.)*

### 2026-10-13 — Phase 6 done (branch `phase-6-translation`, based on `main` at `74be367`)

**Not done yet: the live check (L3).** No real API calls were made (CLAUDE.md). It needs the maintainer's Claude
and Gemini keys, run against `dist/describe.html`. Besides quality, duration and cost, it is the first proof that
both real APIs accept the browser's CORS preflight for every header the SDKs send. The e2e mocks allow all headers.

**First commit: main's failing Setup tests.** `fix: update Setup tests for the Verify key rename` brings
`ApiKeyField.spec`, `SetupView.spec` and `setup.e2e` in line with 40553a1 ("Verify key", the label "Zero
retention"), and runs Prettier on the two components. The components' behaviour is unchanged.

**Decisions (taken with the maintainer)**
- **D14: progress shows inline, not in the dialog.**
  - The dialog collects provider, model, the key (only if missing or rejected) and the data notice.
  - Then the actions row shows "Translating… batch 3 of 12", a progress bar and **Cancel**, or the error with
    **Resume**.
- **T9: Claude runs at effort `medium`, with the server-side refusal fallback on** (`fallbacks: 'default'`, beta
  `server-side-fallback-2026-07-01`).
- **Out of scope: Verify key for Claude and Gemini on Setup.** The key is checked by the first translation instead.

**Dependency findings (L1, L2 in the reference doc)**
- `@anthropic-ai/sdk` 0.133.0 and `@google/genai` 2.29.1, both bundled. T6's REST fallback was not needed.
- **Bundle:** 632 KB → 1,236 KB (198 → 327 KB gzip): Claude about 346 KB, Gemini about 381 KB.
- **Imports:** Gemini comes from `@google/genai/web`; the root import pulls in the Node build under Vitest.
- **Eval:** neither SDK adds `eval` or `new Function`. The e2e console guard sees no CSP violation while
  translating with either provider.
- **The SDKs' zod use is covered by T8:** both convert schemas with zod's `toJSONSchema`, and the Anthropic helper
  imports `zod/v4`. Both are the same zod instance as `lib/zod`, so the jitless config applies to them too.

**Contract changes and additions**
- **Provider types:** `StructuredRequest` imports `z` from `lib/zod` (the reference doc is fixed), and
  `LlmProvider.id` is `LlmProviderId`.
- **Provider options:** `createClaudeProvider({ apiKey, model, fetch?, maxRetries? })` and
  `createGeminiProvider({ apiKey, model, fetch?, maxRetries? })`. Gemini takes `fetch` through
  `httpOptions.fetch`, so both test suites inject a fake `fetch`.
- **`models.ts`:** also exports `CLAUDE_EFFORT` and `isKnownModel()`.
- **`providers/index.ts`:** `setLlmProviderFactoryForTests(null)` restores the real factory.
- **`translate.ts`:** also exports `checkReply()` (the id-set check) and `TRANSLATION_MESSAGES`.
  - `TranslationError.cause` is declared `override`, since it narrows `Error.cause`.
  - A batch whose turn ids are all in `resumeFrom` is skipped; batch numbers stay global.
  - Texts are trimmed.
- **`stores/transcript`:** `setTranslation(docId, translation): Promise<boolean>`.
  - It updates the current doc only if the id still matches, so renames made during the run are kept.
  - It sets `view = 'en'` and saves at once, which also folds in a pending rename save.
- **`stores/settings`:** new prefs `translationProvider`, `translationModel` (an unknown model falls back to the
  provider's default) and `hideTranslationNotice`. `savePrefs` takes a partial object.
- **`stores/translation`:** `status`, `progress`, `error`, `partial`, `target`, `isRunning`, plus `start()`,
  `resume()`, `cancel()` and `dismiss()`.
  - `resume()` reads the key again, so an auth error fixed on Setup can resume.
  - `cancel()` discards `partial`.
  - The store resets when another doc replaces the transcript.
  - `beforeunload` is held while a translation runs.
- **`ConfirmDialog`:** new `confirmDisabled` prop. The message has a bottom margin before slot content; it collapses
  away when there is no slot.
- **`TurnList`:** new props `texts` (turn id → shown text) and `lang` (set on the `<ol>`).
- **New fixture `many-turns`:** 70 alternating German turns, which make 2 batches. **Test helpers:**
  `mockAnthropic`, `mockGemini`, `englishFor` and the `LlmCall`/`LlmAnswer` types in `tests/e2e/helpers.ts`.

**UI text trimmed (D13)**
- **Translate button:** hidden for English transcripts and for transcripts without speech. The draft disabled it
  with a tooltip.
- **Dialog:**
  - Title "Translate to English", confirm "Translate", or "Re-translate" with the message "This replaces the
    English translation.". This replaces the separate "Replace the existing English translation?" confirm.
  - The provider radios have a visually hidden legend "Provider"; the model select is labelled "Model".
  - The data notice is one line: "Only the transcript text goes to Anthropic (Claude), not the audio." It has a
    "Don't show again" box, which takes effect when Translate is confirmed.
- **Progress:** "Translating…", with "batch N of M" and a progress bar only when there is more than one batch.
- **Errors:** the provider's message, or "Part of the translation came back incomplete.", next to **Resume**. The
  Translate button stays, to start over.
- **VersionToggle:** "Original (German) | English", shown only once a translation exists.
- **Screen readers:** a visually hidden live region announces "Translating", "Translation cancelled." and "English
  translation ready."; errors use `role="alert"`.
- **Focus:** when the focused control disappears, focus moves to the progress line, Resume or the Translate button.
  In Chromium, a closed modal can leave focus on its hidden button, so that also counts as lost focus.

**Checks**
- **Mutation spot checks:** 10 deliberate bugs, each caught:
  - no missing-id check
  - no retry
  - resume repeating done batches
  - a late reply after Cancel saved
  - `setTranslation` ignoring the doc id
  - Translate shown for English
  - Claude's refusal not checked
  - Gemini's `API_KEY_INVALID` read as validation
  - focus left in the closed dialog (caught by e2e)
  - cancel not clearing `partial` (dead state, replaced by the late-reply check)
- **Browser (dev server, seeded 70-turn doc, `fetch` stubbed in the page, no real API):**
  - the dialog, the inline progress, the toggle and focus all work
  - no horizontal scroll at 375 px, with the dialog fitting at 337 px wide
  - no console errors

**Tests:** 649 unit tests (up from 541) and 35 e2e tests (up from 29), all passing, along with typecheck, ESLint,
Prettier, the build and `verify:single-file`.
- New: the `claude`, `gemini`, `batching`, `prompt`, `translate`, `translation` store, `TranslateDialog`,
  `TranslateButton` and `VersionToggle` specs.
- Additions to the `transcript` store, `settings`, `TurnList`, `OutputView` and `ConfirmDialog` specs.
- `translate.e2e.ts` (6 tests).

**For Phase 7:** `TurnList` already takes `texts`. Playback's `select` works the same in the English view, because
turn ids and times don't change.

**For Phase 8:**
- The About panel's data-flow text should include the translation sentence from the reference doc.
- Run L3 before release.
