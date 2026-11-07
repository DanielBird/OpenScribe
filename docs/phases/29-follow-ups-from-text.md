# Phase 29 — Follow-up questions start from the text

**Goal:** a follow-up question costs about as much as the first. Each question starts from the chat's earlier
questions and finished answers as text, as a reopened chat already does (D29). The thinking, tool calls and tool
results of earlier questions are no longer sent with every request.

**Status of the plan:** asked for by the maintainer on 2026-11-07 (DECISIONS.md **D47**). The cached prefix (tools,
instructions, context) must not change.

**Depends on:** Phase 17 (the chat store), Phase 21 (`AgentProvider.resume` and `historyOf`), Phase 22 (`/compact`
and `compactedHistory`).

**Read first:** [AGENTIC_SEARCH.md](../AGENTIC_SEARCH.md) "What the model sees" and "Across questions";
[DECISIONS.md](../DECISIONS.md) D29, D33, D47; [reference/llm-providers.md](../reference/llm-providers.md) "Resuming a
saved chat".

## Tasks

1. **`stores/chat.ts`:** `pastExchanges(messages)` is the chat's history, built as `open()` built it: `historyOf` of
   the settled messages, from the latest compaction's summary. `ask()` takes it before the new question is added and
   sends `agent.resume(past)`, or no conversation when there is none. `compact()` resumes from it when there is no
   conversation yet (an opened chat). The `history` variable goes. The latest question's conversation is still kept,
   so `/compact` summarises it with its tool results.
2. **`domain/chat.ts`:** `historyOf` leaves out an answer with no text, with its question. A `limit` answer can end
   without text, and a provider rejects an empty answer.
3. **Tests:**
   - `stores/chat.spec.ts`: a follow-up resumes from the text, after an error and Try again, after Stop, after a
     limit (an answer with no text is left out), and after `/compact`.
   - `domain/chat.spec.ts`: an answer with no text is left out.
   - `chat.e2e.ts`: the second question's request has only the text of the first (no thinking, tool call or result),
     and the same `system` and `tools`.
4. **Docs:**
   - D47, and a pointer from D29.
   - AGENTIC_SEARCH.md and PROJECTS.md §5.5. Two strings in §5.5 that no longer matched the code are fixed too.
   - reference/llm-providers.md: the Conversation bullet, "Resuming a saved chat", and the A2, H1 and H2 rows.
   - TESTING.md row 18, the ROADMAP and the CHANGELOG.

## Acceptance criteria

- [x] A question's requests carry the earlier questions and finished answers as text only. Stopped and failed
      answers are left out, and so are answers with no text.
- [x] A question's own loop is unchanged: its tool calls and results go back within the question.
- [x] After `/compact`, the next question starts from the summary, as before.
- [x] `system` and `tools` are byte for byte the same across questions. The prefix pin in `ask.spec.ts` didn't
      change.
- [x] No provider, prompt or tool file changed.

## Required tests

- `stores/chat.spec.ts`: `resumedFrom(request)` for the follow-up, Try again, Stop, limit and `/compact` cases.
- `domain/chat.spec.ts`: `historyOf` leaves out an answer with no text.
- `chat.e2e.ts`: "a follow-up leaves the earlier question's thinking, tool calls and results behind (D47)".

## Out of scope

- Telling the agent about it in the instructions: that would change the cached prefix and its pin.
- Claude's server-side context editing (`clear_tool_uses`): Claude only, by token threshold, and it keeps the old
  thinking blocks.
- Changing model between questions, which the text history now allows but which would lose the cache.
- Putting the activity lines (the queries run) in the text history: that would change reopened chats too.
- Retuning the 600k long-chat notice. Live check A2 can inform it.

## Handoff

- **2026-11-07 (Phase 29 agent).** Built on top of the uncommitted Phase 28 work (D44–D46) on
  `phase-27-background-rescan`, at the maintainer's choice, and not committed. The two phases share files
  (`domain/chat.ts`, `chat.e2e.ts`, DECISIONS, PROJECTS, AGENTIC_SEARCH, llm-providers, ROADMAP, TESTING,
  CHANGELOG), so commit them together or split them by hand.
- No code under `providers/` or `features/agent/` changed. `agentLoop.ts` still lets a follow-up join a run that
  ended on tool results, but the chat no longer sends one.
- **Live checks.** A2 should now measure three heavy questions in a row, one asked after the 5-minute cache expired:
  per request, `cache_read_input_tokens` against `cache_creation_input_tokens`. H1 and H2 now cover every live
  follow-up, so run them before Phase 18's release.
- **Possible follow-up.** Because every question starts from text, the "the model change applies to your next chat"
  rule could apply from the next question instead. It is left for a decision: the cache starts again on a change.
