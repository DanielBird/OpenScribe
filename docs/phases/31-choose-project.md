# Phase 31 — Choose the project in Add to project

**Goal:** a colleague with a project connected can still send a transcript to a different one. Until now the Add to
project dialog only named the open project, and DeScribe remembered a single folder, so it had nothing to offer.

**Status of the plan:** asked for by the maintainer on 2026-11-08 (DECISIONS.md **D49**): a dropdown of recent projects
in the dialog, and the same list under **Change** in Analyse.

**Depends on:** Phase 14 (the project store and folder access) and Phase 15 (the dialog and the pipeline).

**Read first:** [DECISIONS.md](../DECISIONS.md) D13, D18, D25, D49, T14; [PROJECTS.md](../PROJECTS.md) §5.2, §5.3;
[reference/file-system-access.md](../reference/file-system-access.md).

## How it behaves

| Situation | What the user sees |
|---|---|
| One project known | The project's name in the title, as before, plus **Open another project…** and **New project…** |
| Two or more known | The title is **Add to project**, with a **Project** dropdown above **Model**, most recent first |
| Another project chosen | Nothing happens until **Add**, which asks for access if needed, loads it, then starts the pipeline |
| **Cancel** after only using the dropdown | Nothing has changed |
| Access refused, or folder gone | The dialog stays open with a message, and the open project stays. A folder that's gone leaves the list |
| Pipeline or chat running | Dropdown and both buttons disabled, with a one-line hint |
| Transcript linked already, or its job failed | No choice: the dialog is only there for the key |

**Open another project…** and **New project…** act at once, as they do in the dialog's other states. The open
project's own **Reconnect** is unchanged; only a *different* project is connected by **Add**.

## Tasks

1. **`storage/folder.ts`:** `RecentFolder`, `saveRecentFolders`, `loadRecentFolders`, `forgetRecentFolders`, under the
   new key `describe.v1.recentProjects`. Each entry is validated; bad ones are left out.
2. **`stores/project.ts`:** `MAX_RECENT_PROJECTS` (10), `recentProjects` (`{ id, name }[]`; the handles stay in the
   store), `openRecent(id)`. `setProject` keeps the entry for the open folder first under its current name. `forget`
   clears the list.
3. **`AddToProjectDialog.vue`:** the dropdown, the chosen project, opening it from **Add**, the lock while work runs.
4. **`ProjectModelSelect.vue` and `base.css`:** the `base-select` rules move to a shared `.list-select` class.
5. **`ProjectView.vue`:** the recent projects as buttons in the chooser.
6. **Settings → About:** "links to your recent project folders". The same wording in PRIVACY.md and
   reference/llm-providers.md.
7. **Tests and docs:** below; D49, ROADMAP, PROJECTS.md, AGENTS.md rule 7, USER_GUIDE.md, TESTING.md, CHANGELOG.

## Acceptance criteria

- [x] With two or more projects known, the dialog has a labelled **Project** dropdown, most recent first, on the
      project in use.
- [x] With one known, the dialog names it and offers **Open another project…** and **New project…**.
- [x] Choosing another project and clicking **Add** saves the transcript in that project only, and leaves it open in
      Analyse, with **Open summary** working.
- [x] Choosing another project and clicking **Cancel** changes nothing.
- [x] After a browser restart, **Add** asks for access to the chosen project and carries on.
- [x] Refused access or a missing folder keeps the open project and says why. A missing folder leaves the list.
- [x] A running pipeline or chat can't be cancelled by changing project from the dialog.
- [x] **Change** lists the other recent projects, and one click opens one.
- [x] The list survives a reload, holds at most 10, follows renames, and **Clear saved data** clears it.
- [x] An existing user's remembered project joins the list the first time it loads.
- [x] Works by keyboard and passes the axe check.

## Required tests

- `folder.spec.ts`: the round trip, entries of the wrong shape, no IndexedDB.
- `project.spec.ts`: `describe('recent projects')`.
- `AddToProjectDialog.spec.ts`: `describe('choosing the project (D49)')`.
- `ProjectView.spec.ts`: `describe('recent projects under Change (D49)')`.
- `project-add.e2e.ts`: the transcript reaches only the chosen folder, a reload with access ended, **Cancel**, a
  deleted folder, and **Change**. `keyboard.e2e.ts`: choosing by keyboard. `a11y.e2e.ts`: the dropdown and the chooser.

## Out of scope

- Moving or copying a transcript that's already in a project.
- Adding to a project in the background while Analyse stays on another one.
- Recent projects on the Reconnect screen.

## Handoff

### 2026-11-08 — Phase 31 done

**UI text (D13):** with the dropdown showing, the title is **Add to project** rather than naming the project twice.
With one project known there's no dropdown, since one option would do nothing, so the title still names it.

**Why Add connects, and not the dropdown:** `requestPermission` needs a click. A `<select>`'s `change` event isn't
reliably one, so the dropdown only records the choice. `onConfirm` must stay synchronous up to `project.openRecent()`.

**`recentProjects[0]` is the project in use**, once a project has loaded. The dialog relies on that to tell whether the
choice is a different project. Until the first load after this update the list is empty, so an existing user on
`file://` sees today's **Reconnect** first and the list from then on.

**The e2e harness's `revive()` now handles arrays,** because the recent list is one. Its handles are fakes, so the
list was also checked by hand with real `FileSystemDirectoryHandle`s from the origin-private file system on
`localhost`: they save to IndexedDB and come back as handles. Real permission prompts are manual row 22.

**Checks:** typecheck, lint, 1,881 unit tests, build and `verify:single-file` pass. All 155 e2e tests pass with two
workers. With the default workers, 154 pass and `a11y.e2e.ts` "Project: every state, search results and the Brief
dialog" hits its 30 s limit, with no violation reported, as Phase 30's Handoff describes. It passes alone in 12.9 s.
`test.slow()` on that test would settle it, and is outside this phase.

**Open:** manual row 22, in Edge and Chrome.
