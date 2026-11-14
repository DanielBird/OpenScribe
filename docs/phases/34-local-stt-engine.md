# Phase 34 — Local transcription engine

**Goal:** the desktop app can turn a recording into a `TranscriptDoc` without ElevenLabs: Rust decodes the audio and
runs the two models, and a second `TranscriptionProvider`, `local`, maps the result. In this phase the models come
from a folder named by a developer setting, and the engine is chosen by a developer switch. Downloading the models
(Phase 35) and the user's choice (Phase 36) come next. The HTML file gains nothing but a wider reader.

**Status of the plan:** drafted on 2026-11-14 with Phase 33 not yet run (DECISIONS.md **D50**). **Phase 33's
choices override this file.** Where a task says "the runtime" or "the models", it means the ones Phase 33 chose.
Don't start before Phase 33's go.

**Depends on:** Phase 33 (go, and its DECISIONS entry). Phase 35 builds on this phase.

**Read first:**
- [DECISIONS.md](../DECISIONS.md) D2, D11, D18, D35–D38, D40, T2, T3, T16–T18, D50 and Phase 33's entry;
- [reference/local-stt.md](../reference/local-stt.md) (Phase 33) and [reference/desktop.md](../reference/desktop.md);
- `src/providers/transcription/` and `src/stores/job.ts`, which this phase extends;
- Tauri 2's docs on commands, channels, raw request bodies, capabilities and
  [`tauri_build::AppManifest`](https://docs.rs/tauri-build/latest/tauri_build/struct.AppManifest.html). Don't guess
  them.

## What changes in the rules

Phase 24 kept Tauri out of `src/` and gave the web view no commands. This phase needs both, narrowly. Update
AGENTS.md and the checks with the code:

- **One module talks to Rust:** `src/providers/transcription/local/bridge.ts` is the only code in `src/` that imports
  `@tauri-apps/api`, as `storage/folder.ts` is the only code that calls the File System Access API. An ESLint
  `no-restricted-imports` rule enforces it.
- **The web build still has no Tauri code.** Everything that reaches the bridge sits behind the `__DESKTOP__`
  literal, so the web build drops it, and `verify:single-file` keeps failing if it doesn't.
- **`@tauri-apps/api` is a new runtime dependency** of the desktop build only: a DECISIONS line (AGENTS.md, *Stack*),
  and `npm run notices`.
- **The capability grants exactly this phase's commands,** and nothing from Tauri's own plugins. Declare the app's
  commands in `build.rs` (`AppManifest::commands`) so that each needs a permission; without that, Tauri allows every
  app command.
- **No new network host in this phase.** Nothing here connects anywhere, and the CSP's `ipc:` sources are already
  there. Phase 35 adds the download from Hugging Face, made by Rust, and changes hard rule 2 for it.

## Decided in this file (Phase 33 or the maintainer can change them)

1. **A second provider, not a second pipeline.** `local` implements `TranscriptionProvider` and returns a
   `NormalizedTranscription` (T3). Segmentation, the doc, autosave, playback, translation, export and projects don't
   know which engine ran.
2. **Rust returns raw results; TypeScript joins them.** Rust sends the words with their times and the speaker
   segments. `local/mapper.ts` gives each word a speaker and builds the tokens, where Vitest can test it against
   fixtures. Rust stays thin: decode, run, report.
3. **The engine ships in the app; the models don't.** The build names the model files it works with in
   `src-tauri/speech-pack/pack.json` (contract below): each file's size, hash and pinned URL. That list is
   compiled into the exe, so the app only ever loads, and Phase 35 only ever downloads, files it was built for.
   A new set of models means a new version of the app. "The speech pack" is this set of files on disk.
4. **The recording never leaves the computer.** The decoded audio and any temporary copy live in the package's
   `TemporaryFolder` (the unpackaged app: the system's temporary folder), are deleted when the run ends however it
   ends, and anything left by a crash is deleted at the next start.
5. **One run at a time,** as today. Cancel stops the engine within a few seconds and frees its memory.
6. **CPU only, on every computer.** The engine is built without any GPU backend and for the instruction sets the
   work laptop has (Phase 33's build flags), so it behaves the same on a PC with a dedicated GPU as on the laptop.
   The laptop's GPU couldn't be measured (Phase 33).
7. **Every run times itself.** The work laptop can't run a benchmark, so the app is the only thing that can measure
   it. The engine reports how long each stage took, and the app keeps the last run's figures (Task 8) for Phase 36
   to show.
8. **`provider` in a saved transcript becomes any string** (below). This is a shape change by D38 and D40, so it gets
   its own DECISIONS entry, and its timing matters: see Task 1.

## Tasks

1. **Widen the reader first** (both builds; can be a commit of its own, ahead of the rest):
   - `TranscriptionRequestInfo.provider` becomes `TranscriptionProviderId | (string & {})`-style: known ids typed,
     any non-empty string read. `TranscriptDocSchema` accepts any non-empty string where it has
     `z.literal('elevenlabs')`, as D37 did for `languageHint`.
   - Wherever the engine is shown (Output's header, the `.docx` header block, the session list if it names it), a
     known id gets its name and an unknown one is shown as it is.
   - **Why it matters:** builds with the literal report a transcript made locally as unreadable, on Output and in a
     shared project folder. 1.1.0 and 1.2.0 have the literal (D40: colleagues have neither). **The maintainer
     decides** whether this commit goes into the next release colleagues get, ahead of Phases 34–36, so that no
     build in their hands ever refuses a local transcript. Record the decision in DECISIONS.
2. **The provider contract** (`providers/transcription/types.ts`; contracts below): `id` widens; providers say
   whether they need a key, take keyterms and offer zero retention; `TranscriptionProgress` gains the local phases.
   ElevenLabs' provider declares its values and is otherwise untouched. `getTranscriptionProvider()` takes the id.
3. **Rust: decoding** (`src-tauri/src/stt/decode.rs`): any file W6 plays, to 16 kHz mono PCM, in constant memory,
   with the duration and progress. A file it can't read gives an error the provider maps to "DeScribe can't read the
   audio in this file. Try an MP3, M4A or WAV."
4. **Rust: the engine** (`src-tauri/src/stt/`): load the two models from a pack folder, run the words model in chunks
   the model can take (joins as Phase 33 found), run the speakers model over the whole recording, and report
   progress as seconds of audio done. As a worker process or in-process, as Phase 33 decided. The thread count is
   the one Phase 33 chose for the laptop, capped at the computer's own, and not "all of them": on the maintainer's
   24-thread PC it must still run as it will on the laptop. The finished run reports its timings: decoding, words,
   speakers, the total, the threads used and the engine's peak memory.
   - Keep Windows awake while a run is active, and release it when it ends (`SetThreadExecutionState` or a power
     request): a 40-minute run mustn't die because the laptop slept.
   - A fake engine for tests, chosen by an environment variable in debug builds: it returns a scripted result after
     scripted progress, so the desktop flow can be driven without models.
5. **The pack's definition and its folder:**
   - `src-tauri/speech-pack/pack.json` (committed, from Phase 33's choices): the pack's id and version, the
     languages and the speaker limit, and per model its role, file name, size, SHA-256, URL pinned to a commit,
     licence id, copyright line and model card. A Rust test checks every URL is `https://huggingface.co/…/resolve/`
     with a 40-character commit hash (or the host Phase 33 chose), so nothing unpinned can slip in.
   - `src-tauri/src/stt/pack.rs`: given a folder, check each file in the list is there with the stated size and
     hash. Hash once and remember the result by size and modified time in a small receipt file beside the models,
     not on every start. In this phase the folder comes from `DESCRIBE_SPEECH_PACK_DIR`, read in debug builds only.
     Phase 35 adds the app's own folder and the download.
   - `scripts/fetch-speech-pack.mjs` (`npm run desktop:fetch-models`): for developers. It downloads the files in
     `pack.json` into a gitignored folder and verifies them, so a debug build has something to point at. Model
     files are never committed.
6. **Rust: the commands**, and the capability that grants them. Keep the surface small: status; start a run and take
   the recording (by whichever route Phase 33 chose); events on a channel (preparing, progress, done, failed);
   cancel. Errors are a kind and a detail, never a path outside the pack or the temporary folder. Register nothing
   else.
7. **`src/providers/transcription/local/`:**
   - `bridge.ts`: the typed calls and the channel, with zod schemas for everything that comes back (hard rule 6:
     nothing from Rust is trusted as typed);
   - `mapper.ts`: words and speaker segments to `NormalizedToken`s. Each word goes to the speaker with the most
     overlap, or the nearest segment if none overlaps; a lone word between two words of another speaker follows
     them (tune against Phase 33's recordings). Spacing tokens between words, as the ElevenLabs mapper produces, so
     segmentation behaves the same. `speaker_0…` in order of first appearance. `logprob` from the confidence if
     there is one, else `null`;
   - `limits.ts`, `languages.ts`: from the pack's definition, through the bridge's status;
   - `errors.ts`: every failure as a `ProviderError` with a message that says what to do (pack missing or damaged,
     unreadable audio, out of memory, the CPU can't run it, cancelled), technical detail behind D41's disclosure;
   - `provider.ts`: `createLocalProvider(bridge)`; the bridge is injected, so specs use a fake.
8. **The job store:** `snapshot()` asks for the provider by id and skips the key for one that needs none. The local
   phases map to statuses the UI can show (Phase 36 words them; here, reuse the processing state with the progress
   numbers exposed). Retry, Cancel and the unload guard work as for ElevenLabs. The request info records the pack id
   as `model`, `zeroRetention: false` and `keyterms: []`. The store keeps the last local run's timings (in memory
   and in a pref, so they survive a restart); they don't go into `TranscriptDoc`.
9. **The developer switch:** until Phase 36, the engine is chosen by a pref with no UI (`transcriptionEngine`), set
   from DevTools in a debug build. Default `elevenlabs`. A new optional pref with a default isn't a shape change
   (D18).
10. **Closing the window during a run.** reference/desktop.md suspects the `beforeunload` guard doesn't stop the
    window closing. Check it. If it doesn't, make closing ask first while a run is active, in the smallest way that
    works for ElevenLabs runs too, and record it (the same note asks for it under *Input for Phase 25*).
11. **Notices and checks:** `npm run notices` covers the runtime's native libraries, which `cargo metadata` doesn't
    see (a PREBUNDLED-style entry with the checked version, D36). `verify:single-file` still passes. Record the
    main MSIX's new size, and run the Windows App Certification Kit on it.
12. **Docs:** AGENTS.md (Stack, hard rules 1 and 4, the layering list); ROADMAP §5 (folder layout, data flow) and §6
    (the model's `provider`); reference/desktop.md (commands, capability, the checklist rows below);
    reference/local-stt.md (what was built, against what Phase 33 measured); DECISIONS.

## Contracts introduced

```ts
// domain/transcript.ts
export type TranscriptionProviderId = 'elevenlabs' | 'local';
// TranscriptionRequestInfo.provider: a TranscriptionProviderId, or a string a newer build wrote.

// providers/transcription/types.ts
export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId;
  readonly model: string;               // local: the pack's id
  readonly needsKey: boolean;
  readonly supports: { keyterms: boolean; zeroRetention: boolean };
  // limits, languages, transcribe, verifyKey: as today
}

export type TranscriptionProgress =
  | { phase: 'uploading'; loaded: number; total: number }
  | { phase: 'processing' }
  | { phase: 'preparing' }                                            // local: reading the recording
  | { phase: 'transcribing'; doneSec: number; totalSec: number | null }; // local

// providers/transcription/local/bridge.ts
export type LocalSttStatus =
  | { state: 'ready'; pack: SpeechPackInfo }
  | { state: 'missing'; pack: SpeechPackInfo }   // nothing on disk yet; the pack says what a download would fetch
  | { state: 'unusable'; pack: SpeechPackInfo; reason: 'damaged' | 'outdated' | 'cpu' };
// 'outdated': the files on disk belong to another version of the app. Phase 35 adds a 'downloading' state.

export interface SpeechPackInfo {
  id: string;            // e.g. 'nvidia-parakeet-nemotron-1'
  version: string;
  languages: string[];   // normalizeLanguage() codes
  maxSpeakers: number;
  downloadBytes: number; // the files' total size
}

export interface LocalSttResult {
  language: string | null;   // null if the model doesn't report one
  durationSec: number;
  words: { text: string; start: number; end: number; confidence: number | null }[];
  speakerSegments: { speaker: number; start: number; end: number }[];
  timings: LocalSttTimings;
}

/** How long the run took on this computer: the only measurement the work laptop can give (Phase 33). */
export interface LocalSttTimings {
  decodeSec: number;
  wordsSec: number;
  speakersSec: number;
  totalSec: number;
  threads: number;
  peakMemoryBytes: number | null;
}

export interface LocalSttBridge {
  status(): Promise<LocalSttStatus>;
  transcribe(
    file: File,
    options: { languageHint: string; numSpeakers: number | null },
    opts: { signal: AbortSignal; onProgress: (p: TranscriptionProgress) => void },
  ): Promise<LocalSttResult>;
}
```

```jsonc
// src-tauri/speech-pack/pack.json: committed, and compiled into the exe. The only list of model files there is.
{
  "id": "nvidia-parakeet-nemotron-1",
  "version": "1.0.0",
  "languages": ["bg", "hr", "…"],
  "maxSpeakers": 8,
  "models": [
    { "role": "words", "file": "….gguf", "bytes": 0, "sha256": "…",
      "url": "https://huggingface.co/<repo>/resolve/<commit>/<file>",
      "name": "NVIDIA Parakeet TDT 0.6B v3", "card": "https://huggingface.co/nvidia/…",
      "licence": "CC-BY-4.0", "copyright": "© NVIDIA Corporation", "changes": null },
    { "role": "speakers", "file": "….gguf", "bytes": 0, "sha256": "…",
      "url": "https://huggingface.co/<repo>/resolve/<commit>/<file>",
      "name": "NVIDIA Nemotron 3 Diarization", "card": "https://huggingface.co/nvidia/…",
      "licence": "OpenMDW-1.1", "copyright": "© NVIDIA Corporation", "changes": null }
  ]
}
// "changes": null for the publisher's own file; else what was done to it ("converted to GGUF, 8-bit").
```

- Files: `src-tauri/src/stt/`, `src-tauri/speech-pack/pack.json`, `src/providers/transcription/local/`,
  `scripts/fetch-speech-pack.mjs`, the capability's permissions.
- npm script: `desktop:fetch-models`.
- A pref: `transcriptionEngine` (`'elevenlabs'` by default).

## Acceptance criteria

- [ ] In a debug desktop build with `DESCRIBE_SPEECH_PACK_DIR` set and the pref on `local`, a recording becomes a
      transcript with speakers and word times, with no request to `api.elevenlabs.io` and no ElevenLabs key. Playback,
      rename, edit, translate, export and Add to project work on it.
- [ ] Progress moves during the run. Cancel stops it within a few seconds; the process's memory returns to where it
      was; the temporary files are gone. Try again works.
- [ ] In Phase 33's *Laptop* profile (the app started pinned to the same twelve logical processors, which its
      worker inherits, with the emulation power scheme active), a one-hour and a three-hour recording finish within
      Phase 33's emulated thresholds, with word times that still match at the end. The app's own timings agree with
      the harness's for the same recording to within 15 %; a bigger gap is explained or fixed. Unpinned timings on
      this PC prove nothing about the laptop and aren't recorded as if they did.
- [ ] Neither GPU is used during a run, and the engine has no GPU backend in it.
- [ ] Each failure shows its own message: no models, damaged models, models from another version of the app,
      unreadable audio, a crash of the engine. None leaves a temporary file or a stuck job.
- [ ] Closing the window during a run asks first.
- [ ] The web build has no Tauri code and no engine choice, and reads a transcript whose `provider` is `local`: on
      Output, in the export and in a project folder.
- [ ] The capability grants only this phase's commands; a call to any other is refused.
- [ ] The Definition of Done in AGENTS.md. `cargo test` passes. The main MSIX's size and the certification kit's
      result are recorded.

## Required tests

- **Vitest:** `mapper.ts` (overlap, no overlap, a lone word, overlapping speech, no speakers at all, order of first
  appearance, words out of order or with bad times, a 25k-word result in reasonable time); `provider.ts` with a fake
  bridge (progress, cancel, every error kind, nothing secret in errors); the bridge's schemas against malformed
  replies; the job store with a provider that needs no key; `TranscriptDocSchema` with `provider: 'local'` and with
  an unknown provider; the header and export naming the engine.
- **Rust (`cargo test`):** the pack's definition (every URL pinned) and its folder (valid, a missing file, a wrong
  size, a wrong hash, the receipt reused and invalidated); decoding the test
  WAV to 16 kHz mono with the right length; cleaning up the temporary folder; the fake engine's events.
- **E2E (web build):** the existing suite unchanged, plus one spec that loads a saved transcript with
  `provider: 'local'` and exports it.
- **Desktop, by hand** (rows for reference/desktop.md's checklist; the agent's rows over CDP with the fake engine,
  as in Phase 24): a real run per language; cancel; each failure; a one-hour and a three-hour run in the *Laptop*
  profile; closing mid-run; the capability. All on the maintainer's PC.
- **No real ElevenLabs, Claude or Gemini calls.** The models run locally, so real local runs are fine.

## Out of scope

- Downloading the models, and where the app keeps them: Phase 35.
- The choice on Setup, the wording of progress, Settings and About: Phase 36.
- Using the glossary locally; live transcription; any GPU; ARM64.
- Any development build on the work laptop. Its first run there is Phase 36's, from the Store.
- Replacing the web view's file handling, folders or keys with native ones (Phase 25's list in
  reference/desktop.md), beyond what Phase 33 chose for getting the recording to Rust.

## Handoff

*(What Phase 33 changed in this plan, the commands as built, sizes and timings, and what Phases 35 and 36 need.)*
