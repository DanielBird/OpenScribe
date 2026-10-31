# AGENTS.md — DeScribe

Instructions for any coding agent working in this repository. Read this file first, then
[docs/ROADMAP.md](docs/ROADMAP.md), then the phase file you have been assigned in
[docs/phases/](docs/phases/). For release 2 (Phases 10–20), also read [docs/PROJECTS.md](docs/PROJECTS.md).

## What we are building

**DeScribe** is a transcription tool distributed as **one self-contained HTML file**. Colleagues download it
from SharePoint and double-click it; it runs from `file://` in Edge or Chrome with no install and no server.
It sends an audio/video file to the ElevenLabs Speech-to-Text API, shows a speaker-labelled, timestamped
transcript, plays audio from any turn, optionally translates to English (Claude or Gemini), and exports `.docx`.
The same source also builds a **Windows desktop app** (Tauri 2, packed as MSIX for the Microsoft Store; D35,
[docs/reference/desktop.md](docs/reference/desktop.md)).

## Stack

| Concern | Choice |
|---|---|
| UI | Vue 3, Composition API, `<script setup lang="ts">` single-file components |
| Language | TypeScript 6.0 (`~6.0`; `typescript-eslint` does not support 6.1+/7 yet), `strict: true`. Node ≥ 22.12. |
| Build | Vite + `vite-plugin-singlefile` → `dist/describe.html` |
| Desktop | Tauri 2 (`src-tauri/`, WebView2) embedding `vite build --mode desktop` → `dist-desktop/`; MSIX via Microsoft's `winapp` CLI. `__DESKTOP__` is the only switch in `src/`. |
| State | Pinia |
| Styling | Plain scoped CSS + design tokens in `src/ui/styles/tokens.css`. No UI kit, no CSS framework. |
| Unit / component tests | Vitest + `@vue/test-utils` + `happy-dom` (+ `fake-indexeddb` where needed) |
| E2E tests | Playwright, run against the **built** `dist/describe.html` over `file://`, with API calls mocked by `page.route()` |
| Runtime deps (allowed) | `vue`, `pinia`, `zod`, `idb-keyval`, `docx`, `@anthropic-ai/sdk`, `@google/genai` |

Adding any other runtime dependency requires a one-line entry in [docs/DECISIONS.md](docs/DECISIONS.md)
explaining why. Dev dependencies are fine when needed.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (no CSP in dev) |
| `npm run typecheck` | `vue-tsc -b` (app and Node-side tsconfigs, via project references) |
| `npm run lint` | ESLint (flat config, includes the layering rules below) + Prettier check |
| `npm test` | Vitest unit + component tests |
| `npm run bench` | Vitest benchmarks (`src/**/*.bench.ts`): keyword search on a generated 300-hour corpus |
| `npm run build` | Production build → `dist/describe.html` |
| `npm run verify:single-file` | Asserts `dist/` contains exactly one self-contained HTML file |
| `npm run test:e2e` | Builds, then runs Playwright (`chromium` project) against `file://.../dist/describe.html` |
| `npm run test:perf` | Builds, then times a generated 3-hour transcript (`perf` project; opt-in, see `docs/TESTING.md`) |
| `npm run release` | On a clean tree: all checks, then `release/DeScribe-v<version>.html` + `.sha256` (`docs/RELEASING.md`) |
| `npm run desktop:dev` | The desktop window on the Vite dev server in desktop mode, with hot reload |
| `npm run build:desktop` | `vue-tsc -b && vite build --mode desktop` → `dist-desktop/` (Tauri's `beforeBuildCommand`) |
| `npm run desktop:build` | `tauri build --no-bundle` → `src-tauri/target/release/describe.exe` |
| `npm run desktop:pack` | The release exe as an unsigned x64 MSIX in `release/`, for the Store; `-- --sign` signs it for this PC |

## Hard rules

1. **Single file.** The web build (`npm run build`) must emit exactly one HTML file with all JS/CSS inlined. No
   code-split chunks, no separately loaded workers (use `?worker&inline` if a worker is ever needed), no fonts,
   images or icons from the network (inline SVG only). `npm run verify:single-file` must pass, and it fails on any
   Tauri code in the web build. The desktop build (`dist-desktop/`) is a normal multi-file build; nothing in `src/`
   imports Tauri.
2. **Allowed network hosts only:** `https://api.elevenlabs.io`, `https://api.anthropic.com`,
   `https://generativelanguage.googleapis.com`. These are enforced by the CSP injected at build time, and in the
   desktop app by the CSP in `src-tauri/tauri.conf.json`. Adding a host means updating the CSP (`API_HOSTS` in
   `vite.config.ts`), `connect-src` in `tauri.conf.json`, `ALLOWED_HOSTS` in `scripts/verify-single-file.mjs` (which
   fails when the three disagree), `docs/DECISIONS.md`, and the data-flow text in Settings' About section.
3. **Secrets.** API keys are read and written only through `src/storage/secrets.ts`. Never log keys, put them in
   URLs, include them in error messages, or commit them. Tests use obviously fake keys (`test-key`).
4. **Layering.**
   - `src/domain/**` is pure TypeScript: no imports from `vue`, `pinia`, DOM globals, `providers/`, `storage/`.
   - `src/providers/**` implements the interfaces in `providers/*/types.ts` and never imports Vue or stores.
   - `src/features/**` (translation, export) may use domain + provider interfaces, never Vue or stores.
   - `src/media/**` (browser media helpers such as `probeDuration`) never imports Vue, stores or UI.
   - Stores (`src/stores/**`) orchestrate providers, features, media and storage, and never import from `src/ui/`.
     Components talk to stores. Only stores use `src/storage/`.
   - `src/storage/folder.ts` is the only code that calls the File System Access API (`showDirectoryPicker` and
     the handles it returns).
   - ESLint enforces the import side of these rules (`no-restricted-imports` in `eslint.config.js`), and
     `no-restricted-globals` / `no-restricted-properties` keep `showDirectoryPicker` in `folder.ts`.
5. **One canonical model.** UI, export and translation consume `TranscriptDoc` from `src/domain/transcript.ts`.
   Provider-specific response shapes never leave their provider folder.
6. **TypeScript.** No `any` (use `unknown` + narrowing or zod). No `@ts-ignore`; a justified
   `@ts-expect-error` with a comment is acceptable.
7. **Storage.** Keys are namespaced `describe.v1.<name>`. Every `localStorage`/`sessionStorage`/IndexedDB access is
   wrapped in try/catch (storage can be unavailable) and goes through `src/storage/*`. The IndexedDB databases are
   `describe-v1` (the last transcript, its project link under `describe.v1.lastTranscriptLink`, and the project
   folder's handle under `describe.v1.projectFolder`) and `describe-v1-corpus` (the project's session-text cache).
8. **Large data.** Hold `TranscriptDoc` in a `shallowRef` and replace it immutably; never make word arrays deeply
   reactive.
9. **Accessibility.** Real `<button>`/`<input>`/`<label>` elements, keyboard reachable, visible focus, status changes
   announced via `aria-live`.
10. **Stay in scope.** Implement only your phase. If you discover necessary work outside it, write it in the
    phase file's *Handoff* section instead of doing it.

## Definition of Done (every phase)

- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass
- [ ] `npm run build && npm run verify:single-file` pass
- [ ] `npm run test:e2e` passes (all existing specs, plus the new ones the phase requires)
- [ ] Every acceptance criterion in the phase file is met
- [ ] New UI reviewed against D13: no repeated wording, detail only when needed
- [ ] Status updated in the table in `docs/ROADMAP.md`; new API findings written to `docs/reference/*`
- [ ] Committed on a branch named `phase-N-<slug>` with message `phase N: <summary>`

## External APIs

- Default to fixtures in `fixtures/` and Playwright route mocks. Make real API calls only for the documented
  *live checks*, using a key the user provides at runtime (e.g. the `ELEVENLABS_API_KEY` env var for Node scripts).
  If no key is available, record the item as *pending* in the reference doc and continue with the documented
  assumption.
- Do not guess SDK APIs. Follow [docs/reference/llm-providers.md](docs/reference/llm-providers.md) and the official
  SDK documentation. Claude Code agents must load the `claude-api` skill before touching
  `src/providers/llm/claude.ts` or `src/providers/llm/claudeAgent.ts`, or the prompts in `src/features/summary/` and
  `src/features/agent/`.

## Conventions

- Vue components: `PascalCase.vue`. TS modules: `camelCase.ts`. Unit tests are colocated as `*.spec.ts`; e2e tests
  go in `tests/e2e/*.e2e.ts`.
- Times are seconds (`number`) internally. Format only at the UI/export edge via `formatTimestamp()`.
- IDs come from `crypto.randomUUID()` (available on `file://` in Chromium, which counts as a secure context).
- UI text is English: plain and short. Error messages say what happened and what to do next.
- **Minimal UI ([DECISIONS.md](docs/DECISIONS.md) D13).**
  - **Say each thing once.** No heading or help text that repeats a placeholder, button or nearby label.
  - **Show detail only when it's needed:** put it behind `<details>`, or show a message only when it applies.
  - **Don't announce what the user can see happen.** For example, no on-screen "Added 3" when the list grows.
  - **Keep it accessible when you remove text:** use a visually hidden label, or announce through `aria-live`.
  - **UI text in phase files is a draft.** Trim it to fit, and note what changed in the Handoff.
- Never use `console.log` in app code (`src/`). Use `console.warn`/`console.error` only for genuine faults, and
  never with secrets. Node CLI scripts in `scripts/` may print freely.
- E2E specs import `test`/`expect` from `tests/e2e/helpers.ts`, not from `@playwright/test`. Its `test` fails on
  any console error, page error or CSP violation. Open the app with `openApp(page)` (Home, then **Transcribe**) or
  `openHome(page)`, and reload with `reloadApp(page)`, not `page.reload()`, since the app always opens on Home. Click a
  page in the top row with `clickInHeader(page, name)`: the row names only the current page until it's hovered (D32).
- Stub parameters that are intentionally unused are prefixed with `_` (allowed by the lint config).
- Import zod only as `import { z } from '<relative path>/lib/zod'` (DECISIONS T8: jitless mode, so it never needs
  eval under our CSP). ESLint rejects direct `zod` imports.
- Test fixtures under `fixtures/elevenlabs/` are generated by `node scripts/make-elevenlabs-fixtures.mjs`. Edit the
  script, not the JSON files.
- `fixtures/audio/tone-5s.wav` (the e2e test recording) is generated by `node scripts/make-test-audio.mjs`. Edit the
  script, not the WAV.
