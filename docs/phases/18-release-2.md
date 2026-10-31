# Phase 18 — Hardening and the 2.0 release

**Goal:** Release 2 is solid at full scale and on real OneDrive projects, its live checks are done, the docs
describe it, and `Describe-v2.0.0.html` is released.

**Depends on:** Phases 10–17, 19 and 20 (both in 2.0: D26, maintainer 2026-10-21).

**Read first:**
- [PROJECTS.md](../PROJECTS.md) (all of it), [DECISIONS.md](../DECISIONS.md) D20–D23 and T11–T13;
- [RELEASING.md](../RELEASING.md), [TESTING.md](../TESTING.md);
- [Phase 8](08-hardening-release.md), the 1.0 version of this phase: follow its pattern;
- every release-2 Handoff.

## Tasks

1. **Performance at 300 hours** (`test:perf`, with the generated project). Record the results in TESTING.md, at 1×
   and at 4× CPU:
   - **Project load:** first load and from the cache.
   - **Search:** a query, which must stay under 200 ms.
   - **Sessions:** rendering the list; opening a summary.
   - **Chat:** rendering a long streamed answer (about 3,000 words, 15 quotes) without dropping frames. The
     target is the p95 frame time under 50 ms at 1×.

   If a target is missed, fix it, or ask the maintainer before changing a design.
2. **Robustness** (extend `robustness.e2e.ts`):
   - permission to the folder revoked mid-session;
   - a transcript deleted while it's open;
   - a file offline (simulated with the harness's failure mode);
   - IndexedDB blocked (the project still loads, without the cache);
   - Claude offline during Add to project and during a chat;
   - a 10-hour session summarised (a large fixture through the pipeline, with Claude mocked);
   - a project with a corrupt summary, and with a conflict copy.
3. **Accessibility and keyboard:** axe on every new state. A keyboard-only pass from Home through a project:
   reconnect, search, select a session, copy a quote, ask, stop, and go back to Home. Check visible focus
   everywhere. Fix what fails.
4. **D13 review** of all release-2 UI, with the maintainer:
   - Remove repeated wording. Keep detail behind `<details>`, and show messages only when they apply.
   - Record what changed in this file's Handoff.
5. **Live checks**, run with the maintainer's keys and only when the maintainer asks during this phase. Record the
   results in `reference/llm-providers.md`.
   - **S1–S3 (summaries):** quality on a real German session and a real English one, with both models; tokens and
     cost per hour; the dropped-quote rate.
   - **A1–A4 (agent):**
     - quote recall on 10 questions with known answers (the maintainer prepares them), with both models;
     - cost per question, and the cache read share;
     - effort `medium` against `high`;
     - CORS with the agent's headers.
   - **L3 (translation),** if it's still open.
   - **G1–G3 (Gemini summaries, Phase 19),** if they're still open.
   - Tune what the results call for: the prompts, `AGENT_LIMITS`, and the effort. Record any change of default in
     DECISIONS.md.
6. **The manual OneDrive checklist** (TESTING.md), with two people on two computers, in Edge and Chrome:
   - both open one project;
   - A adds a session; B sees it after focusing the window;
   - B regenerates its summary; A sees the new summary;
   - both edit the same transcript, and the change check catches it;
   - files kept online only, then offline.
7. **Docs:**
   - AGENTS.md ("What we are building", the commands, the rules touched by release 2);
   - ROADMAP.md (§1 and §2 for release 2, and the status table);
   - PROJECTS.md (as built);
   - PRODUCT.md (capabilities, terminology: *Project*, *Brief*, *Add to project*, *Summarise*, *Regenerate*,
     *New chat*);
   - USER_GUIDE.md (privacy and data flow, troubleshooting: permission, offline files, conflicts);
   - the About panel;
   - future.md (move PROJECTS.md §10's items there).
8. **Release:**
   - Set the version to 2.0.0 and complete the CHANGELOG.
   - Run `npm run release` (RELEASING.md), including the saved-data check: 1.x data opens in 2.0, and 2.0 doesn't
     break 1.x (D18).
   - The release adds no network hosts: confirm that `verify:single-file` still allows only the three.

## Acceptance criteria

- [ ] Every perf target is met at 300 hours, and the numbers are in TESTING.md.
- [ ] The robustness, axe and keyboard specs pass, with the cases above.
- [ ] The D13 review is done, with the maintainer, and recorded.
- [ ] The live checks the maintainer chose to run are recorded, and any that weren't run are marked pending, with
      the reason.
- [ ] The manual OneDrive checklist has been run in Edge and Chrome, and its results are in TESTING.md.
- [ ] Every doc above is updated. `release/Describe-v2.0.0.html` and its `.sha256` exist.
- [ ] Definition of Done in AGENTS.md.

## Out of scope

- New features: PROJECTS.md §10 moves to future.md for later releases.

## Handoff

*(Perf numbers, live-check results and the tuning they led to, D13 changes, known limitations for the CHANGELOG.)*
