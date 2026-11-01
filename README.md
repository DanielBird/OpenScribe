# DeScribe

DeScribe turns recorded interviews and meetings (English, German or French) into speaker-labelled, timestamped
transcripts, and helps a research team find quotes and themes across a whole project of them. It sends recordings to
ElevenLabs Speech-to-Text and uses Claude or Gemini to translate, summarise and answer questions, always with the
user's own API keys.

One source builds two apps:

- **The HTML file:** one self-contained file. Colleagues download it from SharePoint and double-click it; it runs from
  `file://` in Edge or Chrome, with no install and no server.
- **The Windows desktop app:** the same Vue app in a Tauri 2 window (WebView2), packed as MSIX for the Microsoft
  Store ([DECISIONS.md](docs/DECISIONS.md) D35).

This README is the developer quickstart. Before changing anything, read [AGENTS.md](AGENTS.md) (rules for every
contributor and coding agent), [docs/ROADMAP.md](docs/ROADMAP.md) (architecture, data model, phase plan) and, for
project work, [docs/PROJECTS.md](docs/PROJECTS.md).

## What it does

DeScribe opens on **Home**, with two modes and a **Settings** page.

**Transcribe** (Setup → Glossary → Output):
- Transcription with ElevenLabs `scribe_v2`: speakers, word timestamps, language auto/EN/DE/FR, optional number of
  speakers, zero retention. Recordings up to 3 GB and 10 hours.
- A glossary of project terms, sent to ElevenLabs as key terms.
- The transcript by speaker turn: rename speakers, edit the text, click a turn to play the recording from there.
- Translation to English with Claude or Gemini, and `.docx` export of the original or the English version.
- The latest transcript is saved in the browser and reopens after a reload.
- **Add to project…** saves the transcript to a project folder, translates it to English if needed, and summarises it.

**Analyse** (projects):
- A project is a shared folder, for example in OneDrive, opened through the File System Access API. It holds a brief
  (`describe-project.json`), each session's transcript and summary (`sessions/`) and saved chats (`chats/`).
- Session summaries are guided by the project brief: synopsis, respondents, research questions and themes, with
  quotes checked against the transcript. They are regenerated, not edited.
- Keyword search across every transcript, in English and the original language, with **Copy** with citation.
- A project chat with Claude or Gemini: the model searches and reads the transcripts and summaries, then answers with
  quotes that DeScribe checks. What it did and the approximate cost are under each answer. Chats are saved in the
  project folder for colleagues to read, and `/compact` summarises a long one.
- The model for project work is chosen in Analyse: Claude Sonnet 5.5 or Opus 5.5, Gemini 3.8 Flash or Gemini 4 Argon.

**Settings:** API keys (with **Verify key** and **Remember keys on this computer**), your name on chats, **Clear
saved data**, and where data goes.

The user-facing description is [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Where data goes

- Only three hosts are ever called: `api.elevenlabs.io`, `api.anthropic.com` and `generativelanguage.googleapis.com`.
  A Content Security Policy enforces it: injected into the HTML file at build time, and in
  `src-tauri/tauri.conf.json` for the desktop app. `npm run verify:single-file` fails if the two lists, and its own,
  disagree.
- There is no backend. Keys, the glossary, settings and the last transcript stay in the browser's (or the desktop
  app's own) storage. Project files live in the folder the user picks.

## Prerequisites

For the HTML file, tests and development:
- Node.js **22.12 or newer** (required by Vite 8, Vitest 5 and `@vitejs/plugin-vue` 6), with npm

For the desktop app (Windows only), as well:
- Rust with the `stable-x86_64-pc-windows-msvc` toolchain
- The MSVC C++ build tools (Visual Studio 2022 or its Build Tools) and the Windows SDK
- The WebView2 runtime (part of Windows 11)
- Microsoft's `winapp` CLI, to pack the MSIX: `winget install microsoft.winappcli`

The versions in use are listed in [docs/reference/desktop.md](docs/reference/desktop.md#prerequisites).

## Setup

```bash
npm install
```

```bash
npx playwright install chromium
```

## Commands

### HTML file and tests

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at `http://localhost:5173` (no CSP in dev) |
| `npm run typecheck` | `vue-tsc -b` over the app (`tsconfig.app.json`) and the Node-side files (`tsconfig.node.json`) |
| `npm run lint` | ESLint (including the layering rules) + `prettier --check` |
| `npm run format` | Prettier write + ESLint autofix |
| `npm test` | Vitest unit and component tests (`src/**/*.spec.ts`) |
| `npm run bench` | Vitest benchmarks: keyword search over a generated 300-hour corpus |
| `npm run build` | Typecheck, build, and rename to `dist/describe.html` |
| `npm run verify:single-file` | Checks that `dist/` holds exactly one self-contained HTML file with the expected CSP, no Tauri code, and API hosts that match the desktop CSP |
| `npm run test:e2e` | Builds, then runs Playwright against `dist/describe.html` over `file://`, with the APIs and the project folder mocked (includes axe accessibility checks) |
| `npm run test:perf` | Builds, then times a generated 3-hour transcript and a generated 300-hour project (opt-in; see [docs/TESTING.md](docs/TESTING.md)) |
| `npm run notices` | Regenerates the two `THIRD-PARTY-NOTICES` files from the build and `cargo metadata`; run it after a dependency change |
| `npm run release` | On a clean tree: runs every check, then writes `release/DeScribe-v<version>.html` and its `.sha256` (see [docs/RELEASING.md](docs/RELEASING.md)) |

### Desktop app

| Command | What it does |
|---|---|
| `npm run desktop:dev` | Opens the app window on the Vite dev server in desktop mode, with hot reload |
| `npm run build:desktop` | Typecheck, then `vite build --mode desktop` → `dist-desktop/` (a normal multi-file build) |
| `npm run desktop:build` | Builds `dist-desktop/` and the release exe, `src-tauri/target/release/describe.exe` |
| `npm run desktop:pack` | Builds the release exe and packs it as an unsigned x64 MSIX, `release/DeScribe-v<version>-x64.msix`, for the Store |
| `npm run desktop:pack -- --sign` | The same, signed with a development certificate (`devcert.pfx`, never committed) so it installs on this PC |

## Trying the build

**HTML file:** run `npm run build`, then double-click `dist/describe.html`. It opens from `file://` with no server.

**Desktop app:** `npm run desktop:dev` opens it straight away. To try the installed app, run
`npm run desktop:pack -- --sign`, trust the certificate once (as administrator: `winapp cert install devcert.pfx`),
then double-click the MSIX. The installed app keeps its saved data in its package folder, separate from the HTML file
and from `desktop:dev`. Details, the Store steps and the W1–W15 checklist are in
[docs/reference/desktop.md](docs/reference/desktop.md).

## Project layout

See [ROADMAP.md §5](docs/ROADMAP.md#5-architecture) for every file. In short:

| Folder | What's in it |
|---|---|
| `src/domain` | Pure TypeScript: the canonical `TranscriptDoc`, segmentation, glossary, the corpus (search, quote check, citations), summaries, projects and chats |
| `src/providers` | ElevenLabs transcription; Claude and Gemini for structured output and for the project agent's tool-use loop |
| `src/features` | Translation, `.docx` export, session summaries, and the project agent (tools, context, checked answers, `/compact`) |
| `src/stores` | Pinia stores: the only place that wires providers, features and storage to the UI |
| `src/storage` | `localStorage`, keys (`secrets.ts`), IndexedDB, and the project folder (`folder.ts`, the only code that calls the File System Access API) |
| `src/ui` | Vue views (Home, Setup, Glossary, Output, Project, Settings), components and styles |
| `src-tauri` | The desktop app: `tauri.conf.json` (window, CSP), a capability that grants nothing, `src/lib.rs`, icons, and the MSIX manifest in `msix/` |
| `tests/e2e` | Playwright specs, run on the built HTML file with mocked APIs and an in-memory project folder |
| `fixtures`, `scripts` | Generated test data, and the build, verify, release and pack scripts |

Nothing in `src/` imports Tauri. `__DESKTOP__`, a build-time define, is the only switch between the two builds, and it
changes only some of Settings' wording. Decisions and their reasons are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Docs

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md): for colleagues who use DeScribe
- [docs/PRIVACY.md](docs/PRIVACY.md): the privacy statement (also for the Store listing)
- [docs/RELEASING.md](docs/RELEASING.md) and [CHANGELOG.md](CHANGELOG.md): making and sharing a release
- [docs/TESTING.md](docs/TESTING.md): the test suites, performance numbers and the manual release checklist
- [docs/ROADMAP.md](docs/ROADMAP.md), [docs/PROJECTS.md](docs/PROJECTS.md) and [docs/phases/](docs/phases/): the plan,
  each phase's tasks and handoff notes, and the status of each phase
- [docs/reference/](docs/reference/): API and platform facts for ElevenLabs, Claude and Gemini, the File System
  Access API, and the desktop app

## License

[MIT](LICENSE). The open-source software DeScribe includes, and its licences, are listed in
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) and, for the Windows app,
[THIRD-PARTY-NOTICES-DESKTOP.txt](THIRD-PARTY-NOTICES-DESKTOP.txt). Settings shows both.

The MIT License covers the code, not the DeScribe name or logo. You're welcome to fork, change and redistribute
DeScribe, but give your version its own name and logo, and don't present it as DeScribe or as coming from its author.
Saying it is based on DeScribe is fine.
