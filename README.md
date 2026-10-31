# DeScribe

A transcription tool shipped as **one self-contained HTML file**. Colleagues download it from SharePoint and open it
in Edge or Chrome; it sends a recording to ElevenLabs Speech-to-Text and shows a speaker-labelled, timestamped
transcript that can be translated to English and downloaded as `.docx`.

This README is the developer quickstart. Before changing anything, read [AGENTS.md](AGENTS.md) (rules for every
contributor and coding agent) and [docs/ROADMAP.md](docs/ROADMAP.md) (architecture, data model, phase plan).

## Prerequisites

- Node.js **22.12 or newer** (required by Vite 8, Vitest 5 and `@vitejs/plugin-vue` 6)
- npm (bundled with Node)

## Setup

```bash
npm install
```

```bash
npx playwright install chromium
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at `http://localhost:5173` (no CSP in dev) |
| `npm run typecheck` | `vue-tsc -b` over the app (`tsconfig.app.json`) and the Node-side files (`tsconfig.node.json`) |
| `npm run lint` | ESLint (including the layering rules) + `prettier --check` |
| `npm run format` | Prettier write + ESLint autofix |
| `npm test` | Vitest unit and component tests (`src/**/*.spec.ts`) |
| `npm run build` | Typecheck, build, and rename to `dist/describe.html` |
| `npm run verify:single-file` | Checks that `dist/` holds exactly one self-contained HTML file with the expected CSP |
| `npm run test:e2e` | Builds, then runs Playwright against `dist/describe.html` over `file://` (includes axe accessibility checks) |
| `npm run test:perf` | Builds, then times a generated 3-hour transcript (opt-in; see [docs/TESTING.md](docs/TESTING.md)) |
| `npm run release` | On a clean tree: runs every check, then writes `release/DeScribe-v<version>.html` and its `.sha256` (see [docs/RELEASING.md](docs/RELEASING.md)) |

## Trying the build

Run `npm run build`, then double-click `dist/describe.html`. It opens from `file://` with no server.

## Docs

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md): for colleagues who use DeScribe
- [docs/RELEASING.md](docs/RELEASING.md) and [CHANGELOG.md](CHANGELOG.md): making and sharing a release
- [docs/TESTING.md](docs/TESTING.md): the test suites, performance numbers and the manual release checklist

## Project layout

See [ROADMAP.md §5](docs/ROADMAP.md#5-architecture). In short: `src/domain` is pure TypeScript, `src/providers` talk
to the APIs, `src/features` hold translation and export logic, `src/stores` (Pinia) orchestrate, and `src/ui` holds
the Vue components. Decisions and their reasons are in [docs/DECISIONS.md](docs/DECISIONS.md).
