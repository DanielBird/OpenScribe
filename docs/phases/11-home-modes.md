# Phase 11 — Home page and modes

**Goal:** Describe opens on a **Home** page with two choices, **Transcribe** and **Project**. Transcribe is
today's Setup → Glossary → Output, unchanged. Project is a placeholder until Phase 14. Every mode has a way back to
Home.

**Depends on:** nothing. It can run alongside Phases 10, 12 and 13. If **Edit text** (Phase 9) should reach
colleagues before release 2, release 1.1 from `main` first: from this phase on, `main` shows a Project button that
does nothing useful until Phase 14.

**Read first:** [PROJECTS.md](../PROJECTS.md) §2 (A13), §5.6; [DECISIONS.md](../DECISIONS.md) D1, D13, D20;
`src/stores/nav.ts`, `src/App.vue`, `src/ui/components/StepNav.vue`; `tests/e2e/helpers.ts` (`openApp`).

## Agreed with the maintainer (2026-10-15)

- The app always opens on **Home**. Home offers two modes: **Transcribe** and **Project**.
- The Transcribe flow doesn't change.

## Decided in this file (the maintainer can still change them)

- **No router** (D1). `nav.mode` is one more value in the nav store, like `step`.
- **Leaving a mode keeps its state.** Going Home and back to Transcribe returns to the step you left. A running
  transcription or translation carries on in the background.
- **The way back to Home is a "Home" button at the start of the nav row**, separated by the same `/` as the
  steps: `Home / Setup / Glossary / Output`. In Project mode the row reads `Home / Project`. (Drafted as
  "Describe"; the maintainer renamed it after review, see the Handoff.) This changes
  the look of the top of every page, so **show the maintainer screenshots at 1280 and 375 px before finishing**,
  and record their choice in the Handoff.
- **Home** has a heading (visually hidden, as on the other views) and two large buttons: **Transcribe** and
  **Project**. There is no intro text (D13). While a transcription or translation runs, the **Transcribe** button
  says so on a second line (draft: "Transcribing…" / "Translating…"). From Phase 14 on, **Project** shows the
  remembered project's name on its second line.

## Tasks

1. **`stores/nav.ts`**
   - `type Mode = 'home' | 'transcribe' | 'project'`; `mode = ref<Mode>('home')`.
   - `enter(mode)` sets the mode, and `goHome()` sets it to `'home'`. `step` keeps its value across modes.
   - `goTo(step)` also sets `mode = 'transcribe'`, so the existing calls (Run, **Open** on the Setup banner, Back
     to setup) keep working from any mode.
   - `stores/savedData.ts` uses `goTo('setup')` to leave an Output tab that can no longer be entered. Change it to
     set the step without changing the mode (e.g. a `resetStep()`), so that **Clear saved data** on Home stays on
     Home.
2. **`App.vue`**
   - `mode === 'home'` renders `HomeView`. `'transcribe'` renders `StepNav` and the current step's view, as
     today. `'project'` renders `ProjectView`.
   - The focus rule extends to mode changes: after a mode or step change, focus moves to the new view's `h1`. Not
     on first load.
   - Project mode will need a wider page (Phase 14). Leave `--content-width` as it is for now.
3. **`StepNav.vue`**: the **Home** button before the steps, as above. Its accessible name is "Home".
   The nav keeps its name "Steps", so the existing specs find it.
4. **`ui/views/HomeView.vue`**: the two buttons. Their accessible names are "Transcribe" and "Project", plus the
   second line when there is one. Arrow keys aren't needed; Tab reaches both.
5. **`ui/views/ProjectView.vue`** (placeholder): `Home / Project` and the line "Projects are coming in
   Describe 2." Phase 14 replaces it.
6. **The Setup banner** (**Open** the last transcript) stays on Setup. Home doesn't repeat it (D13).
7. **E2E helpers** (`tests/e2e/helpers.ts`)
   - `openApp(page)` opens the file, clicks **Transcribe** and waits for the Steps nav, as before. Every existing
     spec then runs unchanged.
   - A new `openHome(page)` opens the file and waits for the Home heading.
8. **Docs:** USER_GUIDE "Start" (Home and the two modes; Project arrives in 2.0), and an *Added* entry under
   *Unreleased* in CHANGELOG.

## Contracts introduced

```ts
// stores/nav.ts (additions)
export type Mode = 'home' | 'transcribe' | 'project';
mode: Ref<Mode>;                 // starts at 'home'
enter(mode: Mode): void;
goHome(): void;
// goTo(step) now also sets mode = 'transcribe'
```

## Acceptance criteria

- [x] The app opens on Home, with **Transcribe** and **Project**.
- [x] **Transcribe** opens Setup the first time, and the step you left after that.
- [x] **Home** in the nav row returns to Home from every step and from Project.
- [x] A transcription started before going Home carries on. Home shows it running, and **Transcribe** returns to
      Output.
- [x] After a mode change, focus is on the new view's heading.
- [x] Every existing e2e spec passes through `openApp`, with no other change (apart from `page.reload()` →
      `reloadApp(page)`; see the Handoff).
- [x] The axe spec covers Home and the Project placeholder. The keyboard spec reaches both Home buttons and the
      **Home** button in the nav row.
- [x] The maintainer has seen the nav row at 1280 and 375 px, and their choice is in the Handoff.

## Required tests

- `stores/nav.spec.ts`:
  - The mode starts at `'home'`.
  - `goTo` sets `'transcribe'`.
  - `goHome` keeps `step`.
  - `canEnter` is unchanged.
- `App.spec.ts`:
  - Home renders first.
  - **Transcribe** shows the steps.
  - Focus moves on a mode change, not on first load.
- `HomeView.spec.ts`: the running line appears while a transcription or translation runs.
- `tests/e2e/shell.e2e.ts`: opens on Home; Home → Transcribe → Home (nav row) → Home.
- `tests/e2e/transcribe.e2e.ts`: going Home during a run, then back to Output.
- `a11y.e2e.ts` and `keyboard.e2e.ts`: as above.

## Out of scope

- Anything in the Project placeholder beyond its heading and line.
- Remembering the last mode across reloads (A13: always Home).
- A browser Back button that changes mode (D1: no router).

## Handoff

*(The nav-row design the maintainer chose, UI text trimmed under D13, anything Phase 14 must know about the shell.)*

### 2026-10-19 — Phase 11 done (branch `phase-11-home-modes`, based on `release-2-plan` at `c579441`)

**The top row (the maintainer's choice, from screenshots at 1280 and 375 px)**
- Every page has one top row: a `<header>` (banner landmark) drawn by `StepNav.vue`.
  - **Home:** "Describe" alone, as the page's title (accent colour, `aria-current="page"`, not a button). The draft
    had no visible title on Home. The maintainer chose the row, so the content doesn't move between Home and the
    other pages.
  - **Transcribe:** `Describe / Setup / Glossary / Output`. **Describe** is a button named "Describe, home", styled
    like the steps.
  - **Project:** `Describe / Project`, with Project in the current-step colour.
- **Below 30rem the row uses `--font-size-md`** (was `lg`). At 375 px the row needs 388 px at `lg`, against
  343 px, so the steps wrapped under "Describe /" (58 px tall). At `md` it fits on one line, 28 px tall. Tighter
  separators alone (4 px) still wrapped.
- The row is the same height on every page: 38 px at 1280, 28 px at 375.

**Changed from this file**
- **The Describe button is outside `<nav aria-label="Steps">`,** inside the header. The Steps nav keeps exactly its
  three buttons, so the existing specs find what they did. Project mode has no "Steps" nav.
- **"Every existing spec, with no other change" couldn't hold:** 16 `page.reload()` calls in 11 specs would land on
  Home. A `reloadApp(page)` helper (reload, then **Transcribe**) replaces them, and nothing else in those specs
  changed. AGENTS.md now says to use it. `keyboard.e2e.ts`'s `tabTo` takes `{ maxStops, backwards }`.
- **USER_GUIDE has no "Start" section.** The Home paragraph opens §3 instead, so section numbers and anchors stay.
- **Home's buttons** put the name at the top, so the names line up whether or not Transcribe has its second line.
- **`nav.enter('transcribe')`** falls back to Setup if the step left can't be entered. It's defensive: nothing
  causes it today, because Clear saved data already resets the step (`resetStep()`).

**UI text (D13):** kept as drafted: "Transcribing…" / "Translating…" and "Projects are coming in Describe 2.". Home's
hidden h1 is "Home". No intro text.

**Perf:** `test:perf` passes. Its "startup to banner" now includes the click on **Transcribe** (189 ms at 1×). Rename
at 1× was mean 55 / max 84 ms with a dev server and a browser running, like the Phase 9 "slower day" numbers on
`main`. This phase doesn't touch the turn list.

**For Phase 14**
- `StepNav.vue` is now the top row in every mode. Rename it `AppHeader` when the project name, **Brief** and
  **Change** join the Project row (PROJECTS §5.6).
- `--content-width` is unchanged. Project mode's wider page is still to do.
- Home's **Project** button is ready for a second line (`.mode-status`): the remembered project's name.
- `nav.goTo(step)` switches to Transcribe from any mode, so **Open transcript** can call it after loading the doc.
- When a run finishes while Home is shown, the second line disappears without an announcement. The phase didn't ask
  for one. Consider an `aria-live` note if Project mode adds background work too.

### 2026-10-19 — After review: the Home label, a grey title and the Tiles design (maintainer's choices)

These replace the matching points in the entry above.

- **"Home", not "Describe", in the nav row.** The rows now read `Home` (on Home), `Home / Setup / Glossary / Output`
  and `Home / Project`. The button's visible text is its name, so the `aria-label` "Describe, home" is gone. The
  specs find it with `getByRole('button', { name: 'Home', exact: true })`. The app's name still shows in the tab
  title, the footer's About dialog and the Word file's properties.
- **On Home the title is grey** (`--color-text-muted`, like a step that isn't current), so the tiles carry the
  accent. It keeps `aria-current="page"`. Elsewhere **Home** is grey and turns blue on hover, and the current step
  or **Project** is blue, as before.
- **Home's buttons are tiles** (chosen from three variants generated with Impeccable: Index, Halves, Tiles):
  - No outline. A faint accent tint at rest (`color-mix(in srgb, var(--color-accent) 4%, var(--color-surface))`);
    on hover the accent fills the tile and the text turns white (6.7:1); pressed uses `--color-accent-hover`.
  - The name is large: `clamp(2.25rem, 1rem + 4vw, 3.5rem)`, 56 px at 1280 and 36 px at 375 px, where
    "Transcribe" fills the tile exactly. An up-right arrow (inline SVG, `aria-hidden`) sits on the name's line.
  - The second line (`.mode-status`) is at the bottom of the tile, after a pulsing dot (still under
    `prefers-reduced-motion`). Muted text on the tint is 5.4:1.
  - Tiles are 12rem tall (8rem below 30rem), with a `--space-3` gap, stacking below 30rem.
- Unit, axe and keyboard specs pass with the new names; the accessible name with a second line is still
  "Transcribe Transcribing…".

**For Phase 14:** PROJECTS §5.6 and Phase 14's `ProjectHeader` now say `Home / <project name>`. The Project tile's second line (the project's name) gets the same bottom placement as
Transcribe's, without the pulsing dot unless something is running.
