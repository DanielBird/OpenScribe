# Phase 32 — Launch splash and hidden start

**Goal:** opening the desktop app looks deliberate. The DeScribe mark appears at once, and the app then appears
already maximised and drawn. Until now the window appeared at 1280 × 860, jumped to maximised and stayed blank while
WebView2 started.

**Status of the plan:** asked for by the maintainer on 2026-11-08 (DECISIONS.md **T20**), who chose the mark alone: no
card and no text.

**Depends on:** Phase 24 (the desktop app).

**Read first:** [DECISIONS.md](../DECISIONS.md) D35, T17, T20; [reference/desktop.md](../reference/desktop.md).

## Tasks

1. **`src-tauri/tauri.conf.json`:** the window gets `"visible": false` and `"backgroundColor": "#ffffff"`, the page's
   `--color-bg`.
2. **`src-tauri/src/splash.rs`:** `Splash::show()` and `Splash::close()`. A borderless layered Win32 window with no
   taskbar button, on its own thread, showing the mark computed from the geometry in `icons/source.svg`. Any failure
   returns `None` and the app starts without a splash.
3. **`src-tauri/src/lib.rs`:** the splash goes up on the first line of `run()`. `on_page_load` shows the main window
   when the page has finished loading (once, so F5 does nothing) and closes the splash. A watchdog does the same after
   15 s, so a failed load can't leave the splash up with no app.
4. **`src-tauri/Cargo.toml`:** the `Win32_*` features of the `windows` crate. tao already enables them on the same
   version, so nothing new is compiled.
5. **Docs:** T20; `reference/desktop.md` (Launch, checklist row W16, verification log); ROADMAP; CHANGELOG.

## Acceptance criteria

- [x] The splash window is up before the main window, centred on the monitor under the pointer.
- [ ] The mark looks right on screen and has no taskbar button (row W16 in `reference/desktop.md`, for the maintainer).
- [x] The main window is never visible at 1280 × 860 during launch: it appears already maximised.
- [x] The splash closes when the main window appears.
- [x] F5 doesn't bring back the splash or change the window.
- [x] If the page never reports that it loaded, the window appears and the splash closes after 15 s.
- [x] No new IPC, commands, plugins or permissions, and no change to `src/` or the HTML file.

## Required tests

- `splash.rs` (`cargo test --manifest-path src-tauri/Cargo.toml`): for `mark_pixels` at sizes from 128 to 384, the
  buffer's length, transparent corners, opaque brand-blue body, white line centres, and no colour above alpha.
- `src/` doesn't change, so the unit and e2e suites only need to keep passing.

## Out of scope

- Limiting the app to one instance.
- Anything in the HTML file: the browser opens it, and our page is up within about 120 ms.
- The manifest's `uap:SplashScreen`: not confirmed to appear for a full-trust desktop app.

## Handoff

### 2026-11-08 — Phase 32 done (branch `phase-32-launch-splash`, from `phase-31-choose-project`)

**Checks:** typecheck, lint, 1,881 unit tests, 5 Rust tests (`cargo test`, the repo's first), build, `verify:single-file`
and `notices -- --check` pass. E2E: 155 of 155 serially (`--workers=1`). In two parallel runs, `a11y.e2e.ts` "Project:
every state, search results and the Brief dialog" timed out at 30 s inside axe's `analyze()`, as once in Phase 27, with
the PC at 55 % CPU from another full-screen app. It passes alone in 12 s, and this phase doesn't change `src/`.

**Open, for the maintainer (row W16):** how the mark looks on screen, and that it has no taskbar button. A full-screen,
always-on-top window covered the splash in all the agent's runs, so it hasn't been seen yet. Also a cold start, 150 %
and a second monitor.

**Measured (release exe, an empty profile):** the splash was up within about 60 ms in four of five runs, and the window
appeared at 600–730 ms. WebView2 doesn't paint while its window is hidden, so the first paint comes about 80 ms after
the window appears, during Windows' open animation, on a matching white background. Removing that would mean showing
the window fully transparent first. Not done.

**Monitors:** the splash follows the pointer, and the main window goes where Windows puts it. Launched from a script
with the pointer on the second monitor, they differed. W16 checks a real click.

**Testing the launch, for the next agent:**

- Don't copy the screen: it reads whatever the maintainer has open. `PrintWindow` with `PW_RENDERFULLCONTENT` renders
  only the app's window, and the page's `performance` entries give first paint over CDP.
- GDI screen copies leave out layered windows, which the splash is, unless `CAPTUREBLT` is set.
- Each launch takes the foreground from whatever the maintainer is doing.
- The exe inherits the launching shell's handles, so a pipeline waits until the app exits. `taskkill /T` without `/F`
  didn't close it; `Process.CloseMainWindow()` does.
