# Phase 20 — Gemini for the project agent

**Goal:** The project chat works with a Gemini model as well as with Claude. Answers stream, the activity shows what
the agent searched and read, quotes are checked cards, and the cost estimate covers Gemini. The researcher sees no
difference beyond the model's name.

**Status of the plan:** DECISIONS **D26** was agreed on 2026-10-21, and the maintainer pulled this phase into release
2.0 (PROJECTS.md §9 Q5). Phase 18 depends on it.

**Depends on:** Phases 16 (the `AgentProvider` contract, `askProject`, the tools and caps), 17 (the chat) and 19
(Gemini streaming, the provider-aware project model, the Gemini SSE builder). Phase 18 follows it.

**Read first:**
- [PROJECTS.md](../PROJECTS.md) §2 (A6, A9, A10, A17, A18), §5.5, §5.8, §6;
- [DECISIONS.md](../DECISIONS.md) D22, D23, D26, T9, T12, T13, T15;
- [reference/llm-providers.md](../reference/llm-providers.md): Gemini, and the "Project agent" section from Phase 16;
- the Handoffs of Phases 16, 17 and 19;
- `src/providers/llm/claudeAgent.ts` (the reference implementation), `gemini.ts`, `types.ts`, `models.ts`.
- **SDK facts:** Google's official Gemini API documentation on function calling, thinking and thought signatures,
  and context caching, and the installed `@google/genai` types. Don't guess API shapes (AGENTS.md). The
  instructions in `src/features/agent/` are shared: if they change, load the `claude-api` skill first (CLAUDE.md),
  and check both providers.

## Agreed with the maintainer

Agreed on 2026-10-21, at planning:
- **Prices:** Google doubles both models' prices soon (4 Argon on 2026-12-01, 3.8 Flash on 2027-01-01).
  `MODEL_PRICES` holds the **higher prices now**, with no date logic: the chat's cost line over-estimates until then.
- **Branch:** `phase-20-gemini-agent`, from the Phase 19 commit (Phase 19 isn't on `main` yet).

## Decided in this file (the maintainer can still change them)

- **Same contract, same features.** `geminiAgent.ts` implements `AgentProvider` from Phase 16 unchanged. `askProject`,
  the tools, `AGENT_LIMITS`, `parseAnswer` and the chat store don't learn which provider they're using. If the
  contract has to change, change it for both providers, and say why in the Handoff.
- **A manual loop.** The SDK's automatic function calling is turned off. The loop sends a request, runs the
  function calls, sends their results back, and repeats until the model answers without calling a function, or
  until `maxIterations`.
- **The conversation is append-only.** Every model turn goes back exactly as it was received, with its thought
  signatures. A conversation started with one provider or model refuses another (a programming error: throw), as in
  `claudeAgent.ts`.
- **Caching:** Gemini's implicit caching only. The request order already puts what changes least first:
  instructions, then context, then the conversation. Explicit context caches (`caches.create`) aren't used: they
  cost storage, and need creating and deleting. Revisit this if live check A2 shows a low cache share.
- **Usage:** `cachedContentTokenCount` → `cacheReadTokens`, `cacheWriteTokens` is 0. Thinking tokens count as output.
  Check how `usageMetadata` reports them and record it in the reference doc.
- **Prices:** Phase 16's price table gets the Gemini models, from Google's pricing page on the day, with the date.
  If a model has a higher price above some prompt size, `estimateCostUsd` applies it.
- **The chat notice from Phase 19** ("The chat needs a Claude model…") goes away.
- **The data-flow text** (PROJECTS.md §5.8): the chat's sentence names the chosen provider.

## Tasks

1. **`providers/llm/geminiAgent.ts`:** `createGeminiAgent({ apiKey, model, fetch?, maxRetries? }): AgentProvider`
   - **The request:** `systemInstruction` made of the instructions and then the context; the conversation as
     `contents`; `tools: [{ functionDeclarations }]` in the order given; automatic function calling off; the
     thinking level `GEMINI_THINKING` (Phase 19); a `maxOutputTokens` large enough for a long answer and its thinking.
   - **Tools:** each `AgentTool` becomes a function declaration whose parameters are its zod input as JSON Schema
     (`toGeminiSchema`). Validate the arguments with zod. A tool that throws, or gets arguments that don't validate,
     returns an error result with its message, as in `claudeAgent.ts`.
   - **Parallel calls:** run the function calls of one turn in parallel. Send their responses back in one turn, in the
     order the calls came, each matched by name (and by id, if the API gives one).
   - **Streaming and events:** `text` deltas from the answer text, never from thought parts; a `tool` event after
     each call, with its `activity` line; `usage` after each request.
   - **Finish reasons:** a refusal reason → `refused`; `MAX_TOKENS` → `bad_output`; `MALFORMED_FUNCTION_CALL` → find
     out from the docs whether to retry that turn once or to end with `bad_output`, and say which in the Handoff.
   - **Errors:** reuse `toProviderError` from `gemini.ts` (export it), and strip the key from every error
     (`withoutSecret`).
2. **`providers/index.ts`:** `getAgentProvider(id, apiKey, model)`, alongside `getLlmProvider`, with its test
   override.
3. **`providers/llm/models.ts`:** the Gemini prices, and `estimateCostUsd` for them.
4. **`stores/chat.ts`:** create the agent for `settings.projectProvider` with its key. A conversation keeps its
   provider and model (D23). The model notice from Phase 17 also covers a change of provider.
5. **UI:** remove the Phase 19 chat notice. The key dialog asks for the Gemini key when it's needed.
6. **`src/testing/geminiSse.ts`:** extend it for function-call parts and multi-request scripts, like Phase 16's
   `claudeSse.ts` and `agent.ts` (request n → reply n, keeping each request's body for assertions).
7. **Docs:**
   - `reference/llm-providers.md`: a "Project agent with Gemini" section (the request as built, thought signatures,
     caching, usage, prices and their date), and the pending live checks.
   - The data-flow text in the About panel, `reference/llm-providers.md` and the User Guide.
   - USER_GUIDE: the chat works with either provider.
   - CHANGELOG (2.0).

## Contracts introduced

```ts
// providers/llm/geminiAgent.ts
export interface GeminiAgentOptions {
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
  maxRetries?: number;
}
export function createGeminiAgent(opts: GeminiAgentOptions): AgentProvider;

// providers/index.ts (addition)
export function getAgentProvider(id: LlmProviderId, apiKey: string, model: string): AgentProvider;
export function setAgentProviderFactoryForTests(f: AgentProviderFactory | null): void;
```

If Phase 16 already added `getAgentProvider` for Claude, extend it instead.

## Live checks (pending until the maintainer runs them with a Gemini key)

Phase 18's A1–A4, with the Gemini model or models:
- **A1:** quote recall on the maintainer's 10 questions, compared with Sonnet 5.5;
- **A2:** cost per question and the cached share;
- **A3:** the thinking level, compared with one level higher;
- **A4:** CORS for the stream endpoint with function calling.

## Acceptance criteria

- [x] With a Gemini model, a question runs the tools, streams the answer and shows the activity and cost. Its quotes
      are checked as with Claude.
- [x] A follow-up question sends the earlier turns back unchanged, thought signatures included.
- [x] A conversation started on one model or provider keeps it. A change applies from **New chat**, with the
      existing notice.
- [x] The caps hold: the reading budget, 30 tool calls, and `maxIterations` as a backstop (`stopped: 'limit'`).
- [x] Refusal, 401, 429, a network error, abort and a malformed function call map to the right `ProviderError`s,
      without the key.
- [x] Nothing changes for Claude.
- [x] Definition of Done in AGENTS.md. No real API calls; the live checks recorded as pending.

## Required tests

- `geminiAgent.spec.ts`, with a scripted fake `fetch`:
  - one tool call then an answer; two parallel calls in one turn; a tool that throws; bad arguments;
  - thought parts kept in the conversation and never in the text;
  - the request order and the tool order are the same on every request (for caching);
  - usage mapped, cache reads included;
  - `maxIterations`; abort mid-stream and mid-tool; every finish reason and HTTP error;
  - a conversation refuses another model.
- `models.spec.ts`: Gemini cost estimates, and the higher price above the prompt-size threshold, if there is one.
- `stores/chat.spec.ts`: the agent follows the project provider; a conversation keeps its provider.
- `tests/e2e/project-chat.e2e.ts`: one conversation with a Gemini model, Gemini mocked with SSE: a question, a tool
  call, an answer with a checked quote, then **Copy**.

## Out of scope

- Explicit context caches.
- Different instructions per provider.
- Changing a conversation's provider or model mid-conversation.

## Handoff

*(The loop as built, thought signatures, how usage and caching behaved, the malformed-call choice, prices and their
date, the UI text trimmed under D13.)*

### 2026-10-21 — Phase 20 done (branch `phase-20-gemini-agent`, from the Phase 19 commit)

**The loop as built** (`providers/llm/geminiAgent.ts`; details in `reference/llm-providers.md`, "Project agent with
Gemini"):
- It follows `claudeAgent.ts` step for step. It uses `generateContentStream` with automatic function calling off.
  The system instruction is the instructions, then the context. The tools are in the given order, with
  `GEMINI_THINKING` and `maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS` (64,000).
- Parallel calls run together, and their responses go back in one user turn, in call order, with `name` and the
  call's `id` when there is one.
- A result is `response: { output }` and an error is `response: { error }`.
- **The contract didn't change.** `AGENT_MAX_OUTPUT_TOKENS` moved from `claudeAgent.ts` to `types.ts`, so both
  providers share it. `getAgentProvider` and its test factory gained the provider id as their first argument.

**Thought signatures:**
- Google's `generateContent` signatures page says:
  - a function call carries a signature, and of parallel calls only the first does;
  - a text reply has one on its last part, and in a stream it may come on a part with empty text;
  - a missing signature on the current turn's calls is a 400.
- The model's turn is every part of every chunk, unchanged and in order, with nothing merged, as the SDK's own `Chat`
  records it.
- Unit and e2e tests check that the follow-up request sends the signature back.

**The malformed-call choice:**
- Google documents no retry policy.
- `MALFORMED_FUNCTION_CALL` and `UNEXPECTED_TOOL_CALL` send the same request again once in a row, without keeping the
  bad turn, then end with `bad_output`. Claude's unreadable tool JSON is handled the same way.
- `TOO_MANY_TOOL_CALLS`, and `MAX_TOKENS` with a function call, are `bad_output`.
- Text streamed by a discarded malformed attempt stays in the chat's draft until the run ends. The final answer
  replaces it. Malformed replies have no text in practice.

**Usage and caching:**
- `promptTokenCount` includes the cached tokens, so input is prompt − cached. Output is candidates + thoughts.
  Cache writes are 0.
- Caching is implicit only. A unit test pins that the instructions, context, tools and config are the same on every
  request and on a follow-up. The real cached share is live check A2.

**Prices:**
- Google's pricing page, 2026-10-21: 3.8 Flash $1.50/$7.50/$0.15 and 4 Argon $4/$20/$0.20 (in, out, cache read).
  These are the doubled prices, by agreement.
- Neither model has a long-prompt tier, so `estimateCostUsd` is unchanged.

**Schema:**
- zod writes `.positive()` as `exclusiveMinimum`, which Google's schema docs don't list (the tool `search_transcripts`
  has `page`). `toGeminiSchema` now writes an exclusive bound as the inclusive one on an integer and drops it on a
  number. This changes nothing for the summary schema, which has neither.
- A4 should confirm that Gemini accepts the four tools' schemas.

**UI text (D13):**
- The "needs a Claude model" line is gone. The question box always shows.
- `KeyDialog` takes a `provider`. Its label and the chat's data line come from `PROVIDER_NAMES` ("…are sent to
  Google, with the transcript passages the agent reads to answer.").
- The data-flow sentence is now "When you ask about a project, the summaries and the transcript passages the model
  reads are sent to the same provider." It is the same in the About panel, the reference doc, the User Guide and
  PROJECTS.md §5.8. The User Guide's chat section says "the model" where it said "Claude".
- The model-change notice already covered a change of provider, because model ids differ. It is unchanged, with a
  test.

**Changed from this file:**
- The e2e test is in `tests/e2e/chat.e2e.ts`. There is no `project-chat.e2e.ts`.
- `toProviderError` was already exported. `REFUSAL_FINISH` is now exported too.

**Bundle:** 1,511,524 → 1,516,138 bytes.

**For Phase 18:**
- Run A1–A4 with both Gemini models (TESTING.md manual row 20). A2 decides whether explicit caches are worth
  revisiting.
- After 2026-12-01 (Argon) and 2027-01-01 (Flash), the prices in `MODEL_PRICES` are the real ones. Only the date
  comment needs a look.

### 2026-11-04 — A re-sent request takes back its text (audit BUG-5)
- The contract changed for both providers, as this phase's rule asks. Before a malformed call is sent again,
  `geminiAgent` emits `{ type: 'retry', discard }` with the text that attempt streamed, including its break, and
  the retry emits the break again. The chat store takes the text back. That replaces "Text streamed by a discarded
  malformed attempt stays in the chat's draft until the run ends" above: **Stop** during the retry saved it twice.
  The attempt's usage was already counted.

### 2026-11-04 — One loop for both agents (audit CQ-2)
- `geminiAgent.ts` no longer follows `claudeAgent.ts` step for step: both run on `providers/llm/agentLoop.ts`
  (`runAgentLoop`). `geminiAgent.ts` keeps the request, reading the stream into parts, and the finish-reason checks
  in the table in `reference/llm-providers.md`. A malformed call returns `{ resend }`, and the loop sends it again.
  A change to the loop now reaches both providers; the rule above still applies to the contract.
- `geminiAgent.spec.ts` didn't change and passes.
