# Phase 30 — Chat settings: effort, tool calls and reading

**Goal:** a colleague sets how hard the project agent thinks and how much one question may use: quick and cheap, or
thorough. Until now the effort and the per-question budgets were fixed in code.

**Status of the plan:** asked for by the maintainer on 2026-11-08 (DECISIONS.md **D48**). The cached prefix must not
change.

**Depends on:** Phase 16 (the tools and their budgets), Phase 20 (the loop both providers share), the summary budget
(D45), Phase 28 (the budget note) and Phase 29 (follow-ups from text).

**Read first:** [AGENTIC_SEARCH.md](../AGENTIC_SEARCH.md) "Budgets and limits"; [DECISIONS.md](../DECISIONS.md) A18,
T9, T15, D45, D46, D47, D48. Load the `claude-api` skill before changing `claudeAgent.ts`.

## The settings

| Control | Low | Medium (default, as before) | High |
|---|---|---|---|
| Effort | `low` / `LOW` | `medium` / `MEDIUM` | `high` / `HIGH` |
| Tool calls per question | 15 | 30 | 60 |
| Reading per question, shown as hours of transcript | 10 h: 125k transcript + 37.5k summaries | 20 h: 250k + 75k | 40 h: 500k + 150k |

The user sets reading as one amount; summaries are always 3 parts in 13 of it (75k beside 250k, D45). The replies
backstop is the tool calls plus 5. Translation and summaries keep `CLAUDE_EFFORT` / `GEMINI_THINKING`.

## Tasks

1. **`features/agent/limits.ts`:** `BudgetLevel`, `BUDGET_LEVELS`, `TOOL_CALL_LEVELS`, `READING_LEVELS`,
   `AgentBudgetLimits`, `agentBudgetLimits(tools, reading)`, `DEFAULT_AGENT_LIMITS`, `readingHours(level)`. The
   per-question caps leave `AGENT_LIMITS`.
2. **`features/agent/tools.ts`:** `AgentBudget` carries its `limits`; every budget check and the note read them. The
   tool descriptions and instructions don't change.
3. **Providers:** `AgentRunRequest.effort` (`AgentEffort`); `claudeAgent.ts` sends it as `output_config.effort`,
   `geminiAgent.ts` as `thinkingLevel` through `GEMINI_THINKING_FOR`.
4. **`ask.ts`, `compact.ts`:** `effort` and `limits` come in as options.
5. **`stores/settings.ts`:** `agentEffort`, `agentToolBudget`, `agentReadingBudget` in the prefs (default `medium`, a
   bad value falls back on its own), reset by `resetPrefs`; `agentLimits` is computed from the two levels.
6. **`stores/chat.ts`:** a question takes the settings when it starts, compaction takes the effort, and the long-chat
   notice measures a question's first request.
7. **`ProjectModelSelect.vue`, `ProjectHeader.vue`:** prop `chatSettings` adds a button and a `popover` with three
   groups of radios. `id` and `class` from the parent go on the select.
8. **Tests and docs:** below; D48, AGENTIC_SEARCH.md, PROJECTS.md, reference/llm-providers.md, ROADMAP, CHANGELOG.

## Acceptance criteria

- [x] The Analyse header has a Chat settings button next to the model. It opens a panel with Effort, Tool calls and
      Reading, three levels each, at Medium until changed.
- [x] The Add to project dialog shows only the model.
- [x] The choices are saved on this computer and reset with the other preferences. A bad saved value falls back to
      Medium on its own.
- [x] A change applies from the next question, never to one already running.
- [x] Effort reaches Claude as `output_config.effort` and Gemini as `thinkingLevel`, for the chat and `/compact` only.
- [x] Tool calls, reading and summaries stop at the chosen amounts, and the budget note shows them.
- [x] At Medium the budgets are what they were: 30 / 250k / 75k / 35.
- [x] Reading always splits 10 : 3 between transcripts and summaries.
- [x] The tool definitions and the instructions are byte for byte the same: the pin test's hash still matches.
- [x] The panel works by keyboard (Enter opens, Tab reaches it, arrows choose, Esc closes and returns focus) and passes
      the axe check.

## Required tests

- `limits.spec.ts`: Medium as before, the 10 : 3 split at every level, the hours.
- `tools.spec.ts`: `describe('chosen budgets (D48)')`.
- `ask.spec.ts`: effort, backstop and note from the options; the prefix pin.
- `claudeAgent.spec.ts`, `geminiAgent.spec.ts`: each effort; `compact.spec.ts`: the effort.
- `settings.spec.ts`: defaults, saved, fallback, reset, `agentLimits`.
- `chat.spec.ts`: settings as at the start of the question; a question's own reading isn't a long chat.
- `ProjectHeader.spec.ts`, `AddToProjectDialog.spec.ts`: the panel, and where it isn't.
- `chat.e2e.ts`: by keyboard to the request and back after a reload; `a11y.e2e.ts`: the open panel.

## Out of scope

- Claude's `xhigh` and `max`: Gemini has nothing above `high`, and one setting serves every model.
- Effort for translation and summaries.
- Saving the settings used with each answer in the chat file: a schema change.
- Claude's per-message effort (beta), which would keep the cache when the effort changes between questions.

## Handoff

### 2026-11-08 — Phase 30 done (not committed yet)

**Where it is:** in the working tree on `phase-30-chat-settings`.

**UI text (D13):** the panel says "Per question. Higher costs more." once, under the three groups. The reading options
read "10 h", with "of transcript" visually hidden. Each group's label has a one-line explanation (maintainer's
request): it shows on hovering the label or on keyboard focus in the group, and is the group's `aria-describedby`, so
it adds no tab stop.

**The select is no longer the component's root.** `ProjectModelSelect` has `inheritAttrs: false` and binds `$attrs` to
the select, so a parent's scoped rule can't reach it: `ProjectHeader.vue` uses `:deep(.model)`.

**The long-chat notice changed meaning.** It now measures the first request of the latest question (the context and
the text history), because a High reading level would otherwise set it off after every thorough question. The 600k
threshold is unchanged, and the notice will be rarer than before. Live check A2 can retune it.

**Checks:** typecheck, lint, 1,845 unit tests, build and `verify:single-file` pass. In the last full e2e run, 148 of
149 passed. The other, `a11y.e2e.ts` "Project: every state, search results and the Brief dialog", is close to its 30 s
limit when the suite runs in parallel: 26.3 s on `main` and 29.6 s here on a quiet machine, and 35.6 s in the last run.
It timed out in five of the six full runs here, with no violation reported, and passes alone in 10.6 s; Phases 27 and
28 saw the same test fail. The panel's scans have their own small test so as not to add to it. `test.slow()` on that
test would settle it, and is outside this phase.

**Open:**
- Live check A3 (effort `medium` against `high`) now also covers Low, and the three reading and tool levels: answer
  quality, calls and cost.
- High with High can come near the 1M context: 650k of reading, about 60k of cards, search results and thinking.
  Claude then ends with "Stopped at a limit"; Gemini may return an error instead. If it happens in the live check,
  lower High reading to 30 h in `READING_LEVELS`.
