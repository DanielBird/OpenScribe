# LLM providers (Claude, Gemini) — reference for DeScribe

*Facts gathered 2026-10-13. Used by Phase 6 (translation) and later the AI audit (future F1). Phase 13 (2026-10-19)
added streaming and session summaries.*

Both providers are called **directly from the browser** with the user's own key. Only transcript **text** is sent;
audio is never sent.

## Shared contract

```ts
// src/providers/llm/types.ts
import type { z } from '../../lib/zod'; // never 'zod' directly (DECISIONS.md T8)

export interface StructuredRequest<T> {
  system: string;
  input: string;                 // user message content (we send JSON text)
  schema: z.ZodType<T>;          // adapters convert to the provider's JSON-schema format
  schemaName: string;            // e.g. 'translation_batch'
  maxOutputTokens?: number;      // default 16000
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: LlmProviderId;               // 'claude' | 'gemini'
  readonly model: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<T>;   // throws ProviderError
}
```

Adapters map SDK errors to `ProviderError` (`src/providers/errors.ts`) with these kinds: `auth`, `rate_limit`,
`quota`, `validation`, `server`, `network`, `aborted`, `refused` (the model declined), `bad_output` (output didn't
match the schema).

**Translation batches** (`features/translation/translate.ts`, with either provider) are retried once on
`bad_output`, which includes a reply whose turn ids don't match the request or that leaves a turn's text empty. If
only empty texts remain on the retry, for at most a third of the batch (and always one turn), those turns keep their
original text (DECISIONS.md D42).

**Key check (Verify key in Settings).** `verifyClaudeKey` and `verifyGeminiKey` (reached through `verifyLlmKey` in
`src/providers/index.ts`) list one model: `GET api.anthropic.com/v1/models?limit=1` with `client.models.list`, and
`GET generativelanguage.googleapis.com/v1beta/models?pageSize=1` with `ai.models.list`. Neither sends text, spends
tokens or uses generation quota. A rejected key (Claude 401; Gemini 400 `API_KEY_INVALID`, 401 or 403) gets its own
message; any other failure uses the normal error mapping. They resolve to a `KeyCheckResult` and reject only when
cancelled, like ElevenLabs' `verifyKey`. Only the Settings view shows the button (`ApiKeyField`'s `verifiable` prop).

## Claude (Anthropic)

- **CORS (verified 2026-10-13):** a preflight from `Origin: null` with header
  `anthropic-dangerous-direct-browser-access` returns `access-control-allow-origin: *`.
- **SDK:** `@anthropic-ai/sdk`, constructed with `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`. That
  option sends the header above. The "dangerous" warning is about exposing a server key to website visitors; here
  each user supplies their own key in their own browser, which is the accepted use.
- **Models** (`src/providers/llm/models.ts`): default `claude-opus-5-5`; alternative `claude-sonnet-5-5`, which
  is cheaper. Use these exact strings with no date suffix.
- **Structured output (as built, SDK 0.133, streamed since Phase 13):** `client.beta.messages.stream({ model,
  max_tokens, system, messages, output_config: { effort, format: { type, schema } }, betas:
  ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })`, then `await stream.finalMessage()`.
  Here `type` and `schema` come from `betaZodOutputFormat(schema)` (`@anthropic-ai/sdk/helpers/beta/zod`).
  - **Why it streams:** the SDK refuses a non-streaming request whose `max_tokens` could take more than 10 minutes
    (above about 21,333 tokens), and a summary asks for 32,000. Every `generateStructured` call streams, so
    translation does too.
  - **Why `parse` is left out of the format:** given a format with a `parse` function, the stream parses every
    text block at `message_stop` and throws before `stop_reason` can be checked. That would turn a mid-stream
    refusal, a reply cut off at `max_tokens`, or a mid-stream fallback (two text blocks) into an unreadable reply.
    `beta.messages.parse` is not used for the same reason.
  - After the checks below, the adapter calls `format.parse(text)` on the joined text blocks. A failure is
    `bad_output`.
  - The beta namespace is needed for the `fallbacks` parameter.
  - **Bundle:** the switch added 158 bytes to `describe.html` (1,378,455 → 1,378,613 bytes). The stream class was
    already in the bundle.
- **Schemas** (checked in Phase 13): the SDK converts zod to JSON Schema and moves unsupported keywords
  (`minLength`, `maximum`, `minItems` above 1, …) into the description, so counts and lengths belong in the prompt
  and the app's checks, not in the schema.
  - A nullable field becomes `"type": ["string", "null"]`. The API accepts it, but each one counts towards a limit
    of 16 union-typed fields per request. There's also a limit of 24 optional fields, and grammar size limits
    that return 400 "Schema is too complex for compilation" (structured-outputs docs, 2026-10-19).
  - `.describe()` on an array or a nullable copies the schema, and zod then moves the inner schemas into `$defs`
    behind `$ref`s. Supported, but harder to read, so `features/summary/schema.ts` describes containers through
    `z.globalRegistry.add` instead.
- **Thinking/effort:** on `claude-opus-5-5` thinking is always on and cannot be disabled. Control cost and depth
  with `output_config.effort`. DeScribe sends `medium` (DECISIONS.md T9); Opus 5.5's API default is also `medium`,
  Sonnet 5.5's is `high`.
- **Refusals:** check `stop_reason === 'refusal'` before reading the output and map it to `refused`.
  - `stop_details.category` goes into the error's `detail`.
  - Server-side fallback is on (`fallbacks: 'default'`, beta `server-side-fallback-2026-07-01`). A declined request
    is re-run on the model Anthropic recommends for that category, inside the same call. The response may then
    start with a `fallback` content block, which the adapter skips.
  - Sonnet 5.5's fallback retries only `cyber` and `frontier_llm` declines.
  - A refusal can come before any output or part-way through the stream. Either way it arrives in `message_delta`,
    and the final message's `stop_reason` is `refusal`; any partial text is discarded.
  - A fallback part-way through keeps the declined partial text, adds a `fallback` block, and continues in a new
    text block. Joining the text blocks gives the whole reply.
  - `stop_reason === 'max_tokens'` is mapped to `bad_output` too, so the batch is retried once.
- **Errors:** the SDK throws typed errors (`Anthropic.AuthenticationError`, `RateLimitError`, `APIConnectionError`,
  …). Map them most-specific-first. Do not match on message strings.
  - Running out of credit is a 400 whose typed `APIError.type` is `billing_error`; it maps to `quota`.
  - For other 400s, the API's own message is shown after "Claude couldn't process the request:".
  - The SDK retries 408/409/429/5xx twice (`maxRetries: 2`). It doesn't retry a stream that fails part-way.
  - A stream that fails part-way ends with an SSE `error` event. The SDK throws an `APIError` with no status, only
    its `type`: `overloaded_error` and `api_error` map to `server`, `rate_limit_error` to `rate_limit`, anything
    else to `unknown`.
- **Testing:** the client accepts a custom `fetch` option, so unit tests inject a fake `fetch`. E2E tests mock
  `https://api.anthropic.com/**`. Both answer with server-sent events from `claudeSse(message)`
  (`src/testing/claudeSse.ts`), which turns a Messages API response into the event stream the SDK reads. Its
  `error` option ends the stream with an `error` event.
- **Claude Code agents:** load the `claude-api` skill before implementing this adapter. It overrides anything here
  if they disagree.

## Gemini (Google)

- **CORS (verified 2026-10-13):** a preflight from `Origin: null` with headers `x-goog-api-key, content-type`
  returns `Access-Control-Allow-Origin: null`, so calls are allowed.
- **SDK (as built, 2.29):** import from **`@google/genai/web`**. The package root resolves to the Node build
  (google-auth-library, ws) under Vitest; the browser build only imports `p-retry`.
  - Construct it with `new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 3 }, fetch? } })`. The
    SDK retries only when `retryOptions` is given; `fetch` lets the tests inject a fake.
  - **Streamed (Phase 19, T15).** Call `ai.models.generateContentStream({ model, contents: input, config: {
    systemInstruction, responseMimeType: 'application/json', responseJsonSchema, maxOutputTokens, thinkingConfig: {
    thinkingLevel }, abortSignal } })`. Every request streams, so Output's Gemini translation does too.
  - **The wire:** `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`,
    with the key in `x-goog-api-key`. The reply is server-sent events: each event is one `data: <GenerateContentResponse
    JSON>` line, and events are separated by a blank line (the SDK accepts `

`, `

` and `

`). The SDK
    yields one response per event. `src/testing/geminiSse.ts` builds this for the tests.
  - **Reading the stream:** the text of `candidates[0].content.parts` is joined, leaving out parts marked `thought`
    (`chunk.text` isn't used: its getter warns about other parts). The last finish reason, prompt feedback and usage
    are kept. Then the checks run as before: a blocked prompt, a refusal finish, `MAX_TOKENS`, the JSON parse, the zod
    parse.
  - **Errors inside the stream:** the SDK reads a network read that is exactly a `{ "error": … }` object as an error
    and throws an `ApiError` whose message is `got status: <STATUS>. <the JSON>`, so the adapter parses from the first
    `{`. An event it can't parse throws a `SyntaxError` (or `Error("exception parsing stream chunk …")`), mapped to
    `bad_output`.
  - **Automatic continuation:** the SDK resumes a stream the server cut at a `continuationToken` by itself (on by
    default, `config.automaticContinuation`), and sums the usage across the requests. DeScribe keeps the default.
  - **Thinking:** `thinkingConfig.thinkingLevel` is `GEMINI_THINKING` (`MEDIUM`) in `models.ts`, set explicitly as
    `CLAUDE_EFFORT` is. Google's thinking page (2026-10-21): 3.8 Flash supports low, medium and high, default medium;
    4 Argon supports low, medium and high, default not documented. Thinking tokens **count against
    `maxOutputTokens`**, as on Claude, so the summary's 32,000 leaves room for both (Argon's output limit is 65,536).
  - The field is **`responseJsonSchema`**, which takes JSON Schema. Its value is `z.toJSONSchema(schema)` with
    `$schema` removed, because Gemini doesn't list `$schema` as supported, and with zod's nullable form
    (`anyOf: [<schema>, { type: 'null' }]`) rewritten as the type array Google documents (`type: ['string', 'null']`).
    The summary schema has no `$ref` or `$defs` (a unit test pins it).
  - **Bundle:** streaming uses the same SDK, so nothing new is bundled.
- **Fallback (T6):** if the SDK cannot be bundled into the single file, use REST:
  `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with header
  `x-goog-api-key`.
- **Models:** for translation (`LLM_MODELS`), default `gemini-3.8-flash`; alternatives `gemini-3.6-flash`,
  `gemini-3.5-flash-lite`. For project work (`PROJECT_MODELS`, D26), `gemini-3.8-flash` and `gemini-4-argon`. The
  Gemini 2.5 family is restricted for new projects, so do not use it.
- **Prices** (Google's pricing page, standard paid tier, 2026-10-21, $ per million tokens): 3.8 Flash $0.75 in,
  $3.75 out, $0.075 cache read, doubling on 2027-01-01; 4 Argon $2 in, $10 out, $0.10 cache read (implicit caching
  only), doubling on 2026-12-01. No higher price above a prompt size for either. `MODEL_PRICES` holds the doubled
  prices (Phase 20, see "Project agent with Gemini").
- **Errors:** 400 with `API_KEY_INVALID` → `auth`; 402 → `quota`; 429 `RESOURCE_EXHAUSTED` → `rate_limit`, or
  `quota` for a daily quota; 5xx → `server`; a blocked prompt or a `SAFETY` finish reason → `refused`.
  - **402 and 429 (Phase 19, T15):** Google's API errors page (2026-10-21) lists 402 for a used-up prepaid credit
    (don't retry), and three 429 codes: `rate_limit_exceeded` (per minute or second), `quota_exceeded` (daily) and
    `too_many_requests`. Those code strings are documented for the newer Interactions API; for `generateContent`
    Google documents no error details. The adapter maps 402, a 429 whose `error.code` is `quota_exceeded`, and a 429
    whose `google.rpc.QuotaFailure` violation has a `quotaId` with `PerDay` to `quota`. Because none of this is
    documented for `generateContent`, **Summarise all** also stops on a Gemini `rate_limit` (the SDK has already
    retried it twice). G3 checks a real 429.
  - The SDK's `ApiError` has `status`, and its `message` is the JSON error body. The adapter parses the body and
    reads `error.details[].reason` (`API_KEY_INVALID`); it does not match on the message text.
  - 401/403 → `auth`; 404 → the model isn't available to this key.
  - Finish reasons `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT` and `SPII` → `refused`; `MAX_TOKENS`
    → `bad_output`.
  - **Network failures (audit BUG-10):** the SDK has no connection error class. It passes fetch's rejection through
    as it is, a `TypeError`, and a fault in the SDK or the adapter is a `TypeError` too. So only Chromium's two fetch
    messages are `network`: "Failed to fetch" before a response (offline, DNS, a blocked host) and "network error"
    when the body stops part-way. The SDK's retry, p-retry 4, matches on the first. Any `TypeError` while
    `navigator.onLine` is `false` is `network` too. Any other `TypeError` is `unknown`, which isn't retried. The
    offline e2e spec in `robustness.e2e.ts` checks the first message in Chromium.

## Session summaries (Phase 13)

One structured-output request per session, with the project model: Claude, or Gemini from Phase 19 (PROJECTS.md
§5.3, DECISIONS.md D21, D26). The code is in
`src/features/summary/`; `summariseSession(session, provider, { brief, projectName, themeVocabulary, signal })` is
the entry point.

- **Model and limits:** the project model (`PROJECT_MODELS`: Sonnet 5.5 by default, Opus 5.5), effort `medium`,
  `max_tokens` 32,000 (`SUMMARY_MAX_OUTPUT_TOKENS`, room for thinking), streamed. Even a 10-hour session (~130k
  tokens) fits in one request.
- **Input** (`prompt.ts`): a fixed system prompt, and a user message with tagged parts. Parts with nothing to say
  are left out (no `<project>` without a name, no `<brief>` for an empty brief, no `<themes_in_use>` for the first
  session).

  ```
  <project>Hearing at home 2026</project>
  <brief>
  Research questions:
  1. How do people fit charging into their day?
  Context: …
  Metadata fields: Age; Country; Hearing aids used
  </brief>
  <themes_in_use>
  charging routines (12); stigma (9); partner support (4)
  </themes_in_use>
  <session>
  Recording: P07 Hamburg home visit.wav · 2026-09-14 · 01:32:10 · German, translated to English
  Speakers: Interviewer (speaker_0); Anna (speaker_1)
  </session>
  <transcript>
  t1 [00:00:03] Interviewer: …
  </transcript>
  ```

  - Each turn is its English text: the translation, or the original in an English session. A session in another
    language without a translation is refused before any request.
  - The Speakers line shows each speaker's id, because a respondent's `speakerId` must be one of them.
  - The date is the recording file's date (UTC).
  - A session whose language isn't known (Auto, and ElevenLabs returned none) is "Unknown language", here and in
    the agent's session list and tool results (`languageOrUnknown()`). The translation prompt then names no source
    language.
- **Output** (`schema.ts`): `SessionSummary` (title, synopsis, overview, respondents with attributes, a finding
  per research question, themes). Each finding and theme has up to 2 supporting quotes (`turnId`, `text`). Every
  field has a short description. There are no counts or lengths in the schema; one nullable field (`speakerId`).
- **Check** (`check.ts`), on every reply:
  - unknown turn ids are dropped everywhere, and duplicates removed;
  - a respondent's `speakerId` must be a speaker in the session, or it becomes `null`;
  - research questions follow the brief: one per question, in its order and wording. An entry is matched by its
    question (ignoring case and punctuation), or by position when the reply has one entry per question. A
    question with no entry is "Not discussed in this session." with no turns and no quotes;
  - each quote of a finding or a kept theme is checked against its turn's English text (`checkQuote`). A verified
    quote keeps the transcript's own words, and the others (including those on an unknown turn) are dropped and
    counted (`droppedQuotes`);
  - caps: 12 themes, 3 quotes per finding or theme; the title is cut to 80 characters.
- **Retry:** one more request if the reply can't be read (`bad_output`) or more than a third of its quotes aren't
  found. The checked result with the smaller share of quotes not found is kept; on a tie, the one with more verified
  quotes (`verifiedQuotes`, counted before the cap). A reply without quotes has none not found, as in the retry check.
- **Theme vocabulary** (`themes.ts`): every theme name across the project's summaries, with the number of
  summaries using it. Names that differ only in case or spacing are merged. The pipeline (Phase 15) leaves out the
  session's own summary, so a **Regenerate** isn't steered by its old themes.
- **As used by the pipeline** (`stores/pipeline.ts`, Phase 15): the project model (`settings.projectModel`) and the
  Claude key, both read when a job starts. A session in another language is translated first with
  `translateTranscript` and the same model; the translation is written into the transcript file before the summary
  request. The summary file records the model chosen, the `transcriptHash` of the text sent and `briefHash(brief)`.

## Project agent (Phase 16)

The engine behind the project chat (PROJECTS.md §5.5) with Claude; Gemini is in "Project agent with Gemini"
below. The provider is `src/providers/llm/claudeAgent.ts` (`createClaudeAgent`); the tools, context,
instructions, caps and answer parsing are in `src/features/agent/`; `askProject()` runs one question.

- **Loop: manual, streamed** (`client.beta.messages.stream` + `finalMessage()` per request), not the SDK's tool
  runner. After a **mid-output refusal fallback**, the API wants the `thinking`, `redacted_thinking` and `tool_use`
  blocks before the last `fallback` block left out when the turn is sent back. The runner echoes every block
  unchanged and would run that turn's pre-fallback tool calls. The manual loop applies the rule (`echoContent`) and
  runs only the calls after the boundary. It also sends no `X-Stainless-Helper` header, so the CORS preflight is
  the same as translation's.
- **Request** (every iteration, SDK 0.133):

  ```ts
  client.beta.messages.stream({
    model,                                   // the project model; a conversation keeps its model
    max_tokens: 64000,                       // AGENT_MAX_OUTPUT_TOKENS: the skill's streaming default
    system: [
      { type: 'text', text: instructions, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
    ],
    tools,                                   // the 4 tools, always in this order, eager_input_streaming: true
    messages,                                // the conversation, append-only
    thinking: { type: 'adaptive' },
    output_config: { effort: CLAUDE_EFFORT },// 'medium'
    cache_control: { type: 'ephemeral' },    // automatic caching of the conversation tail
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  }, { signal })
  ```

  `tool_choice` stays `auto`: forced tool use is a 400 on Sonnet 5.5 and Opus 5.5. Thinking `display` stays the
  default (`omitted`): the blocks have empty text and a signature.
- **Tools:** each `AgentTool`'s zod schema becomes `input_schema` through `z.toJSONSchema(schema, { reused: 'ref'
  })`, as the SDK's `betaZodTool` does. With eager input streaming the API doesn't validate inputs, so the loop
  `safeParse`s each one: a rejected input, an unknown tool or a tool that throws becomes a `tool_result` with
  `is_error: true` and a short message. The calls of one turn run with `Promise.all`, and all their results go back
  in one user message, in the model's order. A tool's input JSON that the stream can't parse (an `AnthropicError`
  that isn't an `APIError`) re-sends the request, at most twice in a row, then `bad_output`. Before each re-send, a
  `retry` event's `discard` takes back the text that attempt streamed, its line break included, so **Stop** doesn't
  save it twice. The attempt's usage counts too, from `stream.currentMessage`. SDK 0.133 raises the error at the tool
  block's `content_block_stop`, before `message_delta`, so that usage has the input and cache tokens but only the
  output tokens `message_start` reported.
- **Caching:** tools → system → messages is the API's prefix order, so the first breakpoint caches the tools and the
  instructions, the second adds the frozen context, and the automatic one moves along the conversation. 3 of 4
  breakpoints, all 5-minute. The minimum cacheable prefix on both models is 512 tokens. The unit tests check the
  request shape; the cache read share is live check A2.
- **Conversation:** an opaque `AgentConversation` with the model id; the messages live in a `WeakMap` inside the
  provider. Each assistant turn goes in as received (apart from the fallback rule above) and is never edited, so
  thinking blocks and their signatures go back unchanged. A conversation from another model, or one the provider
  didn't make, throws an `Error` (a programming error, not a `ProviderError`).
- **Stop reasons:** `tool_use` runs the tools; `pause_turn` resends; `end_turn` ends with `stopped: 'done'`;
  `max_tokens` on a text answer ends with `stopped: 'limit'` and the text so far; `max_tokens` with a tool call is
  `bad_output` (the input may be cut off, so the call never runs); `refusal` is `refused` with
  `stop_details.category` in `detail`, and the partial reply isn't kept. After `maxIterations` (35) requests with
  tools still running, the run ends with `stopped: 'limit'`; the conversation then ends with the tool results, and
  a follow-up question joins that user turn.
- **Events:** `text` deltas as they stream (with a `

` delta between the text of two replies), a `tool` event as
  each call finishes (`activity`, `isError`), `retry` before a re-send (see *Tools*), and `usage` after each
  request: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. The run
  returns the summed usage. After a fallback the top-level usage covers the attempt that produced the message
  (`usage.iterations` isn't read).
- **Errors:** `toProviderError` from `claude.ts`, then `withoutSecret`. An abort is `aborted`, also between tool
  calls.
- **Cost:** `estimateCostUsd(model, usage)` in `models.ts`, from `MODEL_PRICES` (per million tokens): Sonnet 5.5
  $2 in, $10 out, $0.20 cache read, $2.50 cache write; Opus 5.5 $4, $20, $0.20, $5. Unknown models give `null`.

## Project agent with Gemini (Phase 20)

`src/providers/llm/geminiAgent.ts` (`createGeminiAgent`) implements the same `AgentProvider` contract as
`claudeAgent.ts`; `getAgentProvider(id, key, model)` picks one by the project model's provider. `askProject`, the
tools, the caps, the instructions and `parseAnswer` are shared and unchanged.

- **Loop: manual, streamed.** `ai.models.generateContentStream` per request, with `automaticFunctionCalling: {
  disable: true }` (an SDK setting; nothing of it reaches the API). The SDK's automatic continuation is kept, as in
  `gemini.ts`.
- **Request** (every iteration, SDK 2.29.1):

  ```ts
  ai.models.generateContentStream({
    model,                                        // the project model; a conversation keeps its model
    contents,                                     // the conversation, append-only
    config: {
      systemInstruction: { parts: [{ text: instructions }, { text: context }] },  // least-changing first
      tools: [{ functionDeclarations }],          // the 4 tools, always in this order
      automaticFunctionCalling: { disable: true },
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },  // GEMINI_THINKING
      maxOutputTokens: 64000,                     // AGENT_MAX_OUTPUT_TOKENS (Argon's limit is 65,536)
      abortSignal,
    },
  })
  ```

  On the wire: `POST …/v1beta/models/{model}:streamGenerateContent?alt=sse` with `systemInstruction`, `contents`,
  `tools` and `generationConfig: { maxOutputTokens, thinkingConfig }`.
- **Tools:** each `AgentTool` is a `functionDeclaration` with `parametersJsonSchema: toGeminiSchema(tool.input)`.
  Google's schema docs list `minimum` and `maximum` but not the exclusive bounds, so `toGeminiSchema` writes zod's
  `exclusiveMinimum` (from `.positive()`) as the inclusive bound on an integer and drops it on a number; the zod
  parse of the arguments still checks it. A rejected argument, an unknown tool or a tool that throws becomes a
  `functionResponse` with `response: { error }`; a result is `response: { output }` (the keys Google's types
  document).
- **Parallel calls** run with `Promise.all`. Their responses go back in one user turn, in the order of the calls,
  each with the call's `name` and, when the call has one, its `id` (Google's signatures page: "FC1 + signature, FC2,
  FR1, FR2"; interleaving them is a 400).
- **Thought signatures** (Google's "Thought signatures" page for `generateContent`, read 2026-10-21): a function
  call carries one; of parallel calls only the first does; a reply without a call has one on its last part, and in
  a stream it may come on a part with empty text. A missing signature on the current turn's function calls is a
  400; earlier turns aren't checked. The adapter keeps **every part of every chunk, unchanged and in order** as the
  model's turn, with nothing merged (as the SDK's own `Chat` does), and sends it back as it came. Text deltas come
  from parts that have text and aren't `thought`.
- **Caching:** implicit only. Nothing is created or deleted (`caches.create` isn't used: it costs storage). The
  same run sends the same `systemInstruction`, `tools` and `generationConfig` on every request (a unit test pins
  it), so the conversation's prefix is stable. Live check A2 shows the cached share.
- **Usage:** `promptTokenCount` includes `cachedContentTokenCount`, and `thoughtsTokenCount` is separate from
  `candidatesTokenCount`. So `inputTokens = promptTokenCount − cachedContentTokenCount + toolUsePromptTokenCount`
  (the last is for built-in tools, so 0 here), `outputTokens = candidatesTokenCount + thoughtsTokenCount`,
  `cacheReadTokens = cachedContentTokenCount`, `cacheWriteTokens = 0`. The last `usageMetadata` of each stream is
  used (the SDK sums it across continuations).
- **Finish reasons**, checked after each reply in this order:

  | Reply | Result |
  |---|---|
  | `promptFeedback.blockReason` | `refused` |
  | `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII` | `refused` (the partial reply isn't kept) |
  | `MALFORMED_FUNCTION_CALL`, `UNEXPECTED_TOOL_CALL` | the same request again, once in a row; then `bad_output` |
  | `MAX_TOKENS` with a function call | `bad_output` (the call never runs) |
  | `TOO_MANY_TOOL_CALLS` | `bad_output` |
  | `MAX_TOKENS` on a text answer | `stopped: 'limit'`, with the text so far |
  | no function call | `stopped: 'done'` |

  Google documents no retry policy for a malformed call. Forum reports describe it as intermittent (sometimes
  deterministic on long contexts), so one re-send, as Claude's unreadable tool JSON gets, and then an error. As with
  Claude, a `retry` event takes back the text the malformed attempt streamed. Its usage is already counted.
- **Errors:** an abort is `aborted` (checked first, also between tool calls). Otherwise `toProviderError` from
  `gemini.ts` (401/403/`API_KEY_INVALID` → `auth`, 402 and a daily quota → `quota`, 429 → `rate_limit`, 5xx →
  `server`, a failed fetch → `network`, another `TypeError` → `unknown`), then `withoutSecret`.
- **Conversation:** an opaque `AgentConversation` with the model id; the contents live in a `WeakMap` inside the
  provider. A conversation from another model, another provider (a Claude conversation is unknown here) or one the
  provider didn't make throws an `Error`.
- **Cost:** `MODEL_PRICES` (per million tokens) has 3.8 Flash $1.50 in, $7.50 out, $0.15 cache read and 4 Argon $4,
  $20, $0.20, no cache writes. These are the prices from 2026-12-01 (Argon) and 2027-01-01 (Flash), twice today's:
  the maintainer chose to over-estimate until then rather than date the prices.

## Resuming a saved chat (Phase 21)

Chats are saved in the project folder (DECISIONS.md D29). The provider's own conversation can't be saved: it holds
SDK shapes (AGENTS.md rule 5), and Claude's thinking blocks are only valid in the conversation that produced them. So
`AgentProvider.resume(history)` makes a new conversation from the saved questions and finished answers, as text:

- **Claude** (`claudeAgent.ts`): alternating `{ role: 'user', content: question }` and `{ role: 'assistant',
  content: [{ type: 'text', text: answer }] }`, with the quote tags left in the answers. There are no thinking or tool
  blocks. The `claude-api` skill (read 2026-10-27, "Breaking change 3", preserved thinking) checks only the thinking
  blocks that are sent back, and enforces this by default for accounts created on or after 2026-08-31. Its guidance on
  client-side compaction says turns may be sent with their thinking blocks stripped ("text and tool calls can stay").
  A history with no thinking blocks has nothing to check.
- **Gemini** (`geminiAgent.ts`): alternating `user` and `model` contents with one text part each. Google's thought
  signatures page (read 2026-10-21 for Phase 20) requires signatures only on the current turn's function calls, so
  earlier model turns without them are accepted.
- The context is rebuilt when the chat is opened, with the chat's session keys kept, so `s3/t12` in the history still
  means the same turn. The first request of a resumed chat writes a new cache. The agent doesn't remember what it
  read before, so it searches again when it needs to.
- Live checks H1 (Claude) and H2 (Gemini) below.

## Compacting a chat (Phase 22)

`/compact` (DECISIONS.md D33) has the agent summarise the chat, then carries on from the summary alone. The
`claude-api` skill, read 2026-10-30, was the guide:

- **The shape** is the skill's "simple compaction" (model-migration, "Breaking change 3", the append-only table):
  summarise the conversation into one message, start the next request from it and the new turn, and replay nothing
  older. Nothing carried over is tied to the old transcript, so preserved thinking has nothing to check. The skill
  says Claude models are trained on this scheme, and that it performs comparably to more elaborate ones.
- **The summary request** is one `AgentProvider.run()` on the conversation, with the same `system`, tools, thinking,
  effort and `tool_choice` as a question. The skill's "Invalidation hierarchy" (prompt-caching) says that changing
  `tool_choice`, thinking or effort drops the messages cache. With none of them changed, the whole chat is read from
  the cache. Its tools run on a spent budget, so a call gets "Tool budget reached" rather than more reading.
- **The new conversation** is `resume([{ question: COMPACTED_LEAD, answer: summary }])`: the summary goes back as the
  assistant's own answer, so Claude sees no edited history and Gemini's turns still alternate. The tools and system
  cache survive; the messages cache starts again with the next question.
- **Not used:** server-side compaction (beta `compact-2026-01-12`, by threshold, and on-demand compaction, beta
  `compact-2026-09-04`, `"compaction": {"type": "summarize"}`). The skill prefers them where they fit, but
  `@anthropic-ai/sdk` 0.133 types neither, Gemini has no equivalent, and the signed block they return couldn't be
  kept in a chat file (D29). On-demand compaction could replace the summary request for Claude later. It needs the
  beta header on every later request and can't be combined with `context_management`.
- Live check C1 below.

## Data-flow statement (shown to users)

> DeScribe runs in your browser. Nothing is sent anywhere except as described below.
>
> **Transcribe.** Your recording and glossary are sent to ElevenLabs for transcription. If you choose **Translate
> to English**, the transcript text and glossary (not the audio) are sent to the provider you pick, Anthropic
> (Claude) or Google (Gemini).
>
> **Analyse.** If you add a session to a project, its transcript is saved in the project folder you chose. To
> translate and summarise a session, its text and the project brief are sent to the provider chosen for the
> project, Anthropic (Claude) or Google (Gemini). When you ask about a project, your question, the brief, the
> summaries and the transcript passages the model reads are sent to the same provider. Chats are saved in the
> project folder, where everyone who can open it can read them.
>
> **In this browser.** Your API keys, glossary, settings and last transcript, the link to your project folder, and
> a copy of the project's transcript text so it opens quickly.

The chat's sentence (PROJECTS.md §5.8) came with the chat, in Phase 17. The project sentence names either provider
from Phase 19 (D26), and the chat's sentence refers to it from Phase 20, when the chat works with either. On
2026-10-22 it was split into Transcribe, Analyse and In this browser for the Settings page (D27), and now also
names the glossary, the brief, the question itself, that chats aren't kept, and what release 2 keeps in the
browser. Phase 21 (D29) changed "Chats aren't kept" to say where chats are saved and who can read them.

## Verification log

| ID | Question | Result | Date |
|---|---|---|---|
| L1 | Claude: does `messages.parse` + `zodOutputFormat` work in the single-file build under the CSP (no eval errors)? | **Yes**, as `beta.messages.create` + `betaZodOutputFormat` (see Claude above). The e2e specs run the built file over `file://` with the CSP, and the console guard sees no error. No `eval` or `new Function` comes from the SDK. The bundle's only `Function(...)` calls are docx's dead polyfills and zod's `allowsEval` probe, which jitless mode skips (T8). `@anthropic-ai/sdk` 0.133 adds about 346 KB. | 2026-10-13 |
| L2 | Gemini: does `@google/genai` bundle into the single file, and how much size does it add? Which schema field works? | **Yes**, through `@google/genai/web`. 2.29.1 adds about 381 KB, under T6's 1 MB, so the REST fallback is not needed. The schema field is `responseJsonSchema` (typed in `web.d.ts`, sent as `generationConfig.responseJsonSchema`). Both SDKs together: 632 → 1,236 KB (198 → 327 KB gzip, as Vite reports it). The live request shape is still unchecked (L3). | 2026-10-13 |
| S1 | Summary quality on a real German session and a real English one, with Sonnet 5.5 and Opus 5.5: themes, respondent details, findings per research question, quotes | *Pending* (no real API calls until the maintainer asks). Assumption until then: the prompt and check as built in Phase 13. | – |
| S2 | Tokens and cost per hour of transcript for a summary, with each model (input, output including thinking) | *Pending*. Estimate (PROJECTS.md §3): ≈ $0.10 an hour with Sonnet 5.5, ≈ $0.20 with Opus 5.5. | – |
| S3 | Dropped-quote rate: the share of a summary's quotes the check doesn't find, and how often the retry runs | *Pending*. Assumption: under a third, so the retry is rare. | – |
| L3 | Translation quality and cost for a 30 min German transcript with each default model (rough tokens and €) | **Accepted for 1.0 as a known limitation** until [TESTING.md](../TESTING.md) scenario 7 is run on the release file with the maintainer's keys; the result goes here. That run also confirms that the real APIs accept the browser's CORS preflight for every SDK header (`x-stainless-*`, `anthropic-beta`); the e2e mocks allow all headers. Until then: the defaults in `models.ts`, effort `medium` (T9). | 2026-10-14 (accepted) |
| A1 | Project agent: quote recall on 10 questions with known answers, with Sonnet 5.5 and Opus 5.5 (planted quotes found, quotes verified) | *Pending* (no real API calls until the maintainer asks). Assumption: the instructions and tools as built in Phase 16. | – |
| A2 | Project agent: cost per question, and the share of input read from the cache | *Pending*. Estimate (PROJECTS.md §3): $0.25–1 per question with Sonnet 5.5; most input cached after the first request. | – |
| A3 | Project agent: effort `medium` against `high` (answer quality, tool calls, cost) | *Pending*. Until then `medium` (T9). | – |
| A4 | Project agent: the real API accepts the browser's CORS preflight with the agent's headers (`anthropic-beta`, `x-stainless-*`) from `Origin: null` | *Pending*. The agent sends the same headers as translation (no tool-runner helper header), so L3's check covers it once run. | – |
| G1 | Gemini accepts `responseJsonSchema` for the summary schema (with the nullable `speakerId` as a type array), and the streamed reply parses: the same request as the unit tests. Also closes L3 for Gemini translation. | *Pending* (no real API calls until the maintainer asks). Assumption: the request as built in Phase 19. | – |
| G2 | Gemini summary quality on the S1–S3 sessions (a real German one and a real English one), with 3.8 Flash and 4 Argon: the dropped-quote rate, tokens, time and cost per hour, against Sonnet 5.5 | *Pending*. Prices are above. | – |
| A1–A4 (Gemini) | Phase 18's A1–A4 with Gemini 3.8 Flash and Gemini 4 Argon: quote recall against Sonnet 5.5; cost per question and the cached share (implicit caching); thinking `MEDIUM` against `HIGH`; CORS for `:streamGenerateContent?alt=sse` with function calling, and that Gemini accepts the tools' `parametersJsonSchema` | *Pending* (no real API calls until the maintainer asks). Assumption: the request as built in Phase 20. | – |
| G3 | CORS from `file://` for `:streamGenerateContent?alt=sse`, and a real 429 from a spent quota and from a rate limit: what their bodies and details say | *Pending*. Until then, the 429 mapping above and the queue rule (a Gemini `rate_limit` stops **Summarise all**). | – |
| H1 | A resumed chat with Sonnet 5.5 and Opus 5.5, on an account created after 2026-08-31 (preserved thinking enforced): earlier turns as text only, then a question that uses tools | *Pending* (no real API calls until the maintainer asks). Assumption: accepted, since no thinking block is sent back (see "Resuming a saved chat"). | – |
| H2 | A resumed chat with Gemini 3.8 Flash and 4 Argon: earlier model turns without thought signatures, then a question that calls functions | *Pending*. Assumption: accepted, since only the current turn's function calls need signatures. | – |
| C1 | `/compact` on a long chat with Sonnet 5.5, Opus 5.5, Gemini 3.8 Flash and Gemini 4 Argon: the summary request reads its prefix from the cache (`cache_read_input_tokens`), the summary keeps what follow-up questions need, and a question after it is accepted | *Pending* (no real API calls until the maintainer asks). Assumption: accepted, since the new conversation is text only, as in H1 and H2. | – |
| K1 | Claude key check: `GET /v1/models?limit=1` from `file://` (`Origin: null`) passes the CORS preflight with the SDK's headers, a valid key gets 200, a wrong one 401 `authentication_error` | *Pending* (no real API calls until the maintainer asks). Assumption: as for messages (L3), since the SDK sends the same headers. | – |
| K2 | Gemini key check: `GET /v1beta/models?pageSize=1` from `file://` passes CORS, a valid key gets 200, a wrong one 400 with `API_KEY_INVALID` | *Pending*. Assumption: the 400 body already mapped for `generateContent`. | – |
