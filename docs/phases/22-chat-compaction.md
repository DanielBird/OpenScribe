# Phase 22 — Compacting a chat with `/compact`

**Goal:** A long chat can go on without starting again. Typing `/compact` in the question box has the agent summarise
the conversation so far; from then on it carries on from that summary alone, so its requests are small again. The
long-chat notice suggests it.

**Status of the plan:** asked for by the maintainer on 2026-10-30 (DECISIONS.md **D33**). Phase 16 left compaction out
of scope, and Phase 17 added the long-chat notice instead.

**Depends on:** Phases 17 (the chat and its notices), 20 (Gemini for the agent) and 21 (saved chats, `resume`).

**Read first:**
- [PROJECTS.md](../PROJECTS.md) §5.5;
- [DECISIONS.md](../DECISIONS.md) D13, D26, D29, D33;
- [reference/llm-providers.md](../reference/llm-providers.md): "Resuming a saved chat" and "Compacting a chat";
- the `claude-api` skill before touching the prompt in `features/agent/compact.ts` (CLAUDE.md).

## Agreed with the maintainer (2026-10-30)

- **The command:** `/compact` in the question box. Text after it is optional and says what to keep:
  `/compact keep the charging quotes`.
- **The notice:** the long-chat notice recommends `/compact`.
- **What the pane shows:** the earlier questions and answers stay readable. A divider marks where the agent's memory
  now starts, with the summary behind a `<details>`. The saved file keeps everything.

## Decided in this file (the maintainer can still change them)

1. **Simple compaction, the same for Claude and Gemini.** The `claude-api` skill (read 2026-10-30) recommends this
   shape for client-side compaction: summarise the conversation, then start the next request from the summary and
   the new question, and replay nothing older. Nothing carried over belongs to the old transcript, so Claude's
   preserved-thinking check has nothing to fail; it is how `resume()` already works for saved chats (Phase 21).
2. **Not Claude's server-side compaction** (beta `compact-2026-01-12` by threshold, or on demand with
   `compact-2026-09-04`): `@anthropic-ai/sdk` 0.133 types neither, Gemini has nothing like it (D26 keeps one
   contract), and a reopened chat resumes from text (D29), so a signed compaction block couldn't be kept anyway. On-demand
   compaction is a possible later swap for Claude.
3. **No provider change.** The summary is one ordinary `AgentProvider.run()` on the conversation, with the same
   instructions, context, tool definitions, effort and `tool_choice` as every question, so its whole prefix is read
   from the cache. Changing `tool_choice` or effort would drop the messages cache (the skill's prompt-caching
   "Invalidation hierarchy"), so neither changes. The tools run on a spent budget: a tool call gets the usual "Tool
   budget reached" reply.
4. **The new conversation** is `resume([{ question: COMPACTED_LEAD, answer: summary }])`: the summary is the model's
   own answer, so it goes back as an assistant turn after a fixed question. User and model turns still alternate, as
   Gemini needs. The tools and instructions stay cached; only the messages cache starts again.
5. **What is kept:** finished answers only. Nothing to compact (no finished answer since the last compaction) gives a
   short note, and the request isn't sent. **Stop** during a compaction changes nothing. A failure shows in place with
   **Try again**, and the conversation is as before.
6. **Saved chats:** the file gains a third kind of message, `{ role: 'compaction', id, at, summary, focus, costUsd,
   model }`. `CHAT_SCHEMA_VERSION` stays 1: chat files are still under *Unreleased* in the changelog, so no release
   has written one. A reopened chat resumes from its latest summary and the questions and answers after it.

## Tasks

1. `domain/chat.ts`: `ChatFileCompaction`, `parseChatCommand`, and `historyOf` (it replaces `exchangesOf`).
2. `storage/chatFiles.ts`: the compaction schema.
3. `features/agent/compact.ts`: the prompt, `COMPACTED_LEAD`, `compactedHistory`, `compactChat`. `tools.ts`:
   `spentBudget()`. `limits.ts`: `compactIterations`.
4. `stores/chat.ts`: `submit`, `compact`, the compaction entry, `commandNote`; saving, opening, **Stop** and **Try
   again** with compactions.
5. UI: `ChatCompaction` (the divider), `ChatPane` (submit, the notice, the note, the status), `ChatMessage` (its
   prop narrowed).
6. Docs: D33, PROJECTS.md, ROADMAP, the reference doc, the User Guide, the changelog.

## Contracts introduced

```ts
// domain/chat.ts
export interface ChatFileCompaction {
  role: 'compaction'; id: string; at: string;
  summary: string;  // as the model wrote it, quote tags included
  focus: string;    // the text after /compact, '' for none
  costUsd: number | null; model: string;
}
export type ChatFileMessage = ChatFileQuestion | ChatFileAnswer | ChatFileCompaction;
export function parseChatCommand(text: string): { kind: 'compact'; focus: string } | null;
export function historyOf(messages: readonly ChatFileMessage[]): { summary: string | null; exchanges: ChatExchange[] };

// features/agent/compact.ts
export function compactChat(opts: CompactOptions): Promise<{ summary: string; conversation: AgentConversation; usage: AgentUsage }>;
export function compactedHistory(summary: string, exchanges: readonly AgentExchange[]): AgentExchange[];

// stores/chat.ts (additions)
submit(text: string): Promise<void>; compact(focus?: string): Promise<void>; commandNote: string | null;
```

## Live checks (pending until the maintainer runs them)

- **C1:** `/compact` on a long chat with Sonnet 5.5, Opus 5.5, Gemini 3.8 Flash and Gemini 4 Argon: the summary
  request reads its prefix from the cache, the summary keeps what the next questions need, and a question after it
  is accepted and answers from the summary.

## Acceptance criteria

- [x] `/compact` after an answer sends one request that ends with the compaction prompt; a divider shows while it runs,
      and the summary is behind its `<details>` once it ends.
- [x] `/compact <text>` adds the text to the prompt as what to keep.
- [x] The next question sends only the summary, after its fixed question, and the new question: no earlier turn.
- [x] The long-chat notice recommends `/compact`, and it goes once the chat is compacted.
- [x] `/compact` with nothing to compact says so and sends nothing. **Stop** keeps the conversation as it was. An
      error shows in place with **Try again**.
- [x] The saved file holds the compaction; a reopened chat shows the divider and goes on from the summary.
- [x] Definition of Done in AGENTS.md. No real API calls; C1 recorded as pending.

## Required tests

- `domain/chat.spec.ts`, `storage/chatFiles.spec.ts`.
- `features/agent/compact.spec.ts`: the request with Claude and with Gemini, the budget reply, an empty summary, the
  conversation after it.
- `stores/chat.spec.ts`, `ChatPane.spec.ts`, `ChatCompaction.spec.ts`.
- `tests/e2e/chat.e2e.ts` (compact a long chat) and `tests/e2e/chat-history.e2e.ts` (reopen a compacted chat).

## Out of scope

- Compacting without being asked (when a chat passes a threshold).
- Claude's server-side compaction (see decision 2).
- A **Compact** button, and other slash commands.
- Keeping the most recent turns as they were (keep-tail compaction).

## Handoff

### 2026-10-30 — Phase 22 done (branch `phase-22-chat-compaction`, from `main_phase2`)

**Before the phase:** typecheck, unit tests and e2e passed. Lint warned only on `src/ui/views/SettingsView.vue`, an
uncommitted edit from outside this phase. A `prettier --write src` during the phase re-wrapped that edit (same words,
new line breaks). It is still uncommitted and not part of this phase.

**As built:**
- No provider change: the summary is `AgentProvider.run()` with `compactPrompt(focus)` and tools on `spentBudget()`.
  The new conversation is `resume(compactedHistory(summary))`; the run's own conversation is dropped.
- `historyOf` replaced `exchangesOf` in `domain/chat.ts`. A reopened compacted chat resumes with `compactedHistory(
  summary, exchanges after it)`.
- `chat.submit(text)` is what the box calls; `ask` and `compact` stay public for the specs. **Stop** on an answer still
  saves it (the save moved into the answer's own stop handler); **Stop** on a compaction removes it and saves nothing.
- The summary's streamed text isn't shown, only "Compacting…"; once it ends, it is parsed like an answer, so its
  quotes are checked and can be copied.
- After a compaction, `lastRequestTokens` is 0, so the long-chat notice goes until a request is long again.
- Nothing to compact: there is no finished answer since the last compaction. `/compact` right after one says so.

**UI text (D13):**
- The notice: "This chat is long. Type `/compact` to summarise it, or start a new chat." (`/compact` in a `<kbd>`). It is
  a `div.notice` with a `p`: a notice is a flex row, which pulled the sentence apart around the `<kbd>`.
- The divider: "Compacting…" while it runs, then a `<details>` "Earlier messages summarised" with the summary and its
  cost. The live status says "Compacting…", then "Chat compacted" or the error.
- "Nothing to compact yet." as a muted note above the box, and in the live status.

**APIs:** see `reference/llm-providers.md`, "Compacting a chat". Live check C1 is pending.

**For Phase 18:** add C1 to the release checks.

**Possible follow-ups:** Claude's on-demand compaction (beta `compact-2026-09-04`) in place of the summary request once
the SDK types it; compacting automatically past a threshold.
