# Phase 0 — Scaffold & single-file build

**Goal:** An empty but production-shaped app. `npm run build` produces one self-contained `dist/describe.html`. It
opens from `file://` in Edge and shows the three-step shell. Typed store skeletons let later phases run in
parallel. The full toolchain (lint, typecheck, unit tests, e2e tests against the built file) is green.

**Depends on:** nothing.

**Read first:** [AGENTS.md](../../AGENTS.md), [ROADMAP.md](../ROADMAP.md) §5–6, [DECISIONS.md](../DECISIONS.md)
D1, D12, T1, T4.

## Tasks

1. **Repository**
   - `git init`, default branch `main`. Add `.gitignore`: `node_modules/`, `dist/`, `release/`, `.env*`,
     `test-results/`, `playwright-report/`, `*.local`.
   - ⚠️ The folder already contains `AGENTS.md`, `CLAUDE.md` and `docs/`. **Do not let `create-vite` delete them.**
     Scaffold into a temporary sibling folder (`npm create vite@latest describe-tmp -- --template vue-ts`), move
     the generated files in, then delete the temp folder. Or create the files by hand.
2. **Dependencies**
   - Runtime: `vue`, `pinia`.
   - Dev: `vite`, `@vitejs/plugin-vue`, `vite-plugin-singlefile`, `typescript`, `vue-tsc`, `vitest`,
     `@vue/test-utils`, `happy-dom`, `@playwright/test`, `eslint`, `typescript-eslint`, `eslint-plugin-vue`,
     `@vue/eslint-config-typescript` (or an equivalent flat config), `prettier`, `eslint-config-prettier`.
   - Install the Playwright Chromium browser (`npx playwright install chromium`).
3. **`vite.config.ts`**
   - Plugins: `vue()`, `viteSingleFile()`, and a local `cspPlugin()` (`apply: 'build'`, `transformIndexHtml`
     injects the CSP `<meta>` from DECISIONS T1 as the first child of `<head>`).
   - `base: './'`, `build.target: 'es2022'`, `build.cssCodeSplit: false`, `build.assetsInlineLimit:
     100_000_000`, `build.chunkSizeWarningLimit: 5000`.
   - `define`: `__APP_VERSION__` (from `package.json`) and `__BUILD_DATE__` (ISO date). Declare both in
     `src/env.d.ts`.
   - Vitest config (in the same file or `vitest.config.ts`): `environment: 'happy-dom'`, include
     `src/**/*.spec.ts`.
4. **`index.html`:** `lang="en"`, `<title>Describe</title>`, a `<meta name="viewport">`, an inline SVG favicon
   (data URI), `<div id="app">`. No external links.
5. **`scripts/postbuild.mjs`:** rename `dist/index.html` → `dist/describe.html`. Wire it into `npm run build`
   (`vue-tsc --noEmit && vite build && node scripts/postbuild.mjs`).
6. **`scripts/verify-single-file.mjs`** fails (exit 1) unless all of the following hold:
   - `dist/` contains exactly one file, `describe.html`.
   - The HTML has no `<script src=`, `<link rel="stylesheet"`, `<link … href="http`, `@import`, or
     `url(http`.
   - The CSP meta is present and its `connect-src` lists exactly the 3 allowed hosts.
   - It prints the file size. Warn (don't fail) above 3 MB.
7. **`scripts/release.mjs`:** run the build and verify, copy to `release/Describe-v<version>.html`, and print
   the SHA-256. (Phase 8 refines this.)
8. **`package.json` scripts:** `dev`, `build`, `typecheck`, `lint` (eslint + `prettier --check`), `format`,
   `test` (`vitest run`), `test:watch`, `verify:single-file`, `test:e2e` (`npm run build && playwright test`),
   `release`.
9. **Canonical types:** create `src/domain/transcript.ts` with the **types only** from ROADMAP §6 (no helper
   functions yet; Phase 1 adds them).
10. **Store skeletons** (Pinia setup stores with typed state; actions may be stubs that throw
    `new Error('Not implemented: phase N')`):
    - `nav.ts`: `step: Ref<'setup' | 'glossary' | 'output'>`, `goTo(step)`, `canEnter(step): boolean`.
      Glossary is enterable when `settings.isReady`; output when `transcript.doc !== null ||
      job.status !== 'idle'`.
    - `settings.ts`: `elevenLabsKey`, `claudeKey`, `geminiKey` (strings), `languageHint: LanguageHint`,
      `numSpeakers: number | null`, `zeroRetention: boolean`, `file: File | null` (`shallowRef`),
      `fileDurationSec: number | null`, getter `isReady` (stub: key non-empty and file set).
    - `glossary.ts`: `terms: string[]`; stub actions `addFromText`, `updateTerm`, `removeTerm`, `clear`; getter
      `validTerms`.
    - `job.ts`: `status: 'idle' | 'uploading' | 'processing' | 'done' | 'error' | 'cancelled'`,
      `progress: { loaded: number; total: number } | null`, `startedAt: number | null`, `error: ProviderError |
      null` (type it as `unknown` until Phase 1 adds `ProviderError`), stub `start()`, `cancel()`, `retry()`.
    - `transcript.ts`: `doc: ShallowRef<TranscriptDoc | null>`, `view: 'original' | 'en'`, stub
      `setDoc`, `renameSpeaker`, `loadAutosave`.
11. **`src/storage/local.ts`**: `readJson<T>(area, key, fallback, guard?)`, `writeJson(area, key, value)`,
    `removeKey(area, key)`. `area` is `'local' | 'session'`. Keys are prefixed `describe.v1.`. Every call is
    wrapped in try/catch; on failure, return the fallback or report `false`.
12. **Shell UI**
    - `App.vue`: header (product name, small tagline), `StepNav`, the current view, footer
      (`v{__APP_VERSION__} · built {__BUILD_DATE__}`).
    - `StepNav.vue`: three steps (*1 Setup · 2 Glossary · 3 Output*). They are buttons with `aria-current="step"`,
      disabled when `!canEnter`.
    - Placeholder `SetupView.vue`, `GlossaryView.vue`, `OutputView.vue`, each with an `<h1>`. Focus moves to the
      view's `<h1>` on step change.
    - `src/ui/styles/tokens.css`: system font stack, colour tokens with a light theme (dark optional), spacing
      scale, and an 8-colour speaker palette with ≥ 4.5:1 contrast on the background.
13. **Playwright:** `playwright.config.ts` with project `chromium`, `use.baseURL` unset. Specs navigate to
    `pathToFileURL(resolve('dist/describe.html')).href`. Add a helper `tests/e2e/helpers.ts` exporting
    `openApp(page)`, which also fails the test on any console error.
14. **README.md** (developer quickstart): prerequisites (Node ≥ 20), commands, a pointer to AGENTS.md and
    ROADMAP.md.

## Contracts introduced

```ts
// src/storage/local.ts
export type StorageArea = 'local' | 'session';
export function readJson<T>(area: StorageArea, key: string, fallback: T, guard?: (v: unknown) => v is T): T;
export function writeJson(area: StorageArea, key: string, value: unknown): boolean;
export function removeKey(area: StorageArea, key: string): void;
```

Store state names above are contracts. Later phases implement the actions but do not rename state.

## Acceptance criteria

- [x] `npm run build` creates `dist/describe.html` and nothing else in `dist/`.
- [ ] Double-clicking `dist/describe.html` in Edge shows the header, the 3-step nav (Glossary and Output
      disabled), the Setup placeholder and the footer version. DevTools shows no console errors and no network
      requests. *(Verified in Chromium over `file://` by Playwright and in the Claude desktop browser pane;
      the double-click in Edge is left to the maintainer.)*
- [x] The built HTML contains the CSP meta. `npm run dev` works without it.
- [x] `verify:single-file` fails if you temporarily add `<script src="https://example.com/x.js">` (check
      manually, then revert).
- [x] `typecheck`, `lint`, `test`, `test:e2e` all pass.

## Required tests

- `src/storage/local.spec.ts`: round-trip, namespacing, fallback when JSON is corrupt, fallback when `localStorage`
  throws.
- `src/stores/nav.spec.ts`: guards for each step.
- `tests/e2e/shell.e2e.ts`: the app loads from `file://`, the title is "Describe", 3 steps are visible, Glossary is
  disabled, there are no console errors, and the CSP meta exists.

## Out of scope

Any real feature logic, API calls, or styling beyond a clean, simple shell.

## Handoff

*(Implementing agent: note anything the next phases need to know, e.g. deviations, versions pinned, gotchas.)*

### 2026-10-13 — Phase 0 done (branch `phase-0-scaffold`)

**Versions installed:**
- vue 3.5.44, pinia 4.0.3
- vite 8.3.4 (Rolldown-based), @vitejs/plugin-vue 6.0.10, vite-plugin-singlefile 2.3.3
- typescript **6.0.3**, vue-tsc 3.3.13
- vitest 5.0.4, @vue/test-utils 2.5.1, happy-dom 21.0.1, @playwright/test 1.64.0
- eslint 10.12.0, typescript-eslint 8.71.2, eslint-plugin-vue 10.11.1, @vue/eslint-config-typescript 14.9.0
- prettier 3.9.10, eslint-config-prettier 10.1.8

**Bundle:** `dist/describe.html` is 76 KB (31 KB gzip), with no `eval(` or `new Function` in the output.

**Deviations from the task list:**
- **TypeScript is pinned to `~6.0`.** npm `latest` is 7.0, the Go port, but `typescript-eslint` requires `<6.1`, and
  vue-tsc needs the TS JS API. Upgrade once both support TS 7.
- **Node ≥ 22.12, not ≥ 20.** Vitest 5 and plugin-vue 6 require it. It is set in `engines` and in the README.
- **`typecheck` is `vue-tsc -b`, not `vue-tsc --noEmit`.** There are two tsconfigs via project references:
  `tsconfig.app.json` for `src/` (DOM, no Node types) and `tsconfig.node.json` for the vite/playwright configs and
  `tests/e2e`. AGENTS.md is updated.
- **Files were written by hand,** without `create-vite`.
- **e2e guard:** `tests/e2e/helpers.ts` exports a guarded `test` (an auto fixture that fails on console errors and
  page errors) plus `openApp(page)`. Specs must import `test` from `./helpers`. A spec that expects an error removes
  it from the `consoleErrors` fixture; see the CSP test in `shell.e2e.ts`.
- **Extras:**
  - `src/App.spec.ts` covers the step buttons, the footer, and focus moving to `<h1>` on a step change but not on
    the first load.
  - `src/ui/styles/tokens.spec.ts` checks every speaker and text colour reaches ≥ 4.5:1 contrast.
  - A third e2e test proves the CSP blocks `fetch('https://example.com')`.
  - `.claude/launch.json` lets the Claude desktop app start the dev server.
- **ESLint enforces AGENTS rule 4** with `no-restricted-imports`:
  - `src/domain` may not import vue, pinia, providers, storage, stores, features or ui, and may not use
    `window`/`document`/`fetch`/storage globals.
  - `src/providers` and `src/features` may not import vue, pinia, stores or ui.
- **Unused stub parameters** are prefixed `_`, which the lint config allows.

**Gotchas for later phases:**
- **Vite escapes `'` as `&#39;` in injected attributes.** `verify-single-file.mjs` decodes entities before parsing
  the CSP. Keep that in mind if you add checks.
- **Vitest blanks CSS imports, including `?raw`, unless the file is in `test.css.include`** (see `vite.config.ts`).
- **Storage failures in tests:** in happy-dom, `vi.spyOn(Storage.prototype, …)` does not intercept
  `localStorage.setItem`. Mock the `window.localStorage` getter to return a fake `Storage` instead (pattern in
  `src/storage/local.spec.ts`).
- **The nav guard opens Output only when `job.status !== 'idle'` or a doc exists.** The Phase 3 and Phase 4 task
  text now says the Run handler calls `job.start()` *before* `nav.goTo('output')`, and that `start()` sets
  `uploading` synchronously.
- **Stub signatures:** the glossary stubs already use the Phase 3 return types (`{ added, duplicates }` and the
  `updateTerm` result union). `transcript.loadAutosave()` returns `Promise<void>`.
- **Working-tree line endings:** `.gitattributes` forces LF. The machine has `core.autocrlf=true`, and Prettier
  checks for LF.

**Known and accepted:**
- **npm audit** reports 5 high-severity advisories for `braces` (a ReDoS issue) via `micromatch`/`fast-glob` in
  `vite-plugin-singlefile` and `@vue/eslint-config-typescript`. These are build-time only, and nothing ships in the
  HTML. The only fix offered is downgrading the singlefile plugin to 0.9. Revisit in Phase 8.
- **An `EBADENGINE` warning** for `nopt`/`abbrev` (via `@vue/test-utils` → `js-beautify`), which want Node 22.22+.
  The tests are unaffected on 22.19.
