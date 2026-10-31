# Phase 24 — Desktop shell and the Store pipeline

**Goal:** Describe runs as a Windows desktop app, built with Tauri 2 from the same source and packaged as MSIX. It
installs on a Demant work laptop from a Microsoft Store listing that only a direct link reaches. The single-file HTML
build doesn't change. What works in the desktop window, and what doesn't, is recorded for Phase 25.

**Status of the plan:** asked for by the maintainer on 2026-10-31 (DECISIONS.md **D35**). The work-laptop checks in
D35 were done before this file was written.

**Depends on:** nothing in the app. Start from `main_tauriBuild`, on a branch `phase-24-desktop-shell`. Phase 23
(read-only project folders, on `phase-23-read-only-folder`) can merge before or after: this phase doesn't touch
`src/storage/`.

**Read first:**
- [DECISIONS.md](../DECISIONS.md) D1, D3, D12, D13, T1 and D35 (and D34 once Phase 23 is merged);
- [reference/file-system-access.md](../reference/file-system-access.md), for W10;
- Tauri 2's [Microsoft Store](https://v2.tauri.app/distribute/microsoft-store/) page and its Windows prerequisites;
- Microsoft Learn, [Using winapp CLI with Tauri](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri).

Follow the official docs for every Tauri and `winapp` option, and don't guess them (AGENTS.md, *External APIs*).

## Already known (2026-10-31)

- **The work laptop:** Store installs from publishers other than Microsoft work (Python's MSIX). It is x64 (AMD Ryzen
  5 PRO 215). Controlled folder access is off. WebView2 runtime 156.0.4314.50 is installed for the whole machine. The
  HTML build transcribes there.
- **CORS:** a preflight with `Origin: http://tauri.localhost` (Tauri 2's origin on Windows) passes for all three APIs.
  ElevenLabs and Anthropic answer `*`; Gemini echoes the origin. So the API calls stay in the web view, which uses the
  same proxy settings and certificates as Edge.
- **Packaging:** Tauri 2 builds only MSI and NSIS installers. Its Store route for those needs a paid code-signing
  certificate, an installer we host, an updater in the app and the offline WebView2 installer. Microsoft's `winapp`
  CLI packs the release exe as MSIX instead, and the Store signs, hosts and updates MSIX itself (D35).

## Who does what

1. **The agent** builds the desktop build, the MSIX packing, the checks and the rename (Tasks 1–7), runs the app on
   the maintainer's PC, and fills in the checklist rows it can check there.
2. **The maintainer** decides the points below, sets up the listing and submits (Task 8), and runs the checklist on the
   work laptop with the app installed from the Store.
3. **The agent** writes up the results and the input for Phase 25 (Task 9).

## To decide before starting (the maintainer)

1. **Publisher account:** a personal or a company Partner Center account. The publisher name shows on the Store page
   and in Windows, and moving the app to another account later means a transfer. Check whether publishing outside
   Demant's own channels needs anyone's agreement.
2. **Store name. Decided 2026-10-31:** **DeScribe**, reserved in Partner Center for an **MSIX or PWA app**
   product. The app is renamed to match (Task 7).
3. **App identifier. Decided 2026-10-31:** `io.github.danielbird.describe`, the maintainer's GitHub account
   (`github.com/DanielBird`) in reverse-domain form. Slashes aren't allowed in it. It names the folder the app's data
   lives in, so it never changes.
4. **Icon:** one square source image (SVG, or a PNG of 1024 px) for the Start menu, taskbar and Store. The maintainer
   provides or approves it.
5. **Privacy policy URL:** the Store asks for one when an app sends personal data, and Describe sends recordings to
   ElevenLabs. It must be a public page. The data-flow text in Settings' About section is a starting point.

## Decided in this file (the maintainer can still change them)

1. **Two builds from one source.** `npm run build` stays the single file. `vite build --mode desktop` writes a normal
   multi-file build to `dist-desktop/`, which Tauri embeds in the exe. A build-time define, `__DESKTOP__`, is the only
   switch. It is false except in that mode, and this phase uses it only for the About text.
2. **CSP:** the desktop CSP lives in `tauri.conf.json`. It has the same three API hosts, and `script-src 'self'`,
   since nothing is inlined. Tauri adds its own sources to the CSP when it builds, so record the CSP the web view
   actually reports. Keep one list of hosts: a check fails when `vite.config.ts`, `scripts/verify-single-file.mjs` and
   `tauri.conf.json` disagree.
3. **MSIX from the release exe** with `winapp pack`, x64 only. The manifest and its assets live in `src-tauri/msix/`.
   Tauri's own bundler is off. The MSIX version is `package.json`'s version with 0 as the fourth number, because the
   Store reserves that number (verify this).
4. **No new runtime dependencies, and no Tauri code in `src/`.** Anything the web view can't do is recorded for
   Phase 25. The exception is what Store certification would notice: if links or the `.docx` export don't work, make
   the smallest fix on the Rust side (for example, opening external links in the default browser), not in `src/`.
5. **Drag and drop:** on Windows, Tauri's own file-drop handling stops the page's drag and drop, which `FileDrop`
   needs. Turn Tauri's off (the window's `dragDropEnabled`; verify the name).
6. **Release builds** have no DevTools and no console window. Debug builds keep DevTools for the checklist.

## Tasks

1. **Prerequisites.** The maintainer installed these on their PC on 2026-10-31. Copy the table into the reference
   doc:

   | Tool | Version | Check |
   |---|---|---|
   | Rust | rustup 1.29.2; rustc and cargo 1.99.1; default toolchain `stable-x86_64-pc-windows-msvc` | `rustup show active-toolchain` |
   | MSVC C++ build tools | Visual Studio Community 2022 17.14 (Build Tools 2019 is also installed) | `vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` |
   | Windows SDK | 10.0.22621.0 | `Windows Kits\10\Include` |
   | `winapp` CLI | 0.7.1 (`winget install microsoft.winappcli`) | `winapp --version` |
   | WebView2 runtime | 156.0.4314.56 | Settings > Apps |

   - Still to do, in the repo: add `@tauri-apps/cli` as a dev dependency.
   - The `winapp` CLI sends anonymous usage data unless `WINAPP_CLI_TELEMETRY_OPTOUT` is `1`. Set it for every
     `winapp` command, including the ones run by hand.
2. **`src-tauri/`:** create it with Tauri's manual setup (`npx tauri init`), not `create-tauri-app`, which scaffolds a
   new frontend. Answer the prompts as follows:
   - app name: `describe` (it also names the Rust package);
   - window title: `DeScribe`;
   - web assets: `../dist-desktop`;
   - dev server: `http://localhost:5173`;
   - dev command: `npm run dev -- --mode desktop`;
   - build command: `npm run build:desktop`.

   Then set `productName` to `DeScribe`, `version` to `../package.json` and `identifier` to
   `io.github.danielbird.describe`. Trim it to a minimal app with one window (a sensible minimum size), no commands,
   the smallest capability set and the CSP. Tauri's bundler is off.
3. **Vite desktop mode:** `vite.config.ts` becomes a function of `mode`. In `desktop` mode it drops `viteSingleFile`
   and the CSP meta, sets `outDir: 'dist-desktop'` and defines `__DESKTOP__: true`. `env.d.ts` declares
   `__DESKTOP__`. The web build is unchanged.
   - From Tauri's Vite guide, for every mode: `clearScreen: false`, `server.port: 5173` with `strictPort: true`, and
     `server.watch.ignored: ['**/src-tauri/**']`.
   - Not needed: its mobile `host` and `hmr` settings, `envPrefix` (`__DESKTOP__` is the only switch) and
     `build.target: 'chrome105'` (`es2022` stays).
4. **Scripts:**
   - `build:desktop` runs `vue-tsc -b && vite build --mode desktop`, and is Tauri's `beforeBuildCommand`.
     `npm run build -- --mode desktop` won't do, because npm adds the flag to the script's last command,
     `postbuild.mjs`, not to `vite build`;
   - `desktop:dev` runs `tauri dev` on the Vite dev server in desktop mode;
   - `desktop:build` runs `tauri build --no-bundle`;
   - `desktop:pack` runs `scripts/pack-desktop.mjs`: build, stage the exe, write the version into the manifest, then
     `winapp pack` with `WINAPP_CLI_TELEMETRY_OPTOUT=1`.

   Add `src-tauri/target/`, `dist-desktop/`, the staging folder, `*.msix` and `*.pfx` to `.gitignore`. A
   certificate is never committed.
5. **Checks:** `verify-single-file.mjs` also fails if the web build contains Tauri code (`__TAURI__`,
   `ipc.localhost`). Add the hosts check from decision 2.
6. **About text,** under `__DESKTOP__`: the opening line says Describe runs on this computer, and "In this browser"
   becomes "On this computer". This is a draft: trim it to fit (D13).
7. **Rename to DeScribe** wherever users see the name, in both builds:
   - UI text and messages (e.g. "DeScribe couldn't save this file."), the page `<title>`, the header and the About
     text;
   - the `.docx` properties (`creator`, and "Generated by DeScribe");
   - the release file, `DeScribe-v<version>.html` (`scripts/release.mjs`, RELEASING.md);
   - README, the User Guide, an *Unreleased* entry in the changelog, and the docs where they mean the product.

   **Not renamed:**
   - storage keys and database names (`describe.v1.*`, `describe-v1`, `describe-v1-corpus`): renaming them would
     lose everyone's saved data (D18);
   - names in project folders (`describe-project.json`), which colleagues' folders already hold;
   - `package.json`'s `name`, and file and folder names in the repo;
   - "Describe" as a verb: the agent's instructions say "Describe what it says instead".

   So don't find-and-replace. Load the `claude-api` skill before touching the prompts in `src/features/agent/` and
   `src/features/summary/` (CLAUDE.md). Tests that check the name change with it.
8. **The Store** (the maintainer, with the agent's help):
   - the Partner Center product (**DeScribe**, an MSIX or PWA app); copy its package identity from **Product
     management → Product identity** into the manifest;
   - upload the MSIX;
   - visibility: available, but not discoverable, so only the direct link reaches it. Record Partner Center's exact
     wording;
   - free; properties (category, privacy policy URL, age rating); one screenshot;
   - if Partner Center asks why the app needs `runFullTrust` (packaged desktop apps declare it): it's a desktop app;
   - certification notes saying the app needs the user's own API keys. If certification asks for a working key,
     the maintainer decides whether to give the testers a capped ElevenLabs key.
9. **`docs/reference/desktop.md`,** in the style of the other reference docs: prerequisites, build and pack, the Store
   steps as done, the checklist with its results, and **Input for Phase 25**: what to replace (folders, export, keys)
   and what already works in the web view and can stay.
10. **Docs:**
    - AGENTS.md: Stack, Commands, and hard rules 1 and 2, for two builds;
    - ROADMAP: §1, §4, the §5 folder layout, §9 and the table;
    - DECISIONS D35, if anything learned changes it;
    - TESTING.md, if the checklist should be run again for each desktop release.

## The checklist

Run it on the maintainer's PC (a local MSIX, signed with a development certificate) and on the work laptop (installed
from the direct link). Never sideload a development build on the work laptop.

| ID  | Check | Maintainer's PC |
|-----|---|---|
| W1  | Install: a Start menu entry with the name and icon. The size of the MSIX and of the installed app. | Confirmed (icon looks correct and the app can be found in installed apps) |
| W2  | The app opens on Home with no console window. The window resizes down to its minimum without breaking the layout, and text is sharp at 125 % and 150 % scaling. | Confirmed (however the app does not open in full screen - we should fix this) |
| W3  | With **Remember keys** ticked, keys survive closing and reopening the app. Unticked, they're gone after a restart. | Confirmed |
| W4  | Choose a recording with the button and by drag and drop. Upload progress moves, and the transcript appears. | Confirmed |
| W5  | **Translate to English** with Claude and with Gemini. |
| W6  | Click a turn: playback starts there, for an MP3, an M4A and an MP4. | Confiremd |
| W7  | **Download .docx:** what happens, and where the file goes. | The file downloads to my download folder. There is no visual notification of success in the app (we should add this). It should be renamed to "Save as docx" in the app version. |
| W8  | The links in Settings open in the default browser, not in the app window. | Fail - the links do not work, nothing opens. |
| W9  | The Copy buttons put text on the clipboard. | Confirmed |
| W10 | **Open project** with the existing folder code: does the picker open, can **Add to project** save, and after a restart is access still there or is **Reconnect** needed? On the work laptop: does Edge's folder-write block (D34) apply inside the app? | After closing the app, reconnect is needed. The user is prompted to provide permission to view and edit files twice. Adding to project appears to save - the file is still there after a restart. | 
| W11 | The last transcript and the glossary survive a restart, and **Clear saved data** clears them. | Confirmed |
| W12 | Mouse Back and Forward, Alt+Left and Alt+Right (D28), F5, Ctrl+R, Ctrl+F, Ctrl+P, Ctrl+plus and Ctrl+minus: note which ones do something. | All of them worked except for ctrl+plus and ctrl-minus - this is acceptable and does not require any fix. |
| W13 | In a debug build: the CSP the web view reports, and the Network panel shows only the three API hosts (plus Tauri's own `ipc` traffic). |
| W14 | **Update:** submit a second version. The installed app updates and keeps keys, glossary and the last transcript. |
| W15 | **Uninstall:** saved data goes too. Record where it lived. |

## Contracts introduced

```ts
// env.d.ts
declare const __DESKTOP__: boolean; // true only in Vite's `desktop` mode (desktop:dev, desktop:build)
```

- npm scripts: `build:desktop`, `desktop:dev`, `desktop:build`, `desktop:pack`.
- Files: `src-tauri/` (with `msix/`), `scripts/pack-desktop.mjs`, `docs/reference/desktop.md`.

## Acceptance criteria

- [ ] `npm run desktop:dev` opens Describe in a window, with hot reload.
- [ ] `npm run desktop:pack` makes an x64 MSIX from a clean checkout, once the prerequisites are installed.
- [ ] The web build's output and behaviour are unchanged: `verify:single-file` passes and finds no Tauri code, and all
      existing tests pass unchanged.
- [ ] The hosts check fails when one of the three lists differs.
- [ ] Users see DeScribe everywhere in both builds, and data saved before the rename still loads.
- [ ] The direct-link listing has passed certification, and the app installs from it on the work laptop.
- [ ] W1–W15 have a result for both machines, or *not run* with a reason.
- [ ] `docs/reference/desktop.md` has the facts and the input for Phase 25. AGENTS.md, ROADMAP and DECISIONS are
      updated.
- [ ] The Definition of Done in AGENTS.md, with the e2e suite run on the web build as before.

## Required tests

- The hosts check, and the Tauri-code check in `verify-single-file.mjs`. Show each one failing once on purpose.
- The existing unit and e2e suites, unchanged. This phase has no automated desktop tests.
- The checklist above.

## Out of scope (Phase 25 and later, drafted once this phase's facts are in)

- Native folder access through Tauri (its `fs` and `dialog` plugins, with access that survives a restart), unless W10
  shows that the web view's own folder access is enough.
- A **Save** dialog for exports, beyond the Rust-side fix in decision 4.
- API keys in Windows Credential Manager. `secrets.ts` is synchronous today, and Credential Manager can only be
  reached asynchronously.
- Automated desktop tests (WebDriver through `tauri-driver`).
- Making the listing public, the desktop release steps in RELEASING.md, and the User Guide.
- ARM64, macOS and Linux; allowing only one instance; moving saved data over from the HTML version. The app has its
  own origin, so it starts with no saved data.

## Handoff

*(Versions, the CSP as shipped, the Store steps and their wording, W1–W15, and what Phase 25 should replace or keep.)*

### 2026-10-31 — Progress: the desktop build runs (on `main_tauriBuild`)

**Branch:** the maintainer works on `main_tauriBuild` itself, not on a `phase-24-desktop-shell` branch.

**Done:**
- **Task 1:** `@tauri-apps/cli` 2.12.4 is a dev dependency. `npx tauri info` passes, with the prerequisites in Task 1's
  table.
- **Task 2:** `src-tauri/` was made with `npx tauri init`, then set up:
  - **Versions:** `tauri` 2.12.5 and `tauri-build` 2.7.4.
  - **Names:** `init` names the Rust package `app` whatever the answers. It's renamed to `describe` (library
    `describe_lib`), so the exe is `describe.exe`.
  - **`tauri.conf.json`:** `productName` and the window title `DeScribe`; `version` from `../package.json`; the
    identifier; a 1280×860 window with an 800×600 minimum; `dragDropEnabled: false`; the CSP; `bundle.active: false`;
    no Android section.
- **Task 3:** `vite.config.ts` is a function of `mode`, with Tauri's dev-server settings in every mode. `env.d.ts`
  declares `__DESKTOP__`. The desktop build is `dist-desktop/`: `index.html`, one JS file (1.4 MB), one CSS file
  (126 KB) and two small chunks that Vite splits off.
- **Task 4, in part:** `build:desktop`, `desktop:dev` and `desktop:build` exist. `.gitignore` has the desktop build,
  `src-tauri/target/` and `src-tauri/gen/`, `*.msix` and `*.pfx`. ESLint's `globalIgnores` has the same three
  folders, since ESLint doesn't read `.gitignore`.

**Checked:**
- The maintainer reports that `desktop:dev` opens the app and works.
- `desktop:build` makes `src-tauri/target/release/describe.exe`, 8.9 MB, built as a windowed app (PE subsystem 2),
  so it has no console window.
- The web build passes `verify:single-file` (1522.3 KB) and contains neither `__TAURI__` nor `ipc.localhost`.
- `npm run typecheck`, `npm run lint` and `npm test` (1602 tests) pass. The e2e suite hasn't been run since these
  changes.

**A mistake that was caught:** the walkthrough's `vite.config.ts` snippet showed the `test` block as
`{ // unchanged }`. Copied literally, it emptied the Vitest settings and about 1,000 unit tests failed. The block is
restored.

**Committed with it:** `src-tauri/Cargo.lock`, which an app commits, and `Cargo.toml`, where `tauri build` added
`features = []` to `tauri` and `tauri-build`.

**Still to do:**
- **Task 2:** trim the capability set (`core:default` today), and decide whether to keep `tauri-plugin-log` in debug
  builds.
- **Task 4:** `desktop:pack`.
- **Tasks 5–10:** the checks, the About text, the rename, the Store, the reference doc and the docs.
- **The icon:** `npx tauri icon` from the source the maintainer approves.
- **The checklist:** W1–W15.

### 2026-10-31 — Built, packed and checked on the maintainer's PC (Tasks 2, 4–7, 9, 10)

**Decided with the maintainer:**
- Rename now, before Phase 23 merges (the conflicts are listed below).
- The icon comes from the favicon mark.
- My checklist rows run over CDP with the e2e mocks; the maintainer runs the native-UI rows.
- Besides the About text, two more Settings texts get desktop variants (decision 4 had kept `__DESKTOP__` to About).

**My call:** `tauri-plugin-log` is dropped. Nothing on the Rust side logs, and debug builds have DevTools.

**Done** (commits `1d0b54a`…`99fb67b` on `main_tauriBuild`):
- **Task 2:** `lib.rs` is a bare `tauri::Builder`. `log`, `tauri-plugin-log`, `serde` and `serde_json` are gone, and
  the capability grants nothing (`"permissions": []`, which `tauri-build` accepts). The app starts and runs with it.
- **Task 4:** `desktop:pack` (`scripts/pack-desktop.mjs`) and `src-tauri/msix/`. I used `winapp manifest generate`,
  not `winapp init`: it writes only the manifest and assets, with no SDKs. The pack is unsigned by default
  (`--no-sign`, for the Store); `--sign` uses `devcert.pfx`. The MSIX is 3.0 MB. A clean worktree with `npm ci` packs
  too. The `winapp` facts are in [reference/desktop.md](../reference/desktop.md#build-and-pack).
- **Decision 3 verified:** the Store reserves the fourth version number, which must be 0. So 1.0.0 packs as 1.0.0.0.
- **Task 5:** `verify-single-file.mjs` has both checks. Each was shown failing on a mirror copy in the scratchpad,
  not on `tauri.conf.json` itself, because the maintainer's `tauri dev` watches it:
  - a host changed in `tauri.conf.json`: "connect-src in src-tauri/tauri.conf.json is missing
    https://api.anthropic.com" and "…has hosts that aren't allowed: https://api.anthropic.co";
  - a host added to `vite.config.ts`: "API_HOSTS in vite.config.ts has hosts that aren't allowed: https://example.com";
  - `window.__TAURI__` added to `dist/describe.html`: "found Tauri code ("__TAURI__") in the web build";
  - `'unsafe-eval'` added to the desktop CSP: "the desktop CSP must never contain 'unsafe-eval'".
- **Task 6, trimmed (D13).** The desktop texts in `SettingsView.vue`:
  - About's first line: "DeScribe runs on this computer and calls public APIs to use LLMs."
  - "On this computer" … "saved in DeScribe's own storage."
  - The Clear saved data confirmation: "…from this app."
  - The Remember keys help is just "Leave unticked on shared computers." The draft "They're saved in DeScribe's own
    storage" repeated the About text.
  - Vitest exposes Vite's defines as globals, so `SettingsView.spec.ts` checks the desktop texts with
    `vi.stubGlobal('__DESKTOP__', true)`.
- **Task 7:** the rename covers the UI and its messages, the `<title>`, the `.docx` `creator` and description, the
  release file and tag in `release.mjs`, and the docs that mean the product. D12 is marked "*Name superseded by D35*".
  The `claude-api` skill was loaded before `claude.ts` changed (a message string only). The prompts never name the
  product, so they didn't change. `AppHeader` shows no name. Code comments still say Describe.
- **The icon:** `src-tauri/icons/source.svg` is the favicon at 1024 px. `tauri icon` made the Windows icons from it,
  and `winapp manifest update-assets` the MSIX assets. The macOS, Android, iOS and Appx tile sets are deleted. **The
  maintainer still has to approve how it looks** (W1).
- **Tasks 9 and 10:** `docs/reference/desktop.md`; AGENTS.md (Stack, Commands, rules 1 and 2); ROADMAP (§1, §4, §5,
  §9, the table); a line in TESTING.md. D35 needed no change.

**Checked:** typecheck, lint, 1605 unit tests, `build` + `verify:single-file` (1522.5 KB), and all 126 e2e tests on
the web build. The checklist rows that ran are in the reference doc: W3, W4 (button), W5 (mocked), W6 (WAV), W9,
W11 and W13 pass.

**Worth knowing:**
- **The baseline e2e run had one timeout:** a11y's "Project: every state…" took 36 s, over its 30 s limit, while
  cargo compiled alongside it. On its own it took 12.4 s. The test may be tight under load.
- **The maintainer's `tauri dev` restarts by itself** when `src-tauri/` changes (Cargo.toml, `lib.rs`, icons,
  `tauri.conf.json`). It also holds `target/debug/describe.exe`, so other debug builds need their own
  `CARGO_TARGET_DIR`.
- **A forced kill** (`taskkill /F`) lost a localStorage write made half a minute earlier; IndexedDB kept its data.
  Graceful closes keep both. This is in the Input for Phase 25.

**For the Phase 23 merge:**
- **Files that will conflict:** `SettingsView.vue` (About, and the Clear saved data message, which Phase 23 extends
  with the waiting files), `SettingsView.spec.ts`, `FolderNotice.vue`, `stores/project.ts`, `stores/transcript.ts` and
  `storage/folder.ts` (next to `FOLDER_MESSAGES`).
- **Phase 23 strings to rename once it's in:**
  - `FilesToSaveDialog.vue`'s "Describe won't keep it, and it won't be saved in the project folder.";
  - `tests/e2e/project-readonly.e2e.ts`, which expects "The browser didn't let Describe use";
  - its docs (USER_GUIDE's read-only section, PROJECTS, DECISIONS D34 where they mean the product).
- **Desktop wording:** Phase 23's About sentence about the browser asking to "upload" the folder needs a desktop
  variant. The desktop spec's `not.toContain('browser')` will fail until it has one.

**Still to do:**
- **The maintainer, on this PC:**
  - Trust `devcert.pfx` once (`winapp cert install devcert.pfx`, as administrator), install
    `release/DeScribe-v1.0.0-x64.msix` from `npm run desktop:pack -- --sign`, and run W1, W2, W4 (drag and drop),
    W6 (MP3, M4A, MP4), W7, W8, W10, W12 and W15.
  - If W8 opens links inside the app, the fix is in the reference doc. W7 decides whether a download fix is needed.
- **The maintainer, Task 8:**
  - Paste Partner Center's product identity into `src-tauri/msix/Package.appxmanifest`, then delete `devcert.pfx` so
    the next `--sign` matches.
  - Run `npm run desktop:pack` and upload the unsigned MSIX.
  - Record the visibility wording and the other steps in the reference doc's Store table.
  - Decisions 1 (the publisher account) and 5 (the privacy policy URL) are still open.
- **The work laptop:** W1–W15 from the direct link. W14 needs a second version: bump `package.json`, then pack again.
- **Then:** the results and the Input for Phase 25 in `docs/reference/desktop.md`, and the ROADMAP status set to ☑.

### 2026-10-31 — The maintainer's rows, and three fixes

The maintainer ran W1, W2, W4, W6–W10 and W12 on the installed MSIX (notes in the checklist table above; written up
in [reference/desktop.md](../reference/desktop.md#checklist)).

**Fixed:**
- **W8:** the links in Settings did nothing. `lib.rs` now builds the window from its config (`create: false`) with
  an `on_new_window` handler that opens `http`/`https` URLs in the default browser through
  `tauri_plugin_opener::open_url`. The plugin isn't registered, so there's no injected script and no capability
  (DECISIONS T16). Checked on the debug exe over CDP: the link opened in Chrome, with no new web view window.
- **W2:** the window opens maximised (`"maximized": true`).
- **W10, both builds** (asked for by the maintainer): the Reconnect screen and the error screen offer
  **New project…** after **Open another project…**. They do so in Analyse and in the **Add to project** dialog.
  "This folder isn't a DeScribe project. … or use New project." used to point to a button that wasn't there. There
  are new unit cases, and an e2e test that refuses a folder from the Reconnect screen and then creates a project in it.

**Found:** the installed app keeps its WebView2 profile in `%LOCALAPPDATA%\io.github.danielbird.describe\EBWebView`,
outside the package, in the same folder as `tauri dev`. So the two share saved data on this PC, and W15 (uninstall
removes saved data) will probably fail. A fix is to set the window's `data_directory` to the package's `LocalState`
when packaged. **The maintainer decides:** fix it in Phase 24, or leave it to Phase 25.

**For Phase 25:** W7 (no confirmation after the `.docx` saves; "Save as .docx" in the app); W10 (Reconnect asks
twice, view then edit).

**For the Phase 23 merge:** `ProjectView.vue` and `AddToProjectDialog.vue` now conflict too, and Phase 23's states
(read-only mode) should offer **New project…** the same way.

**Still to do:** a new signed build installed to check W8 and W2 again; W5 with real keys and W15 (the maintainer);
Task 8; the work laptop.

### 2026-10-31 — Saved data in the package folder (W15)

**Decided by the maintainer:** fix it in Phase 24, before the Store release.

**Done:** with package identity, `lib.rs` sets the window's `data_directory` to the package's `LocalState`
(`windows` 0.62.2, the version Tauri already uses, with the `Storage` and `Storage_Search` features). Without
identity nothing changes. See DECISIONS T17.

**Checked:**
- The unpackaged debug exe still opens on Home with no errors.
- A side-by-side test package, `DeScribe.Test`, signed with the same certificate, was installed and launched. Its web
  view used `Packages\DeScribe.Test_gsbrz2a1s0qx4\LocalState\EBWebView`. After closing it and
  `Remove-AppxPackage`, the package's data folder was gone.
- The maintainer's installed DeScribe wasn't touched.

**For the maintainer:**
- The next installed build starts with no saved data on this PC (keys, glossary, last transcript). The old data stays
  in `%LOCALAPPDATA%\io.github.danielbird.describe`, which `tauri dev` keeps using.
- `release/DeScribe-v1.0.0-x64.msix` was rebuilt for the test. Its web build includes another session's uncommitted
  changes, so run `npm run desktop:pack -- --sign` again before installing it to check W2, W8 and W15.
- The same version (1.0.0.0) is already installed: uninstall DeScribe first, or Windows refuses the new package.

### 2026-10-31 — No folder prompts in the desktop app

**Decided by the maintainer:** the app answers WebView2's folder-access prompts itself. They named
`http://tauri.localhost` as if it were the app, and their wording can't be changed.

**Done:** `on_permission_request` on the window allows `PermissionKind::FileSystemAccess` and leaves every other
permission at WebView2's default (DECISIONS T18).

**Checked:** the debug exe builds and opens on Home with no errors, and links still open in Chrome. The prompts
only appear after a real choice in the native folder picker, which the agent can't drive.

**For the maintainer, on the next installed build:** **Open project…**, **New project…** and **Reconnect** after a
restart should show the folder picker (or nothing, for Reconnect) and no prompts. Record it in W10.

### 2026-10-31 — Confirmed on the installed build; New project on the same row

**The maintainer confirmed**, on the rebuilt MSIX: the window opens maximised (W2), Settings' links open in Chrome
(W8), and the Reconnect screen offers **New project…** (W10). The folder prompts and W15 are still to report.

**Changed:** in Analyse, the tinted box (`.connect`) was capped at 34rem, so a third button wrapped. It is now at
least 34rem and grows to keep the buttons on one row (705 px with "Hearing at home 2026" in a 1280 px window). Its
text keeps the 30rem measure it had, so every other state is unchanged: measured before and after in the built
file, the box was 544 px and the text 480 px in the no-project state, with and without the notice. In a narrow
window the box fills the width and the buttons wrap as before. The **Add to project** dialog is a fixed 28rem, so its
buttons wrap there, as they already did with two; widening it would be a separate change.

**Confirmed by the maintainer** on the build with T18: no folder prompts any more, on opening a project or on
Reconnect (before, Reconnect showed Chromium's "Allow this time / Allow on every visit / Don't allow" for the
remembered folder).

**Title bar** (asked for by the maintainer): `"theme": "Light"` on the window. The bar followed Windows' dark mode
above the light-only app. Checked by capturing the debug exe's title bar from the screen: light, with the icon and
the title. Not chosen: a brand colour (no Tauri option on Windows; Windows 11 only, through Rust) and a custom title
bar (it needs Tauri calls in `src/` and loses Windows' snap layouts).

**W15 confirmed by the maintainer:** after uninstalling the rebuilt app, `%LOCALAPPDATA%\Packages\DeScribe_gsbrz2a1s0qx4`
was gone. On the maintainer's PC every row now has a result, except W5 with real keys (passed with mocks; the real
check is on the work laptop) and W14 (needs a Store update).

### 2026-10-31 — The Partner Center identity

**The maintainer** pasted Partner Center's product identity into `src-tauri/msix/Package.appxmanifest`:
`Dtype.DeScribe`, `CN=91C9FF05-C619-4D52-8155-375ADA47D090`, publisher display name `Dtype`.

**Done:**
- `npm run desktop:pack` made the unsigned MSIX for the Store: 3.0 MB, no signature, and the identity above in its
  `AppxManifest.xml`. It's ready to upload.
- `--sign` now checks `devcert.pfx` against the manifest's Publisher (`winapp cert info --json`) before the build, and
  stops with what to do. The old certificate is for `CN=DanielBird`, so a signed local build now needs it deleted and
  the new one trusted once (as administrator).

**Note:** the package family name follows from Name and Publisher. Locally installed test builds were
`DeScribe_gsbrz2a1s0qx4`; Store builds get a new family name, and their own `Packages\…` folder.

### 2026-10-31 — Status set to Done

**Decided by the maintainer:** the phase's build work is finished, so the ROADMAP status is ☑. Two items stay open,
as the other phases' open checks do:
- **Task 8:** upload the MSIX in Partner Center, and record the steps' wording in
  [reference/desktop.md](../reference/desktop.md#the-store).
- **The work laptop:** W1–W15, with the app installed from the direct link.

**Docs:** README.md now covers both builds and the desktop commands, and CHANGELOG.md's *Unreleased* has the desktop
app.
