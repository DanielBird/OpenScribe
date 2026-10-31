# The desktop app (Tauri, MSIX, Microsoft Store) — reference for DeScribe

*Written 2026-10-31 in Phase 24 ([DECISIONS.md](../DECISIONS.md) D35), from the runs in the
[verification log](#verification-log) on the maintainer's PC. The Store listing and the work-laptop half of the
[checklist](#checklist) are still to do. Run the checklist again for each desktop release.*

Official docs: [Tauri 2](https://v2.tauri.app/) ·
[Tauri: Microsoft Store](https://v2.tauri.app/distribute/microsoft-store/) ·
[Microsoft Learn: winapp CLI with Tauri](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri) ·
[winapp CLI usage](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/usage) ·
[MSIX app package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)

## What the desktop app is

The same Vue app as the HTML file, in a Tauri 2 window, which draws with WebView2 (the Edge engine). `vite build
--mode desktop` writes a normal multi-file build to `dist-desktop/`, and Tauri embeds it in `describe.exe`.
`__DESKTOP__` is the only switch in `src/`, and it changes only Settings' wording. The Rust side is configuration: no
commands, no plugins, and a capability that grants nothing. The app is packed as MSIX with Microsoft's `winapp` CLI,
not Tauri's bundler, and the Store signs, hosts and updates it.

## Prerequisites

Installed on the maintainer's PC on 2026-10-31:

| Tool | Version | Check |
|---|---|---|
| Rust | rustup 1.29.2; rustc and cargo 1.99.1; default toolchain `stable-x86_64-pc-windows-msvc` | `rustup show active-toolchain` |
| MSVC C++ build tools | Visual Studio Community 2022 17.14 (Build Tools 2019 is also installed) | `vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` |
| Windows SDK | 10.0.22621.0 | `Windows Kits\10\Include` |
| `winapp` CLI | 0.7.1 (`winget install microsoft.winappcli`) | `winapp --version` |
| WebView2 runtime | 156.0.4314.56 | Settings > Apps |

In the repo: `@tauri-apps/cli` 2.12.4 (dev dependency); the crates `tauri` 2.12.5, `tauri-build` 2.7.4 (`wry` 0.57.1,
`webview2-com` 0.39.1).

`winapp` sends anonymous usage data unless `WINAPP_CLI_TELEMETRY_OPTOUT` is `1`. `scripts/pack-desktop.mjs` sets it;
set it yourself for any `winapp` command run by hand.

## Build and pack

| Command | What it does |
|---|---|
| `npm run desktop:dev` | `tauri dev`: the window on the Vite dev server in desktop mode, with hot reload. Rust changes rebuild and restart the window. |
| `npm run desktop:build` | `tauri build --no-bundle`: runs `build:desktop`, then makes `src-tauri/target/release/describe.exe`. |
| `npm run desktop:pack` | `scripts/pack-desktop.mjs`: checks the third-party notices are up to date (D36), runs `desktop:build`, then makes an unsigned x64 MSIX, `release/DeScribe-v<version>-x64.msix`, for the Store. |
| `npm run desktop:pack -- --sign` | The same, signed with a development certificate, `devcert.pfx`, so it installs on this PC. |

**Sizes (2026-10-31, version 1.0.0):**
- `dist-desktop/`: `index.html`, one JS file (1.43 MB), one CSS file (129 KB) and two small chunks.
- `describe.exe`: 9.0 MB, a windowed app (PE subsystem 2), so no console window opens.
- The MSIX: 3.0 MB.

**The MSIX version** is `package.json`'s `x.y.z` with `.0` added. The Store reserves the fourth number, which must be
0, and each of the others is 0–65535, the first above 0 (*App package requirements*, "Version numbering for Windows
10 and 11 packages"). The script stops for any other version. An update needs a higher version.

**What `pack-desktop.mjs` stages** in `src-tauri/target/msix/` (gitignored): `describe.exe` and
`src-tauri/msix/Assets/`. The manifest, with the version written in, goes beside the stage in
`src-tauri/target/msix-manifest/`. The committed manifest never changes.

**Signing for this PC:** `winapp cert generate` makes `devcert.pfx` with the manifest's Publisher and the public
default password `password`, so it is for development only. Trust it once, as administrator:
`winapp cert install devcert.pfx`. Then double-click the MSIX, or `Add-AppxPackage`. When the manifest's Publisher
changes, `devcert.pfx` no longer matches: `--sign` stops before the build and says to delete it (checked with
`winapp cert info --json`). The next `--sign` makes a matching one, to trust once more. Never sideload a development
build on the work laptop.

**Facts about `winapp` 0.7.1:**
- `winapp manifest generate` makes the manifest and the default assets, with no SDKs and no certificate. It refuses
  to run unless the target folder exists and the `--executable` exists in the working directory. It writes
  `Executable="$targetnametoken$.exe"` (we set `describe.exe`) and a file with mixed CRLF and LF line ends.
- `winapp manifest update-assets <image> --manifest <path>` makes every tile and logo from one image, and takes SVG.
- `winapp pack <folder>` packs every file in the folder. It writes `resources*.pri`, `pri.resfiles` and
  `priconfig.xml` into it (the scaled assets need the PRI files). A manifest left in the folder would be packed too,
  hence the separate manifest folder. `--no-sign` delivers an unsigned package, for the Store. On first use it
  downloads `Microsoft.Windows.SDK.BuildTools` (10.0.28000.2957) into its own cache.
- `winapp cert generate` appends `devcert.pfx` to `.gitignore`, though `*.pfx` already covers it. The line is kept so
  the tree stays clean.

## The manifest (`src-tauri/msix/Package.appxmanifest`)

Made by `winapp manifest generate`, then edited:
- `Identity`: `Name="Dtype.DeScribe"`, `Publisher="CN=91C9FF05-C619-4D52-8155-375ADA47D090"`, and
  `PublisherDisplayName` `Dtype`, from Partner Center's **Product management → Product identity** (2026-10-31).
  `ProcessorArchitecture="x64"`. The package family name (the `Packages…` folder) follows from Name and Publisher,
  so the earlier test builds' `DeScribe_gsbrz2a1s0qx4` is gone.
- `DisplayName` DeScribe; `Application Id="DeScribe"` (it fixes the app's ID in Windows, so it doesn't change);
  `Executable="describe.exe"`; `EntryPoint="Windows.FullTrustApplication"`.
- `TargetDeviceFamily` `Windows.Desktop`, `MinVersion` 10.0.18362.0, `MaxVersionTested` 10.0.26200.0, as generated.
- One language, `en-us`. One capability, `runFullTrust`, which every packaged desktop app declares.
- `uap10:PackageIntegrity` with content enforcement on, as generated.
- The assets come from `src-tauri/icons/source.svg`, the favicon mark from `index.html` at 1024 px, which
  `npx tauri icon` also used for the exe and window icons in `src-tauri/icons/`.

## The window and the web view

- **Origin:** `http://tauri.localhost`. `isSecureContext` is true, so `crypto.randomUUID`, the clipboard and the
  File System Access API are there. The user agent is Edge 156's.
- **Storage** is the app's own WebView2 profile, not shared with the HTML file or any local page (so D3's warning
  doesn't apply). It is best-effort (`navigator.storage.persisted()` is false), with a quota of about 10.7 GB.
  - **Installed (MSIX):** in the package's own folder, `%LOCALAPPDATA%\Packages\<family name>\LocalState\EBWebView`,
    which uninstalling removes (DECISIONS T17). `lib.rs` sets the window's `data_directory` to
    `ApplicationData.Current.LocalFolder` when the app has package identity.
  - **Unpackaged** (`tauri dev`, the bare exe): Tauri's default, `%LOCALAPPDATA%\io.github.danielbird.describe\EBWebView`
    (123 MB after a few runs, most of it WebView2's own profile).
  - **Why it's set:** WebView2's `msedgewebview2.exe` runs outside the package, so Windows doesn't redirect its
    writes. Installed 1.0.0, without `data_directory`, kept its profile in the unpackaged folder, shared with
    `tauri dev`, where an uninstall would have left it (keys included).
- **Capabilities:** `src-tauri/capabilities/default.json` grants no permissions. Tauri still injects its IPC bridge
  (`window.__TAURI_INTERNALS__` exists), but any call through it is denied.
- **DevTools:** debug builds have them. Release builds don't, because the `devtools` feature isn't enabled
  (Tauri's `devtools` window option: "requires `devtools` feature flag to enable it in release builds").
- **Drag and drop:** the window sets `dragDropEnabled: false` (the name is in Tauri's config schema), so WebView2's
  own drag and drop reaches the page and `FileDrop` works as in Edge.
- **Window:** titled DeScribe, opens maximised (1280 × 860 when restored), at least 800 × 600. `"theme": "Light"`
  keeps Windows' title bar light to match the app, which is light-only (`color-scheme: light`); by default it follows
  Windows' dark mode. `create` is false in
  `tauri.conf.json`: `src-tauri/src/lib.rs` builds the window from that config, with an `on_new_window` handler.
- **Folder access:** WebView2's File System Access prompts name the origin ("http://tauri.localhost will be able to
  edit files in …") and come twice, view then edit (W10, 1.0.0); their wording can't be set. The window's
  `on_permission_request` answers `PermissionKind::FileSystemAccess` (WebView2's `FILE_READ_WRITE`) with **Allow**,
  since the user has just chosen the folder in Windows' picker; every other permission keeps WebView2's default
  (DECISIONS T18). **Confirmed on the installed build:** no prompts any more, including Chromium's three-way
  prompt for a remembered folder ("Allow this time / Allow on every visit / Don't allow") on Reconnect.
- **Links:** WebView2 opens nothing for a link with `target="_blank"` (W8, 1.0.0). The handler refuses every new
  window and opens `http`/`https` URLs in the default browser with `tauri_plugin_opener::open_url`. The plugin isn't
  registered, so it injects no script and needs no capability (DECISIONS T16). All the app's external links (Settings'
  About) have `target="_blank"`; nothing guards a link without it, which would navigate the window away.

### The CSP

As shipped, in `src-tauri/tauri.conf.json` (`app.security.csp`):

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
media-src blob:; font-src 'self' data:;
connect-src ipc: http://ipc.localhost https://api.elevenlabs.io https://api.anthropic.com https://generativelanguage.googleapis.com;
base-uri 'none'; form-action 'none'
```

As the web view received it (W13): the same directives, with three `'sha256-…'` sources added to `script-src` for
Tauri's own scripts. The hashes change with each build. `npm run verify:single-file` fails if `connect-src` here
(without `ipc:` and `http://ipc.localhost`), `API_HOSTS` in `vite.config.ts` and its own `ALLOWED_HOSTS` aren't the
same three hosts, or if this CSP loses `default-src 'none'` or gains `'unsafe-eval'`.

## The Store

*Not done yet: Task 8 of Phase 24, by the maintainer.* Record each step's exact Partner Center wording here.

| Step | What was done, and Partner Center's wording |
|---|---|
| Product | **DeScribe**, reserved 2026-10-31 as an *MSIX or PWA app*. |
| Product identity | In the manifest (2026-10-31): `Dtype.DeScribe`, `CN=91C9FF05-C619-4D52-8155-375ADA47D090`, `Dtype`. |
| Package | `release/DeScribe-v1.0.0-x64.msix` from `npm run desktop:pack`: unsigned (no `AppxSignature.p7x`), 3.0 MB, with that identity. Windows App Certification Kit 10.0.22621.5040: **PASSED** (see below). *Upload: not done yet.* |
| Visibility | *Available, but not discoverable: only the direct link reaches it. Record the setting's wording.* |
| Price and properties | *Free; category; the privacy policy URL; age rating; one screenshot.* |
| `runFullTrust` | *If asked: it's a desktop app.* |
| Certification notes | *The app needs the user's own API keys (ElevenLabs, and Claude or Gemini to translate).* |
| Direct link | *The listing's URL, for the work laptop.* |

### The certification kit

Run on 2026-10-31 (Start → **Windows App Cert Kit**, as administrator → **Validate Store App**): **overall result
PASSED**. All the required tests passed: package compliance, Windows security features, manifest resources, special
use capabilities, Windows Runtime metadata and high-DPI support.

One optional test, which the report says isn't used for Store onboarding, failed: **Blocked executables**.
`describe.exe` contains references to `CreateProcessW`, `ShellExecuteW` and `ShellExecuteExW`, and the strings
`cmd.exe` and `bash`. The kit's concern is Windows 10 in S mode, where launching other programs is restricted.
- **Where they come from:** the app never starts `cmd` or `bash`. `ShellExecuteW` is how the opener crate hands a link
  to the default browser (T16). The other references come from the libraries compiled in: Rust's standard library
  has the code that runs `.bat` files through `cmd.exe`, whether or not it's used.
- **Left as it is:** removing the opener crate wouldn't clear the test, because the standard library's references
  stay. The kit says to ignore entries that don't launch programs outside the app.

## Checklist

Maintainer's PC: Windows 11, WebView2 156.0.4314.56. The agent's rows ran on the debug exe with its own data folder,
driven over CDP (below) with the e2e mocks, so no real API was called. The maintainer's rows ran on the installed
1.0.0 MSIX (signed with the development certificate), with real keys. Work laptop: the app installed from the direct
link.

| ID | Check | Maintainer's PC | Work laptop |
|---|---|---|---|
| W1 | Install: a Start menu entry with the name and icon. The size of the MSIX and of the installed app. | **Pass.** The Start menu entry and the icon are right; it's in Installed apps. The MSIX is 3.0 MB, installed 8.7 MB. | *not run* |
| W2 | Opens on Home with no console window. Resizes down to its minimum without breaking the layout; sharp at 125 % and 150 %. | **Pass**, but it didn't open maximised. **Fixed:** the window now opens maximised (debug exe: 2560 × 1369 on a 2560 × 1392 work area; **confirmed on the installed build**). | *not run* |
| W3 | With **Remember keys** ticked, keys survive closing and reopening the app. Unticked, they're gone after a restart. | **Pass** (the maintainer, and over CDP). | *not run* |
| W4 | Choose a recording with the button and by drag and drop. Upload progress moves, and the transcript appears. | **Pass**, with the button and by drag and drop. | *not run* |
| W5 | **Translate to English** with Claude and with Gemini. | **Pass, mocked:** one request to each, and the turns read in English. *Real APIs: work laptop.* | *not run* |
| W6 | Click a turn: playback starts there, for an MP3, an M4A and an MP4. | **Pass** for all three. | *not run* |
| W7 | **Download .docx:** what happens, and where the file goes. | **Works:** the file goes to Downloads with no Save dialog. The app shows no sign that it saved. The maintainer wants a confirmation and "Save as .docx" in the app (Phase 25). | *not run* |
| W8 | The links in Settings open in the default browser, not in the app window. | **Failed, fixed.** In the installed 1.0.0 the links did nothing. With the `on_new_window` handler, **ElevenLabs API keys page** opened in Chrome (the default browser), the app stayed put, and no error was logged (debug exe, over CDP). **Confirmed on the installed build.** | *not run* |
| W9 | The Copy buttons put text on the clipboard. | **Pass** (the maintainer). Over CDP, **Copy list** said "Copied 1 term."; reading the clipboard back from the page raises a WebView2 permission prompt. | *not run* |
| W10 | **Open project** with the existing folder code: the picker, **Add to project**, access after a restart. On the work laptop: does Edge's folder-write block (D34) apply inside the app? | **Pass, with Reconnect.** The picker opens, **Add to project** saves (the file is there after a restart). After a restart **Reconnect** is needed, and it asks for permission twice (view, then edit), in prompts that name `http://tauri.localhost`. The app now grants folder access itself, and the prompts are gone (**confirmed on the installed build**). The Reconnect screen had no **New project…**, though refusing a folder pointed to it; it has now, in both builds (**confirmed on the installed build**), on the same row as the other buttons when the window has room. | *not run* |
| W11 | The last transcript and the glossary survive a restart, and **Clear saved data** clears them. | **Pass.** Both were there after a restart; after **Clear saved data** ("…from this app.") and a restart, both were gone and the key stayed. | *not run* |
| W12 | Mouse Back and Forward, Alt+Left and Alt+Right (D28), F5, Ctrl+R, Ctrl+F, Ctrl+P, Ctrl+plus and Ctrl+minus: which do something. | **Pass.** All of them work except Ctrl+plus and Ctrl+minus, which is fine (no fix wanted). | *not run* |
| W13 | Debug build: the CSP the web view reports, and the Network panel shows only the three API hosts (plus Tauri's `ipc`). | **Pass.** The CSP is [above](#the-csp). Requests over a whole run went to `http://tauri.localhost` and the three API hosts only, with no `ipc` traffic (the app makes no IPC calls). No console errors. | *not run* |
| W14 | **Update:** submit a second version. It updates and keeps keys, glossary and the last transcript. | *Store only* | *not run* |
| W15 | **Uninstall:** saved data goes too. Record where it lived. | **Failed in 1.0.0, fixed.** Installed 1.0.0 kept its data outside the package, in `%LOCALAPPDATA%\io.github.danielbird.describe\EBWebView`. With `data_directory`, a side-by-side test package (`DeScribe.Test`) kept it in `Packages\DeScribe.Test_gsbrz2a1s0qx4\LocalState\EBWebView` (7.6 MB on first launch), and uninstalling removed that folder. **Confirmed by the maintainer** on the installed build: after uninstalling, `PackagesDeScribe_gsbrz2a1s0qx4` was gone. | *not run* |

**How my rows ran:** the debug exe was built with `CARGO_TARGET_DIR=src-tauri/target/cdp npx tauri build --debug
--no-bundle`. It was started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` and
`WEBVIEW2_USER_DATA_FOLDER` set to a scratch folder, so it didn't touch the dev app's data. Playwright then connected
with `chromium.connectOverCDP` and used `tests/e2e/helpers.ts`'s mocks. Each restart closed the window gracefully
(`taskkill` without `/F`). The script isn't in the repo: automated desktop tests are Phase 25's.

## Input for Phase 25

**Can stay as it is** (it works in the web view): the API calls (CORS accepts `http://tauri.localhost`, D35), the
transcription upload with progress, translation, playback from a blob URL, `clipboard.writeText`, IndexedDB and
localStorage in the app's own profile, the keys' Remember setting, and Clear saved data.

**To replace or decide, once the open rows are in:**
- **Folders:** W10 decides whether the web view's File System Access is enough, or whether Tauri's `fs` and `dialog`
  plugins are needed (with access that survives a restart).
- **Export (W7):** the `.docx` lands in Downloads with no sign in the app. The maintainer wants a confirmation, and
  the button named "Save as .docx" in the app, which suggests a **Save** dialog.
- **Reconnect is still needed (W10):** the app now grants folder access without prompts, but after a restart the
  remembered folder still needs the **Reconnect** click. Tauri's native file access would keep it across restarts.
- **Keys:** they sit in the app's localStorage. Windows Credential Manager would need an async `secrets.ts`.
- **Wording:** messages that say "browser" are wrong in the app, beyond the three Settings texts already done:
  "This browser can't open project folders", "The browser didn't let DeScribe use this folder… ask IT", "This browser
  isn't saving …", and the folder notices. Phase 23's read-only mode adds more (it asks the browser to "upload" the
  folder).
- **Closing mid-run:** the `beforeunload` guards (job, translation, pipeline) probably don't stop the window closing.
  Check whether closing the window during a transcription asks first.
- **A forced kill loses recent localStorage writes.** With `taskkill /F`, a key saved half a minute earlier was gone
  after a restart, while IndexedDB kept the transcript. A crash or a forced shutdown could do the same.
- **Storage isn't persistent:** `navigator.storage.persist()` could ask for it, so Windows doesn't evict it under
  storage pressure.
- **One instance, ARM64, moving data over from the HTML file:** still out of scope (the app starts with no saved
  data).

## Verification log

| Date | Where | What | Result |
|---|---|---|---|
| 2026-10-31 | Maintainer's PC | `npx tauri info`; `desktop:dev` and `desktop:build` | Pass (the maintainer, then Phase 24). The release exe is windowed. |
| 2026-10-31 | Maintainer's PC, debug exe over CDP | Startup with no permissions; the CSP header; `isSecureContext`; browser APIs | Opens on Home with no console errors. See [the window and the web view](#the-window-and-the-web-view). |
| 2026-10-31 | Maintainer's PC, debug exe over CDP, e2e mocks | W3, W4 (button), W5 (mocked), W6 (WAV), W9, W11, W13 | As in the [checklist](#checklist). |
| 2026-10-31 | A clean worktree of `99fb67b`, after `npm ci` | `npm run desktop:pack` | An unsigned x64 MSIX, 3.0 MB. |
| 2026-10-31 | Maintainer's PC | `npm run desktop:pack -- --sign` | A signed MSIX (development certificate, `CN=DanielBird`). |
| 2026-10-31 | Maintainer's PC, the installed 1.0.0 MSIX, real keys | W1, W2, W4, W6, W7, W8, W9, W10, W12 (the maintainer) | As in the checklist. W8 failed. |
| 2026-10-31 | Maintainer's PC, debug exe over CDP | W2 and W8 after the fixes | Opens maximised; the link opened in Chrome. |
| 2026-10-31 | Maintainer's PC, the installed 1.0.0 MSIX | Where it keeps its data (W15, first half) | In `%LOCALAPPDATA%\io.github.danielbird.describe\EBWebView`, outside the package. |
| 2026-10-31 | Maintainer's PC, a test package (`DeScribe.Test`, same certificate) beside the installed app | W15 with `data_directory`: install, launch, uninstall | Data in the package's `LocalState\EBWebView`; gone after uninstalling. The installed app wasn't touched. |
| 2026-10-31 | Maintainer's PC, the rebuilt MSIX (with T17, T18, the light title bar) | W2, W8, W10 (no folder prompts), W15 | All confirmed by the maintainer. |
| 2026-10-31 | Maintainer's PC, Windows App Certification Kit 10.0.22621.5040 (Windows 11 26200), the unsigned 1.0.0.0 MSIX | **Validate Store App** | **Passed.** Every required test passed. One optional test failed, *Blocked executables*: see [the certification kit](#the-certification-kit). |
| – | Work laptop | W1–W15 from the direct link | Not run |
