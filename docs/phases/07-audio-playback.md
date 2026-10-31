# Phase 7 — Audio playback (click a turn to listen)

**Goal:** Clicking a turn's timestamp (or the turn) plays the recording from that moment. The turn being played is
highlighted, and the view can optionally follow along. After a reload, the user can re-attach the audio file to
get playback back.

**Depends on:** Phase 4.

**Read first:** [DECISIONS.md](../DECISIONS.md) D10, [reference/elevenlabs-stt.md](../reference/elevenlabs-stt.md)
V6 (formats Chromium can't play).

## Tasks

1. **`src/domain/playback.ts`:** `findActiveTurnIndex(turns, t)`. A binary search for the last turn with
   `start <= t`. Returns `-1` before the first turn. A turn stays active through any gap until the next turn
   starts.
2. **`stores/playback.ts`**
   - `audioUrl` (object URL), `sourceMatch: 'same-run' | 'matched' | 'mismatch' | null`, `currentTime`,
     `playing`, `activeTurnId`, `followPlayback` (pref, persisted, default `true`), `playbackError`.
   - `attachFromRunFile(file)` is called by the job store on success (the File is still in the settings store).
   - `attachManual(file)` compares against `doc.source`:
     - Name and size equal → `matched`.
     - Otherwise → confirm *"This file doesn't match the transcript's source (name/size differ). Use it anyway?"*
       → `mismatch`.
   - `seekTo(sec, autoplay = true)`.
   - Revoke the old object URL whenever it is replaced, and on new runs.
   - `audioEl` is held in the store via `registerAudioElement(el)`, so seeks come from anywhere.
3. **`AudioBar.vue`** (sticky at the bottom of the Output tab)
   - A native `<audio controls preload="metadata">`, which is accessible, robust and keyboard friendly.
   - The current speaker and timestamp label.
   - A **Follow playback** toggle.
   - With no audio: *"Attach the recording to listen along"* and a compact file picker (reuses `FileDrop` logic in
     `compact` mode).
   - On the media `error` event: *"This file format can't be played in the browser. The transcript is not
     affected."* Keep the bar visible so the user can attach a converted copy.
   - `timeupdate` → `currentTime` → `activeTurnId`. While playing, use `requestAnimationFrame` (throttled to 10 Hz)
     for smoother highlighting.
4. **`TurnItem` / `TurnList` integration**
   - The timestamp button calls `playback.seekTo(turn.start)`. Clicking the turn text does the same, unless the
     user is selecting text (check `window.getSelection()?.isCollapsed`).
   - The active turn gets the `is-active` class (left border in the speaker colour and a tinted background) and
     `aria-current="true"`.
   - When `followPlayback` is on and the active turn changes, call `scrollIntoView({ block: 'nearest', behavior:
     'smooth' })`. If the user scrolls with the wheel or touch, pause following until the next turn click.
5. **Keyboard:** Space or `K` toggles play/pause when focus is not in an input, textarea, select or button.
   Alt+← / Alt+→ skips to the previous or next turn. Show a small "Keyboard shortcuts" hint in the AudioBar.
6. **Video sources:** use the same `<audio>` element; Chromium plays the audio track of mp4, webm and mov (H.264/AAC).
   Document any exceptions found under V6.
7. **Extend `scripts/make-test-audio.mjs`** (created in Phase 2) so it also writes `fixtures/audio/tone-12s.wav`
   (a 16 kHz mono PCM tone with a pitch change every 3 s), plus a hand-written matching
   `fixtures/elevenlabs/tone-12s.json` with turns at 0, 3, 6 and 9 s.

## Contracts introduced

```ts
// src/domain/playback.ts
export function findActiveTurnIndex(turns: Pick<Turn, 'start'>[], t: number): number;

// stores/playback.ts (public surface)
audioUrl, sourceMatch, currentTime, playing, activeTurnId, followPlayback, playbackError,
registerAudioElement(el: HTMLAudioElement | null): void,
attachFromRunFile(file: File): void, attachManual(file: File): Promise<void>,
seekTo(sec: number, autoplay?: boolean): void, togglePlay(): void, nextTurn(): void, prevTurn(): void
```

## Acceptance criteria

- [x] After a (mocked) run with `tone-12s.wav`, clicking the turn at `[00:00:06]` sets `audio.currentTime` to
      about 6 and starts playback. That turn is highlighted.
- [x] As playback runs, the highlight moves to the next turn at about 9 s. With Follow on, the list scrolls to it.
- [x] After a reload (no audio), the bar offers **Attach**. Attaching the same file → `matched`, and playback works.
      Attaching a different file → confirmation, and `mismatch` is indicated in the bar.
- [x] An unplayable file shows the format message and does not throw errors.
- [x] The keyboard shortcuts work and don't interfere with typing in the speaker inputs. (Space/K only:
      Alt+←/→ was dropped, see the Handoff.)
- [x] No object URL leaks: replacing the file revokes the previous URL (asserted in a test with a mock
      `URL.revokeObjectURL`).

## Required tests

- `domain/playback.spec.ts`: before first, exact boundaries, gaps, after last, a single turn, empty.
- `stores/playback.spec.ts`: match logic, URL lifecycle, follow-pause on manual scroll.
- `tests/e2e/playback.e2e.ts`: click → currentTime ≈ start (within 0.3 s); highlight; re-attach after reload.
  (Use `page.evaluate` to read `audio.currentTime`. Headless Chromium can play WAV; mute via
  `audio.muted = true` in the test.)

## Out of scope

A waveform view, playback speed controls beyond the native ones, word-level highlighting (a possible future
improvement using `turn.words`).

## Handoff

*(Notes, V6 findings.)*

### 2026-10-13 — Phase 7 done (branch `phase-7-audio-playback`, based on `main` at `8e2f1bf`)

**Scope change (with the maintainer): no Alt+← / Alt+→.** Alt+← is the browser's Back, so turn skipping was
dropped. Only Space / K play and pause; `nextTurn()` and `prevTurn()` don't exist. If skipping comes back, use keys
that don't clash (e.g. J / L).

**Contract changes**
- `attachManual(file, confirmMismatch: () => Promise<boolean>): Promise<boolean>`. The confirmation is passed in
  because `useConfirm` is component-scoped (AudioBar renders the dialog). It resolves whether the file was attached,
  and attaches nothing if the transcript was replaced while the user decided.
- **The URL is dropped when a different doc replaces the transcript, not when a run starts.** A failed or cancelled
  run that is dismissed shows the old transcript again, and its audio still works. A translation or a rename keeps
  the doc id and so the audio. A replaced URL is revoked after `nextTick`, once the `<audio>` element has the new
  `src`.
- Store additions: `playable` (audio attached and no format error) and `followPaused`. `activeTurnId` is `null`
  until the recording has been played or sought, so no turn is highlighted on arrival.
- `followPlayback` is stored in the settings prefs (`describe.v1.prefs`, default `true`); the playback store
  re-exposes it with `toRef`.
- Follow pauses on `wheel` / `touchmove` **while playing**, and resumes on the next turn click or `play`.
- Back on the Output tab, the re-registered element continues from the stored `currentTime`.
- `FileDrop`: all props are optional now, plus `compact`, `prompt` and `chooseLabel`.
- `TurnList`: new props `activeId` and `follow`. `TurnItem`: `active`, `data-turn-id`, and a text click that plays
  (when `playable`, and not at the end of a text selection). Follow uses `scrollIntoView({ block: 'nearest' })`,
  `auto` under reduced motion; `.turn` has an 8rem bottom scroll margin, so the turn isn't hidden by the bar.
- `play()` rejections are always caught. `NotSupportedError` shows the format message (Chrome rejects HEVC that
  way without an `error` event, V6); `NotAllowedError` is ignored.

**UI text trimmed (D13)**
- No separate timestamp label in the bar: the native controls already show the time. The bar shows the active
  speaker's name in their colour.
- Mismatch confirm: title "Use this recording?", message `It doesn't match the transcript's recording
  ("<file>").`, confirm "Use it". Once attached, one muted line: "Not the transcript's recording."
- "Choose another file…" appears only after a format error or a mismatch.
- **Exception to D13 (maintainer's call):** the shortcut is always shown as "Space: play or pause" next to Follow
  playback, not behind a "Keyboard shortcuts" disclosure. K still plays and pauses but isn't listed.

**Fixtures:** `tone-12s.json` is generated by `make-elevenlabs-fixtures.mjs` (AGENTS.md: edit the script), not
hand-written as task 7 said. `make-test-audio.mjs` now writes `[seconds, frequency]` segments; `tone-5s.wav` came
out byte-identical. E2E helpers: `TONE_12S_WAV`; `goToGlossary(page, recording?, duration?)`.

**V6** (details in the reference doc): every common audio and video format plays; wma, wmv, avi and aiff don't.
**For Phase 8:** in Chrome, AC-3 audio in an mp4 plays with no sound and no error. A check that
`webkitAudioDecodedByteCount` stays at 0 while `currentTime` advances could show the format message; not done here.

**Testing notes**
- Vitest under happy-dom does **not** fail on unhandled rejections, and a `vi.fn` that returns a promise attaches
  its own handler (settled results). The play-rejection tests therefore use a plain function and listen for
  `process` `unhandledRejection`.
- Playwright's Chromium plays WAV and H.264/AAC; the e2e tests mute the element before playing.

**Checks**
- Mutation spot checks, 9/9 caught: no revoke on replace; URL kept after a new doc; unhandled `play()` rejection;
  Space handled inside an input; follow not paused on wheel; `findActiveTurnIndex` with `<`; active state missing
  from `v-memo`; job not attaching the run file; text click ignoring a selection.
- Browser (dev server, seeded 30-turn doc and a generated 90 s WAV): the highlight moves, Follow keeps the active
  turn above the bar, no horizontal scroll at 375 px (the bar wraps to 94 px), no console errors.

**Tests:** 735 unit tests (up from 649) and 41 e2e tests (up from 35), plus typecheck, lint, build and
`verify:single-file`. New: `domain/playback`, `stores/playback`, `AudioBar` specs and `playback.e2e.ts` (6 tests);
additions to the `job`, `settings`, `FileDrop`, `TurnList` and `OutputView` specs.
**Bundle:** 1,236.5 → 1,244.6 KB.
