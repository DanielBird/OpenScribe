@AGENTS.md

## Claude Code specifics

- Work one phase at a time. Start in plan mode: read `docs/ROADMAP.md` and the phase file, propose the
  implementation, then build it.
- Before writing or changing `src/providers/llm/claude.ts` or `src/providers/llm/claudeAgent.ts`, or the prompts in
  `src/features/summary/` and `src/features/agent/`, load the `claude-api` skill and follow it. It is the
  authority on model IDs, structured outputs, refusal handling and browser usage.
- Do not run the app against real APIs with the user's keys unless the user asks you to in that session.
- When a phase is finished, update the status table in `docs/ROADMAP.md` and append a short entry to the phase
  file's *Handoff* section with anything the next agent needs to know.
