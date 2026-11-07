# Phase 27 — Rescan the project every two minutes

**Goal:** a colleague's new session, summary or chat appears without the user having to click away and back. Until
now the project rescanned only when the window got focus, became visible or entered Project mode, so a window that
stays in front (the desktop app, kept maximised) never showed a colleague's work.

**Status of the plan:** asked for by the maintainer on 2026-11-07 (DECISIONS.md **D43**): an automatic rescan every
120 s, no refresh button, and a search that doesn't run again under the reader.

**Depends on:** Phase 14 (the project store's `refresh()`).

**Read first:** [DECISIONS.md](../DECISIONS.md) D13, D30, D43; [PROJECTS.md](../PROJECTS.md) §5.4;
[reference/file-system-access.md](../reference/file-system-access.md) F7 and Rule 7.

## Tasks

1. **`stores/project.ts`:** `RESCAN_INTERVAL_MS = 120_000`. A `setInterval`, beside the focus listeners, calls
   `scheduleRefresh()` while `document.visibilityState` is `visible`. It runs only while the status is `ready`, so
   nothing ticks without an open project. `refresh()` is unchanged: it skips while one runs, reads only new or
   changed files, and keeps `sessions` and `corpus` as they are when nothing changed.
2. **`ui/components/SessionSearch.vue`:** when the corpus changes while results are shown, they stay and **Update
   results** takes **More**'s place (paging the new answers from the old offset would repeat or skip sessions). A
   search with no matches runs again at once. **Update results** searches again from the first page and focuses the
   first result, or the box when nothing matches. Screen readers hear that the sessions changed.
3. **Tests:** unit (`project.spec.ts`, `SessionSearch.spec.ts`) and e2e (`project.e2e.ts`).
4. **Docs:** D43; PROJECTS.md §5.4 and R6; Phase 18's OneDrive checklist; TESTING.md.

## Acceptance criteria

- [x] With the window visible, a colleague's new session appears within two minutes, without focus.
- [x] With the window hidden, the interval reads nothing.
- [x] A rescan that changes the sessions leaves search results, an open quote and loaded pages as they were;
      **Update results** replaces **More** until clicked.
- [x] A search that found nothing finds the colleague's session as soon as it arrives.
- [x] No refresh button; the rescans on focus, visibility and entering Project mode still work.

## Required tests

- `project.spec.ts`: a rescan after `RESCAN_INTERVAL_MS` while visible, none while hidden, and no interval without
  an open project.
- `SessionSearch.spec.ts`: results kept with **Update results** in place of **More** and announced; **Update
  results** searching again and moving focus; a search with no matches running again; a new query dropping the
  button.
- `project.e2e.ts`: a colleague's session after two minutes with `page.clock`, with no focus event; a rescan keeping
  the search results, and **Update results**.

## Out of scope

- `FileSystemObserver` (D43, Consequences): it needs a Phase 10-style check on `file://` and OneDrive first.
- Audit PERF-1 (each rescan stats files one at a time): still Low at one rescan every two minutes.

## Handoff

### 2026-11-07 — Phase 27 done (branch `phase-27-background-rescan`, from `cq-2-duplication`)

**Checks:** typecheck, lint, 1,792 unit tests, 145 e2e specs, build and `verify:single-file` pass. In the first full
e2e run, `a11y.e2e.ts` "Project: every state, search results and the Brief dialog" failed once inside axe's
`analyze()`. It passed alone and in the next full run; the cause wasn't found.

**Beyond the plan:** the interval first ran from the store's creation. `job.spec.ts` checks that no timer is left
(`vi.getTimerCount()`), and it caught one. The interval now runs only while the status is `ready`, which also means
nothing ticks when no project is open.

**`page.clock`:** its first use in the suite, and it works with the fake folder. `install()` comes before the app
opens, because the interval starts when the project does. Time keeps running after `install()`, and
`fastForward('02:00')` fires the interval. With `'01:00'` the test fails, so it does depend on the timer.

**UI text (D13):** one button, **Update results**, which appears only after a rescan has changed the sessions. Screen
readers hear "The sessions have changed. Update results is at the end of the list." No visible text was added.

**Open:** the manual checks. On the desktop: `npm run desktop:dev`, leave the window in front, and copy a session
file into `sessions/`. With two people: TESTING.md row 15's new two-minute step.

**For later:** `FileSystemObserver` (D43). Audit PERF-1 now runs every two minutes rather than only on focus. That
is about 0.1 s for 300 sessions, but measure it before a much larger project.
