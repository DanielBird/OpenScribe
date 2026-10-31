# Phase 17 — Project chat

**Goal:** Researchers ask questions about their project in a chat in Project mode. Answers stream in, show what
the agent searched and read, and present quotes as checked cards that can be copied with their citation. **Stop**
and **New chat** work, and nothing about the chat is kept.

**Depends on:** Phases 15 (Project mode with summaries, `QuoteCard`) and 16 (`askProject`, `parseAnswer`,
`renderContext`, the price table).

**Read first:**
- [PROJECTS.md](../PROJECTS.md) §2 (A9, A10, A12, A17, A18), §5.5, §5.6;
- [DECISIONS.md](../DECISIONS.md) D3, D13, D22, D23, T13;
- the Handoffs of Phases 15 and 16; AGENTS.md rule 9.
- For ideas only, not to copy: the [Nuxt chat template](https://chat-template.nuxt.dev/). Take its streamed
  answers, collapsible reasoning and tool display, and its prompt box with Stop. Not its history sidebar, uploads
  or sign-in.

## Agreed with the maintainer (2026-10-15)

- Chats aren't kept (A9).
- The agent runs to the end within the caps. What it searched and read is shown, collapsed (A10, A18).
- Quotes leave Describe by **Copy with citation** (A12).
- The model is the project model, Sonnet 5.5 by default (A17).

## Decided in this file (the maintainer can still change them)

- **The right-hand pane shows the chat** when no session is selected. Selecting a session shows its summary;
  **Back to chat** (or Escape) returns. The conversation carries on in memory.
- **A conversation is frozen when it starts:** the model, the sessions (as cards) and the brief.
- **Gemini (D26, proposed 2026-10-21):** if Phase 19 is done, the project model can be a Gemini model. Until Phase 20,
  the chat is offered only with a Claude model. With a Gemini model selected, one line replaces the input: "The chat
  needs a Claude model. Choose one above." (draft).
- **Notices, shown only when they apply (D13):**
  - "3 new sessions since this chat started." with **New chat** — when sessions were added or summarised after
    the chat started;
  - "The model change applies to your next chat." — when the model select changed during a chat;
  - "This chat is long. Start a new chat for best results." — when the last request's input passed
    `AGENT_LIMITS.longChatTokens`;
  - "Stopped after 30 steps." under an answer that hit the iteration backstop.
- **The input:**
  - Enter sends, and Shift+Enter starts a new line;
  - **Send** turns into **Stop** while an answer streams;
  - the input stays usable while an answer streams, but sending waits until it finishes;
  - the placeholder (draft) is "Ask about the project…". There are no example prompts (D13).
- **Each answer has:**
  - a collapsed `<details>` whose summary reads "6 searches · read 5 sessions · ≈ $0.40". It opens to the list of
    activity lines.
  - **Copy all quotes** when it has two or more verified quotes.
  - the cost, from `estimateCostUsd`, as "≈ $0.40", or nothing if it is unknown.
- **A quote card that isn't verified** shows the model's text in a muted style, labelled "Not found in the
  transcript", and has no **Copy**.
- **Errors** appear in place of the answer, with the provider's message and **Try again**, which sends the same
  question again. A missing Claude key opens the same small key dialog as Translate.
- **Screen readers:** the streaming text isn't announced as it arrives. A visually hidden status says "Answering…"
  and then "Answer ready" (or the error). Focus stays in the input.

## Tasks

1. **`stores/chat.ts`** (contract below)
   - `ask(question)`:
     - on the first question, build the frozen snapshot: `createCorpusReader` from the project store's texts and
       summaries, `renderContext`, and the model and key from settings;
     - run `askProject` with an `AbortController`;
     - apply its events to the current assistant message: append text, re-parse the blocks at most once per
       animation frame (`parseAnswer(..., { streaming: true })`), add activity lines, add up the usage;
     - on success, store the conversation; on an error, keep the conversation as it was before the question.
   - `stop()` aborts the stream. The partial answer is kept and marked "Stopped", and the conversation stays as it
     was before that question, so the next question doesn't include half an answer.
   - `newChat()` clears everything, including the snapshot.
   - Computed: `newSessionCount`, `modelChanged` and `isLong`.
   - Nothing is written to storage.
2. **UI**
   - **`ChatPane`:** the message list, the notices, and `ChatInput`. It scrolls to follow the stream unless the
     user has scrolled up.
   - **`ChatMessage`:** a user message as plain text; an assistant message as `AnswerBlocks`, then
     `ChatActivity`, then **Copy all quotes**.
   - **`AnswerBlocks`:** renders `AnswerBlock[]` with template elements (`<p>`, `<h3>`, `<ul>`/`<ol>`, `<strong>`,
     `<em>`, and `QuoteCard` for quotes). **No `v-html`** anywhere in the chat; an ESLint rule (`vue/no-v-html`)
     guards it.
   - **`QuoteCard`:** reuse Phase 15's, with the verified and not-found variants.
   - **`ChatActivity`:** the `<details>` above.
   - **`ChatInput`:**
     - a labelled `<textarea>` that grows with `field-sizing: content` (as in Phase 9), up to about 8 lines;
     - Enter, Shift+Enter and IME composition handled as in `TurnItem`.
   - **`ProjectView`:** the chat in the right-hand pane, swapping with the summary as decided above. **New chat**
     sits in the pane's header, shown only when the chat has messages.
3. **Copy:** quotes use `formatCitation` and `formatCitations` via `ui/clipboard.ts`. A **Copy** button's
   accessible name includes the start of the quote, e.g. "Copy quote: I just put them on the…".
4. **Docs:**
   - USER_GUIDE: "Ask about a project". Cover how the agent searches, the checked quotes (and what "Not found in
     the transcript" means), Copy, costs and caps, that chats aren't kept, and New chat.
   - TESTING.md: the new specs, and a manual row for a real question on a real project (live check A1 in
     Phase 18).
   - CHANGELOG.

## Contracts introduced

```ts
// stores/chat.ts
export interface ChatUserMessage { role: 'user'; id: string; text: string }
export interface ChatAssistantMessage {
  role: 'assistant';
  id: string;
  text: string;
  blocks: AnswerBlock[];
  activity: string[];
  usage: AgentUsage;
  costUsd: number | null;
  status: 'streaming' | 'done' | 'stopped' | 'limit' | 'error';
  error: ProviderError | null;
}
export type ChatMessage = ChatUserMessage | ChatAssistantMessage;

messages: ShallowRef<readonly ChatMessage[]>;   // replaced, never mutated in place
running: ComputedRef<boolean>;
model: Ref<string | null>;                       // frozen at the first question
newSessionCount: ComputedRef<number>;
modelChanged: ComputedRef<boolean>;
isLong: ComputedRef<boolean>;
ask(question: string): Promise<void>;
retry(): Promise<void>;                          // the last question again, after an error
stop(): void;
newChat(): void;
```

## Acceptance criteria

- [ ] A question streams an answer. Its activity lines and cost show in the collapsed details, and its quotes show
      as cards.
- [ ] Verified quotes show the transcript's words, the speaker, the time, the session title and "translated from
      …" where it applies. **Copy** and **Copy all quotes** give the citation format. Unverified quotes are marked
      and can't be copied.
- [ ] A follow-up question continues the conversation. **New chat** starts afresh, with a new snapshot.
- [ ] **Stop** ends the stream at once, and keeps the partial answer marked as stopped. The next question works.
- [ ] The three notices appear exactly when they apply, and the backstop message appears under a capped answer.
- [ ] Errors show with **Try again**. A missing key opens the key dialog.
- [ ] No `v-html` is used, and the lint rule enforces it. Model text that looks like HTML shows as text.
- [ ] The screen-reader status and focus behave as decided. The axe and keyboard specs cover the chat, including
      Stop and the details.
- [ ] Definition of Done in AGENTS.md. No real API calls (live checks in Phase 18).

## Required tests

- `stores/chat.spec.ts`, with a fake `AgentProvider`:
  - the snapshot is built once;
  - events are applied, and parsing is throttled (fake timers or a mocked rAF);
  - success, error and retry;
  - stop: the conversation is unchanged and the partial answer kept;
  - `newChat`;
  - the three computed notices;
  - nothing reaches storage.
- Component specs:
  - `AnswerBlocks`: every block kind, and HTML-like text;
  - `QuoteCard`: both variants and Copy;
  - `ChatActivity`;
  - `ChatInput`: Enter, Shift+Enter, IME, Send and Stop;
  - `ChatPane`: following the stream, and the notices;
  - `ProjectView`: switching between summary and chat.
- `tests/e2e/chat.e2e.ts` (a seeded project; Claude mocked with scripted SSE: tool calls, then an answer):
  - ask → streamed answer → details → a verified quote → Copy (clipboard);
  - an answer with an invented quote → marked;
  - a follow-up (the request body carries the earlier turns);
  - **Stop** in the middle of the stream;
  - **New chat**;
  - a new session added to the folder, then focus → the notice;
  - a 429 → the message → **Try again**.
- `a11y.e2e.ts` and `keyboard.e2e.ts`: the chat states.

## Out of scope

- Keeping or sharing chats, quote collections, and .docx answers (A9, A12; PROJECTS.md §10).
- Opening a quote at its turn in the transcript, or playing it.
- Example prompts, and a model picker inside the chat (the header has the model select).

## Handoff

*(UI text trimmed under D13, how streaming render performed on long answers, notes for 18.)*

### 2026-10-21 — Phase 17 done (branch `phase-17-project-chat`, from `main_phase2` at the Phase 16 commit)

**Agreed with the maintainer while planning**
- **Wide windows:** the right-hand pane is pinned. It is as tall as the window between where it starts and the
  footer, measured in `ProjectView`. Messages scroll inside it, and the question box stays on screen. A summary
  scrolls inside the same pane.
- **Narrow windows (≤48rem):** with no session selected, the list shows with the chat below it (80dvh). A selected
  summary replaces both, as before. **Back to chat** shows on wide windows only; narrow windows keep **Sessions**.

**Changed from this file**
- `ChatAssistantMessage.activity` is `{ tool, line, isError }[]`, not `string[]`. The details summary counts by tool,
  because the activity lines can't be parsed reliably to count sessions.
- The store also exposes `needsKey` and `corpus`. `corpus` is the chat's frozen `CorpusReader`, which
  `AnswerBlocks` uses for a not-found quote's session title.
- `providers/index.ts` has `getAgentProvider(apiKey, model)` and `setAgentProviderFactoryForTests`.
- A new `KeyDialog` component (built on `ConfirmDialog` and `ApiKeyField`, with a slot for the data line) is the
  chat's key dialog. `SummariseDialog` is unchanged; it could move to `KeyDialog`.
- **Copy all quotes** is now a component, `CopyAllQuotes`, used by `SessionSummary` and the chat. It uses
  `formatCitations`; the output is the same.
- `QuoteCard`:
  - `speaker` and `start` may be `null`, for a not-found quote whose turn is unknown;
  - the Copy button is named after the quote's first six words ("Copy quote: I put them on the charger…"), in
    summaries too.
- The ROADMAP ◐ commit at the start was folded into the phase commit.

**UI text trimmed under D13**
- The details summary reads "2 searches · 3 reads · ≈ $0.40":
  - reads are `read_transcript` and `get_summaries`;
  - with no searches or reads, it gives "N steps";
  - parts that are zero are left out;
  - the cost shows as "< $0.01" when it is tiny, and the line shows only the cost when no tool ran.
- The backstop line is "Stopped at a limit. The answer may be incomplete." rather than "Stopped after 30 steps.":
  `limit` also covers the 35-request backstop and an answer cut off at `max_tokens`.
- "Stopped" marks a stopped answer.
- The box has a visually hidden label, "Question". The pane has a hidden h2, "Chat".
- The key dialog is titled "Ask about the project" and its button is **Ask**. Its data line: "Your question, the
  project brief and the session summaries are sent to Anthropic, with the transcript passages the agent reads to
  answer."
- The chat's data-flow sentence is from PROJECTS.md §5.8. It is in the About dialog, `reference/llm-providers.md`
  and the User Guide.

**Behaviour worth knowing**
- **Send and Stop:** one `<button>` whose label and `type` change, so focus stays on it when it turns back into
  **Send**. While an answer runs, Enter in the box does nothing and the draft stays.
- **Escape** in a summary returns to the chat, unless it comes from a field or a dialog. **Back to chat** and Escape
  focus the question box on wide windows, and the list's session on narrow ones.
- **Activity while streaming:** an answer's activity details show while it streams (with no cost yet), so a long
  tool loop with no text shows progress.
- **Following the stream:** the list follows the answer while it is within 32px of the bottom. Sending a question
  follows again.
- **Stacking:** `.messages` is `position: relative`, so the quote cards' visually hidden `aria-live` lines stay
  inside its scroll area. Without it, on narrow windows the page grew to 10,000px.
- **Errors:**
  - The partial text of a failed answer is dropped, as the Phase 16 Handoff says. Its activity and cost so far are
    kept.
  - Anything thrown that isn't a `ProviderError` becomes `unknown`, with "Something went wrong. Try again."
- The chat resets when `project.project.id` changes: a project switch, or Clear saved data.
- The app has no dark theme, so there was no dark-mode check.

**Streaming render on long answers**
- **Method:** a scripted 3,499-word answer with 15 quotes, measured in Playwright (1280×800, normal CPU), with a
  temporary spec that wasn't committed.
- **Result:** 55–77 ms from Enter to "Answer ready", no long tasks (PerformanceObserver), and the list at the
  bottom.
- **Caveat:** Playwright fulfils a route with the whole body at once, so the SDK read every delta at once and only a
  few frames parsed.
- **For Phase 18:** time a real streamed answer (live check A1), or a `ReadableStream`-backed mock. Each frame
  re-parses the whole text with `parseAnswer`, so cost grows with the answer's length. Look there first if frames
  drop.

**For Phase 18**
- **Live check A1** and manual row 18 in `TESTING.md` are open. No real API call was made.
- **Measure the cost:** check the activity summary and the cost against real usage (A2).
- **Gemini (Phases 19 and 20):** the "chat needs a Claude model" line belongs in `ChatPane`, and the guard belongs
  where the store calls `getAgentProvider`. `PROJECT_MODELS` has only Claude models until Phase 19.
- **The `translate.e2e.ts` failure:** it failed once in a full run with an ENOENT on a trace artifact. It was a
  side effect of running another Playwright command at the same time, which cleared `test-results/`. The next full
  run passed (101 of 101).
- **Bundle size:** 1,474,203 → 1,508,780 bytes (`features/agent` and `claudeAgent.ts` are now imported).
