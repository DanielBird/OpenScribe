# Phase 19 — Gemini for the pipeline and summaries

**Goal:** Analyse mode can use Gemini as well as Claude for its translations and summaries.
- The model select lists Gemini models next to the Claude ones.
- **Add to project**, **Summarise**, **Regenerate** and **Summarise all** use the chosen model's provider and that
  provider's key.
- Summary files and pipeline translations record which provider made them.

The chat stays Claude-only until Phase 20.

**Status of the plan:** DECISIONS **D26** and **T15** were agreed on 2026-10-21, with PROJECTS.md §9 Q5.

**Depends on:** Phase 15. It can run alongside 16 and 17. Phase 18 depends on it.

**Read first:**
- [PROJECTS.md](../PROJECTS.md) §2 (A6, A17), §5.3, §5.6, §5.8, §9 Q5;
- [DECISIONS.md](../DECISIONS.md) D3, D13, D18, D21, D23, D26, T6, T7, T9, T15;
- [reference/llm-providers.md](../reference/llm-providers.md), Gemini and Session summaries;
- the Handoffs of Phases 13 and 15;
- `src/providers/llm/gemini.ts`, `claude.ts` (how it streams), `models.ts`, `src/stores/pipeline.ts`.
- **SDK facts:** Google's official Gemini API documentation and the installed `@google/genai` types
  (`dist/web/web.d.ts`, 2.29.1). Don't guess API shapes (AGENTS.md). If the summary prompt in
  `src/features/summary/` has to change, load the `claude-api` skill first (CLAUDE.md), and keep one prompt for both
  providers.

## Agreed with the maintainer

Agreed on 2026-10-21:
- **D26 and T15** as written.
- **Q5, the models:** `gemini-3.8-flash` ("Gemini 3.8 Flash") and `gemini-4-argon` ("Gemini 4 Argon"): a cheap one
  and a strong one, as Sonnet and Opus are for Claude. Sonnet 5.5 stays the default. This replaces "3.8 Flash only"
  below.
- **Phase 20 ships in 2.0,** so Phase 18 depends on it too.
- **Branch:** `phase-19-gemini-summaries`, from the Phase 17 commit.

## Decided in this file (the maintainer can still change them)

- **One select, grouped by provider.** The Analyse header's model select gets an `<optgroup>` for Claude and one for
  Gemini. The model's id gives its provider, so `settings.projectModel` keeps its shape and no stored data changes.
  Sonnet 5.5 stays the default.
  - *This is a visible change. Show the maintainer the header at 1280 and 375 px before you finish it.*
- **Gemini models:** `gemini-3.8-flash` only, labelled "Gemini 3.8 Flash", until the maintainer answers Q5. Phase 19
  lists the candidates from Google's model list with their prices, so the maintainer can pick.
- **The key follows the model.**
  - `pipeline.needsKey`, the Add to project dialog, the Summarise all dialog and the "Enter your … key first."
    message all use the project provider's key.
  - The key field's label is the existing "Claude (Anthropic) API key" or "Gemini (Google) API key".
- **The data line** in both dialogs names the provider: "The transcript text is sent to Google to translate and
  summarise." (or "to summarise" for English).
- **Summary files** gain `provider: 'claude' | 'gemini'`, which is optional, and Claude when it's missing.
  `SessionSummary`'s details then read "Made with Gemini 3.8 Flash on …". An unknown model id shows the id itself, as
  it does today.
- **The pipeline's translation** records `provider` from the project model. It's no longer `'claude'` hard-coded.
- **The chat until Phase 20:** with a Gemini model selected, the chat's input is replaced by one line: "The chat
  needs a Claude model. Choose one above." (draft). If Phase 17 isn't done yet, write this rule into Phase 17's
  file instead of building it here.
- **Queue rule for 429** (T15): if Google's error details tell a spent quota apart from a rate limit, map the spent
  quota to `quota`. If they don't, **Summarise all** also stops on a Gemini `rate_limit`. Say which in the Handoff.
- **No refusal fallback for Gemini.** A `refused` summary is a failed session, as it is today when Claude's fallback
  also refuses.

## Tasks

1. **`providers/llm/models.ts`**
   - `PROJECT_MODELS.options` entries gain `provider: LlmProviderId`. Add the Gemini model or models.
   - `projectProviderOf(model): LlmProviderId` (Claude for an unknown id, which can't be selected anyway).
   - `GEMINI_THINKING`: the thinking level for Gemini requests (T15). Pick it from Google's documentation for
     the chosen model, and say why in the Handoff.
2. **`providers/llm/gemini.ts`: stream inside `generateStructured`** (T15)
   - Use `ai.models.generateContentStream`. Join the text of the chunks, leaving out thought parts. Read the
     finish reason, the prompt feedback and the usage from the stream.
   - Keep today's checks and their order: a blocked prompt, a refusal finish reason, `MAX_TOKENS`, then the JSON parse
     and the zod parse.
   - Cancelling ends the stream (`abortSignal`) and gives `aborted`.
   - Set `thinkingConfig.thinkingLevel: GEMINI_THINKING`. Check whether thinking tokens count against
     `maxOutputTokens`, and if they do, make sure `SUMMARY_MAX_OUTPUT_TOKENS` leaves room for both.
   - The 429 mapping above. Parse `error.details` with zod, as `parseErrorBody` already does.
   - Record the request and response shape in `reference/llm-providers.md` (Gemini, "as built"), including the stream
     endpoint and its framing as the SDK sends and reads them. Note whether the bundle grew.
3. **The schema check:** a unit test that `toGeminiSchema(SummaryOutputSchema)` has no `$schema`, no `$ref`/`$defs`,
   and that the nullable `speakerId` comes out in a form Gemini's `responseJsonSchema` documentation lists as
   supported. If it doesn't, adjust `toGeminiSchema`, not the shared schema.
4. **`stores/settings.ts`:** a computed `projectProvider` from `projectModel`.
5. **`stores/pipeline.ts`:**
   - Use `settings.projectProvider` and its key, read when a job starts as today.
   - Record the provider in the translation and in the summary file.
   - The queue stop rule for Gemini's 429.
6. **`storage/projectFiles.ts` and `domain/summary.ts`:** add the optional `provider` to `SessionSummaryFile` and its
   schema. No schema version bump (D18): this is a new optional field, and older builds strip it.
7. **UI:**
   - `ProjectHeader`: the grouped select.
   - `AddToProjectDialog` and `SummariseDialog`: the key field and data line for the project provider.
   - `SessionSummary`: the model label from the file's model; `SessionList` and the Summarise all question
     already use the label.
   - The chat notice, if Phase 17 is done (see above).
8. **The data-flow text** (PROJECTS.md §5.8): About panel, `reference/llm-providers.md`, and the User Guide's privacy
   section.
9. **Tests and mocks**
   - `src/testing/geminiSse.ts`: turns a `GenerateContentResponse` (or a list of chunks) into the stream the SDK
     reads, like `claudeSse.ts`. Read the framing from the SDK's source, not from memory.
   - Move `mockGemini` in `tests/e2e/helpers.ts` to the stream, since the Output tab's Gemini translation now
     streams too.
10. **Docs:**
    - USER_GUIDE: the model select in Analyse mode, and which key it needs.
    - TESTING.md: the new specs, and a manual row: add a German session to a project with Gemini.
    - `reference/llm-providers.md`: the pending live checks G1–G3 (below).
    - CHANGELOG.

## Contracts introduced

```ts
// providers/llm/models.ts (changed)
export const PROJECT_MODELS = {
  default: 'claude-sonnet-5-5',
  options: [
    { id: 'claude-sonnet-5-5', provider: 'claude', label: 'Sonnet 5.5' },
    { id: 'claude-opus-5-5', provider: 'claude', label: 'Opus 5.5' },
    { id: 'gemini-3.8-flash', provider: 'gemini', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-4-argon', provider: 'gemini', label: 'Gemini 4 Argon' },
  ],
} as const;
export function projectProviderOf(model: string): LlmProviderId;
export const GEMINI_THINKING: 'LOW' | 'MEDIUM' | 'HIGH'; // chosen in this phase (T15); `as const`

// domain/summary.ts (addition)
interface SessionSummaryFile {
  /* Phase 15 fields, plus: */
  provider?: LlmProviderId; // missing = 'claude'
}

// stores/settings.ts (addition)
projectProvider: ComputedRef<LlmProviderId>;
```

The values are those of the SDK's `ThinkingLevel` enum, written as string literals so that `models.ts`, which the
settings store imports, doesn't import the SDK. `gemini.ts` passes the value to the SDK.

## Live checks (pending until the maintainer runs them with a Gemini key)

| ID | Check |
|---|---|
| G1 | Gemini accepts `responseJsonSchema` for the summary schema, and the streamed reply parses (the same request as the unit tests). Also closes L3 for translation. |
| G2 | Summary quality on the S1–S3 sessions (a real German one and a real English one): the dropped-quote rate, tokens, time, and cost per hour, compared with Sonnet 5.5. |
| G3 | CORS from `file://` for the stream endpoint, and a 429 from a spent quota: what its details say. |

## Acceptance criteria

- [ ] With a Gemini model selected, **Add to project** on a German transcript translates and summarises with Gemini
      and the Gemini key. The files record `provider: 'gemini'` and the model.
- [ ] With a Claude model selected, nothing changes from Phase 15. A summary file without `provider` reads as Claude.
- [ ] A missing Gemini key is asked for in both dialogs. An `auth` error stops the queue and asks for the key again.
- [ ] `generateStructured` on Gemini streams. Cancel, refusal, `MAX_TOKENS`, unreadable JSON and every HTTP error
      map as before, without the key.
- [ ] The Output tab's Gemini translation still works (it now streams).
- [ ] The data-flow text names the chosen provider everywhere it appears.
- [ ] The chat isn't offered with a Gemini model (or Phase 17's file says so, if the chat isn't built yet).
- [ ] The axe and keyboard specs cover the grouped select and the dialogs with a Gemini model.
- [ ] Definition of Done in AGENTS.md. No real API calls; G1–G3 recorded as pending.

## Required tests

- `gemini.spec.ts`: streamed replies in several chunks; thought parts left out; every finish reason; a blocked prompt;
  abort mid-stream; the 429 mapping; the thinking level and schema in the request body.
- `models.spec.ts` (or where the models are tested): `projectProviderOf` for every option and for an unknown id.
- `stores/pipeline.spec.ts`: a Gemini job uses the Gemini key and records the provider; the queue rule for 429.
- `projectFiles.spec.ts`: a summary file with and without `provider`.
- Component specs: `ProjectHeader` (the groups), `AddToProjectDialog` and `SummariseDialog` (the Gemini key and data
  line), `SessionSummary` (the Gemini model label).
- `tests/e2e/project-add.e2e.ts`: one run with a Gemini model, Gemini mocked with SSE, through to a copied quote.
- The existing Gemini translation specs, on the streamed mock.

## Out of scope

- The Gemini agent and chat (Phase 20).
- A refusal fallback for Gemini.
- Different prompts per provider. If Gemini needs a change, it goes into the shared prompt, and both providers are
  checked.
- A separate provider choice for translation and for summaries.

## Handoff

*(The thinking level and why, the 429 finding, the stream framing, the bundle size, the UI text trimmed under D13,
anything Phase 20 needs.)*

### 2026-10-21 — Phase 19 done (branch `phase-19-gemini-summaries`, from the Phase 17 commit)

**Agreed with the maintainer while planning:** see "Agreed" above. Two Gemini models (3.8 Flash and 4 Argon), and
Phase 20 moved into 2.0.

**The thinking level:** `GEMINI_THINKING = 'MEDIUM'`.
- Google's thinking page (2026-10-21) lists low, medium and high for both models. 3.8 Flash defaults to medium; 4
  Argon's default isn't documented. `MEDIUM` matches `CLAUDE_EFFORT` and is valid for both.
- Thinking tokens count against `maxOutputTokens`, as on Claude, so the summary's 32,000 already leaves room. Argon's
  output limit is 65,536. Translation keeps the default 16,000.

**The 429 finding (T15):**
- Google's API errors page lists 402 for a used-up prepaid credit, and the 429 codes `rate_limit_exceeded` and
  `quota_exceeded`. Those codes are documented for the Interactions API. For `generateContent`, Google documents no
  error details.
- The adapter maps three cases to `quota` (new message `GEMINI_MESSAGES.quota`):
  - a 402;
  - a 429 whose `error.code` is `quota_exceeded`;
  - a 429 whose `QuotaFailure` violation has a `quotaId` containing `PerDay`.
- Because the details aren't documented, **Summarise all also stops on a Gemini `rate_limit`** (`stopsQueue` takes
  the job's provider). A Claude rate limit still doesn't stop it. G3 should look at a real 429's body.

**The stream framing:**
- The request goes to `:streamGenerateContent?alt=sse`. The reply has one `data: <JSON>` per event, separated by a
  blank line.
- The SDK spots an error inside the stream only when a whole network read is a `{ "error": … }` object. It throws
  `ApiError("got status: … {json}")`, so `parseErrorBody` now parses from the first `{`.
- An unreadable event surfaces as a `SyntaxError` and maps to `bad_output`.
- Automatic continuation (`continuationToken`) is the SDK's default and is kept.
- The details are in `reference/llm-providers.md`. `geminiSseEvents` gives one string per event, so unit tests can
  send each event as its own read.

**Schema:**
- zod writes the nullable `speakerId` as `anyOf` with `{type:'null'}`. Google's docs give the type array
  `['string','null']`, so `toGeminiSchema` rewrites that one shape. The shared schema is unchanged.
- No `$ref` or `$defs`. A unit test pins both.

**Bundle:** 1,508,780 → 1,511,524 bytes. Streaming uses the same SDK, so the growth is the new code only.

**Changed from this file**
- `KeyDialog` didn't need a `provider` prop. Only the chat uses it, and the chat stays Claude-only until Phase 20.
  The Summarise key dialog is `SummariseDialog`, which now follows the project provider.
- `projectModelLabel(model)` in `models.ts` replaces the inline label lookups in `SessionSummary` and `SessionList`.
- The UI names each provider (company and key label) from a new `src/ui/providerNames.ts`.
- `PIPELINE_MESSAGES.keyMissing` is now per provider.
- A summary file's `provider` is read with `.optional().catch(undefined)`, so a provider this build doesn't know
  reads as missing rather than making the file invalid.
- The seed builder `makeSummaryFile` writes `provider: 'claude'`.

**UI text (D13):**
- The chat line is "The chat needs a Claude model. Choose one above.", shown in place of the question box with the
  chat's existing notice style.
- The dialogs' data line is the existing sentence with the company swapped in ("…sent to Google to translate and
  summarise.").
- The select's groups are labelled "Claude" and "Gemini". The options keep their labels, and the Gemini ones say
  "Gemini" because the label is reused in "Made with …" and in the Summarise all question.

**For Phase 20**
- Remove `needsClaude` (`stores/chat.ts`) and its line in `ChatPane`. Make `KeyDialog`, the chat's `needsKey` and the
  chat's data line provider-aware (`PROVIDER_NAMES`). Update the chat's data-flow sentence (PROJECTS.md §5.8).
- Add the Gemini models to `MODEL_PRICES`. The prices are in `reference/llm-providers.md`, and both double soon:
  Argon on 2026-12-01, Flash on 2027-01-01. Decide whether `MODEL_PRICES` should carry a date.
- `readStream` in `gemini.ts` keeps the last `usageMetadata` (summed across continuations by the SDK), unused so far.
- Argon's default thinking level isn't documented; A3's medium-against-high check should cover Gemini too.

### 2026-10-21 — After the phase: the model in the Add to project dialog

- **Maintainer's request:** on Output, the Add to project dialog showed only Anthropic, because the project model
  could be changed only in Analyse mode's header.
- **The change:** the dialog now has a labelled **Model** select. It is the same grouped list and the same saved
  setting (`settings.projectModel`), so it and the header always agree.
- **A new component:** `ProjectModelSelect.vue` renders the grouped `<select>`, used by both. The parent gives the
  label (through `id`) and the style (through `class`).
- **The key field:** a switch to a model whose provider's key is missing shows that key's field. It stays while the
  key is typed.
- **Branch:** committed on `phase-20-gemini-agent`, after Phase 20, because that session had the checkout on its
  branch.
