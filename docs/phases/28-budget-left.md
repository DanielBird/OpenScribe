# Phase 28 — The agent sees its budget left

**Goal:** the project agent sees what's left of its per-question budgets after every tool call, so it can plan its
last calls instead of being cut off part-way. Until now it learnt about a budget only when one ran out.

**Status of the plan:** asked for by the maintainer on 2026-11-07 (DECISIONS.md **D46**). The cached prefix must
not change.

**Depends on:** Phase 16 (the tools and their budgets), Phase 20 (the loop both providers share), and the summary
budget (D45).

**Read first:** [AGENTIC_SEARCH.md](../AGENTIC_SEARCH.md) "The tools" and "Budgets and limits";
[DECISIONS.md](../DECISIONS.md) A18, D45, D46. Load the `claude-api` skill before changing `tools.ts`.

## Tasks

1. **`features/agent/tools.ts`:** `budgetNote(budget)`, and `counted()` adds it after a blank line to every result
   that runs:
   `Left for this question: 12 of 30 tool calls · reading budget 212k of 250k tokens · summary budget 60k of 75k tokens`.
   With no calls left: `Left for this question: 0 of 30 tool calls. Answer now.` The activity line doesn't change.
2. **Tests:** `tools.spec.ts` (the note on every result, how it counts down, calls made together, the last call, a
   failed call) and `ask.spec.ts` (the note in a real Claude request, a fresh count per question, and a pin of the
   cached prefix).
3. **Docs:** D46; AGENTIC_SEARCH.md; PROJECTS.md §5.5; the A1–A3 rows in reference/llm-providers.md; CHANGELOG.

## Acceptance criteria

- [x] Every tool result that runs ends with what's left of the tool calls, the reading budget and the summary budget.
- [x] The 30th call's result says to answer now; from the 31st, results are only "Tool budget reached. Answer now."
- [x] The results of one reply's calls all show what's left after all of them.
- [x] The tool definitions and the instructions are byte for byte the same: the pin test's hash, recorded before the
      change, still matches.
- [x] The chat's activity list doesn't show the note.

## Required tests

- `tools.spec.ts`: `describe('budget note (D46)')`, and the `call` helper checks the note on every result.
- `ask.spec.ts`: the note in the Claude request's `tool_result`, a fresh count for the second question, and the
  prefix pin.

## Out of scope

- A note on error results: an error's message is also its activity line, so that would mean changing the `AgentTool`
  contract.
- Telling the agent about the 35-reply limit, the backstop behind the 30 calls.
- Claude's task budgets (`output_config.task_budget`): Claude only, a token budget rather than a call count, and a
  change to the request that would drop the messages cache.

## Handoff

### 2026-11-07 — Phase 28 done (not committed yet)

**Where it is:** in the working tree on `phase-27-background-rescan`, on top of the D44/D45 design-review changes,
which are uncommitted too and touch the same files (`tools.ts`, `tools.spec.ts`, the docs). Commit those first, then
this phase on `phase-28-budget-left`, or both together.

**Checks:** typecheck, lint, 1,818 unit tests, build and `verify:single-file` pass. In the first full e2e run,
`a11y.e2e.ts` "Project: every state, search results and the Brief dialog" failed inside axe's `analyze()`, as in
Phase 27. It passed alone, and the next full run passed all 145.

**The prefix pin:** `ask.spec.ts` hashes the request's tools and its first system block. The hash,
`186b00b0a93588`, was recorded before the change and still matches. It includes D44/D45's prompt changes, so if those
change again before they're committed, update the hash with them.

**How the count works:** `counted()` adds the note after the tool's `await`. Every tool counts and spends before its
first `await`, and `agentLoop.ts` starts a reply's calls together, so all the results of one reply show the same
figures. A tool that awaits before spending would break this; `tools.spec.ts` "gives every result of one reply…"
would catch it.

**UI text (D13):** none. The note is for the model only, and the activity lines don't change.

**Open:** live checks A1–A3 (and with Gemini). The risk to watch: a model that sees its budget may spend more of it.
