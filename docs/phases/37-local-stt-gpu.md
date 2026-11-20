# Phase 37 — Transcribing on the graphics card

**Goal:** in the desktop app, a colleague whose computer has a graphics card can choose in Settings to run the speech
models on it instead of the processor. The processor stays the default and works as it does today. A run that fails
on the graphics card says so and offers the processor. The HTML file doesn't change.

**Status of the plan:** researched on 2026-11-19, and planned on 2026-11-20 from the maintainer's answers (DECISIONS.md
**D58**). The research is kept below the tasks, since the tasks rely on it. All UI text here is a draft (D13).

**Depends on:** Phases 34–36 (built). Not on the work laptop: its run (G9) can happen whenever the maintainer next has
the Store build on it, and gates nothing (D58, as D55 did for the processor).

**Read first:**
- DECISIONS.md D13, D41, D50, D51, D53, D54, D55, D56 and **D58**;
- [reference/local-stt.md](../reference/local-stt.md) and [reference/desktop.md](../reference/desktop.md) (*Transcribing
  on this computer*, the E and L rows);
- `src-tauri/src/stt/nemo.rs`, `run.rs`, `worker.rs`, `commands.rs`, `protocol.rs`, `error.rs`;
  `scripts/build-stt-runtime.ps1`, `src-tauri/stt-runtime.json`, `scripts/pack-desktop.mjs`, `scripts/make-notices.mjs`;
- `src/providers/transcription/local/` (`bridge.ts`, `errors.ts`, `provider.ts`), `src/stores/settings.ts`,
  `src/stores/job.ts`, `src/ui/components/SpeechPackSection.vue`, `src/ui/components/JobStatus.vue`.

## What the maintainer decided (2026-11-20)

The answers to the planning questions, recorded in D58.

1. **Any graphics card, the work laptop first.** Vulkan, so AMD, Intel and NVIDIA alike. The work laptop's Radeon 740M
   is the one the phase is measured on; other cards get it without being tuned for.
2. **It ships whatever the laptop's speed.** Whether the graphics card is faster than the processor on a given
   computer is the user's to find out. The app doesn't measure it, recommend one, or hide a slow card.
3. **The user chooses, in Settings, once.** Settings' *Transcribe on this computer* band asks where to run. Setup stays
   as it is (ElevenLabs or This computer).
4. **The processor is the default,** whenever a graphics card is found.
5. **Each graphics card is listed by name,** as its driver names it, beside **Processor**.
6. **Both models run on the chosen card,** the words and the speakers.
7. **A failure on the graphics card says so and offers the processor:** the run stops with a message naming the card
   and a button that runs it again on the processor. The setting stays as it is.
8. **A few words differing from the processor's transcript is fine.** No accuracy measurement is needed.
9. **Size matters little.** D50's limit of 40 MB more in the MSIX is lifted for this.
10. **NeMo-Speech.cpp stays at v0.3.0,** for both engines.
11. **The agent may install the LunarG Vulkan SDK** (winget) on the maintainer's PC, and **run NVIDIA's prebuilt v0.3.0
    Vulkan release** there for Task 1.

## Decided in this file (the maintainer can change them)

1. **Two engines, side by side.** The processor engine stays exactly as Phases 33–36 built it, beside `describe.exe`.
   A second build of the same source with `-Backend vulkan` goes in a `vulkan\` folder beside it, with its own MSVC
   and OpenMP runtimes.
   - **Why:** a Vulkan build makes `ggml.dll` import `ggml-vulkan.dll`, which imports `vulkan-1.dll`. On a computer
     without a Vulkan loader the whole engine would fail to load, the processor included (research, *Loading the
     engine*). A Vulkan build also uses stock ggml, not NVIDIA's patched ggml, so its processor path isn't the one
     measured. Two folders keep the processor engine byte for byte, at a cost of about 7 MB of duplicated DLLs.
   - A worker loads **one** engine per process, so the two sets of DLLs with the same names never meet.
2. **Finding the graphics cards.** A new worker mode, `describe.exe --stt-worker --devices`, loads the Vulkan engine's
   `ggml.dll` and lists ggml's devices of type GPU or integrated GPU: for each, its description (the name shown, such
   as "AMD Radeon 740M Graphics"), its type and its memory. It prints one JSON line and exits.
   - It runs as a process, so a driver that crashes or hangs while listing can't take the app with it. Rust ends it
     after 15 s.
   - If the Vulkan engine can't load (no `vulkan-1.dll`), or lists nothing, the list is empty. Software renderers
     (ggml's CPU-type devices) are left out.
   - A new command, `stt_devices`, runs it and returns the list. Settings calls it when the band shows *ready*. Nothing
     calls it at launch.
3. **What is saved.** A new optional pref, `localDevice`: `'cpu'`, or the card's description and which of the cards
   with that description it is (`{ name, nth }`, nth from 0), since ggml's index can change and two identical cards
   are rare. Missing or unreadable reads as `'cpu'`. A new optional pref, so D18 doesn't apply (as D56's
   `languageAutoReplaced`).
4. **Settings shows the choice only when it is one** (D13, as D56's Setup choice): with the models *ready* and at least
   one card found. A radio group, **Run on**: **Processor**, then each card by its description. If the saved card
   isn't in the list (a laptop undocked from its card, a driver removed), **Processor** is checked and the saved
   choice is kept, so it comes back with the card. No message.
5. **A run on a card.** The page passes the saved choice to `stt_start`. Rust starts a worker on the Vulkan engine
   with it in the job. The worker finds the card among ggml's devices and passes its index (counted over GPU and
   integrated-GPU devices, as `backend.cpp` counts) to both models' `gpu` field.
   - **If the card isn't there,** the worker says so before any work (a new event, `device-missing`), and Rust runs
     the same job on the processor engine at once. The run's record says it ran on the processor, and which card it
     didn't use and why (audit GPU-3). No message, as in decision 4.
   - **If listing the cards hangs** (audit GPU-2), the worker has 15 s, as the probe has, to say `device-found` or
     `device-missing`. After that Rust ends it without waiting for it and runs the job on the processor. Until the app
     restarts, runs are then on the processor and Settings lists no cards.
6. **A failure on the card** is a new error kind, `gpu`: a model's failure, out-of-memory included, in a run on a
   card, and a worker that dies during one (a driver reset ends it). Its detail is the engine's message, as today.
   The decoder's and the app's own failures keep their kind (audit GPU-1).
   - The message: "The graphics card (AMD Radeon 740M Graphics) stopped while transcribing." with **Try again** and
     **Try on the processor**. The second runs the same job once on the processor; `localDevice` doesn't change.
   - The message is the same whatever the cause. Technical details tell them apart (D41).
7. **Settings' last run says where it ran.** The Timings row **Threads** becomes **Ran on**: "Processor (8 threads)" or
   the card's description. The last run's record (`job.lastLocalRun`) gains an optional `device`; a record without one
   reads as the processor.
8. **Words and speakers on one card at once.** The worker keeps its two model threads. If Task 3 finds that two ggml
   Vulkan backends on one device can't be used from two threads at once, the worker serialises the two models' calls
   with a lock, and the Handoff records it.
9. **Settings for the engine:** `GGML_VK_DISABLE_GRAPH_OPTIMIZE` is the runtime's own. `GGML_VK_PREFER_HOST_MEMORY`
   is set for integrated cards only if Task 1 or Task 3 finds that a model doesn't load without it.
10. **Nothing in the transcript.** `TranscriptDoc` doesn't record the device: it would be a shape change (D38) for a
    detail the user already sees in Settings.
11. **Nothing changes on Setup, Glossary, Output** (apart from decision 6's button) **or in the HTML file.** Progress, the
    time left and Cancel work as today.

## Tasks

1. **The first check, on the maintainer's PC, before any app code** (decision 11 above).
   - Install the LunarG Vulkan SDK with winget (`KhronosGroup.VulkanSDK`); record its version in local-stt.md's
     Prerequisites.
   - Download `nemo-speech-0.3.0-windows-x86_64-vulkan.zip` from NVIDIA's GitHub release into a new folder under
     `scripts/spikes/local-stt/vendor/` (gitignored), and check it against the release's `.sha256`.
   - `nemo-speech --json doctor`: the devices it lists. Then `transcribe` with both model paths (`.speech-pack/`),
     `v3-offline`, `NEMO_SPEECH_TIMING=1`, on the 5-minute and the 37-minute test files, on the RTX 2070 SUPER
     (`--gpu 0`) and the UHD 770 (its index), and on the processor for comparison. Not pinned and not capped: this
     measures the cards, not the laptop.
   - Record for each: the time and its stages (encoder against decoder especially), load time cold and warm, peak
     working set, the GPU's dedicated and shared memory (`GPU Process Memory(*)`), GPU use (`GPU Engine(*)`), and
     whether the transcript reads as the processor's does.
   - `dumpbin /dependents` on the zip's `ggml.dll` and `ggml-vulkan.dll`: confirm the import chain decision 1 rests on.
     `dumpbin /exports ggml.dll`: confirm `ggml_backend_dev_count`, `_get`, `_type`, `_description` and `_memory` are
     exported (decision 2).
   - **Stop and tell the maintainer** if neither card transcribes (a crash, no device, or text that isn't a
     transcript). Slowness is not a reason to stop (D58).
2. **The Vulkan engine build.**
   - `stt-runtime.json` gains a second build: `-Backend vulkan`, the same commit, `GGML_NATIVE` off and the same CPU
     flags, `NEMO_SPEECH_GGML_PATCHED=OFF` as NVIDIA's driver sets, its engine files (`ggml-vulkan.dll` added) and the
     SDK version it was built with.
   - `build-stt-runtime.ps1` builds both into `src-tauri/stt-runtime/` and `src-tauri/stt-runtime/vulkan/`, each with
     the MSVC and OpenMP runtimes and its own `built.json`. The check that refuses `GGML_VULKAN` and `GGML_CUDA` stays
     for the processor build; the Vulkan build must have `GGML_VULKAN` on and `GGML_CUDA` off. It needs `VULKAN_SDK`
     and says so when it's missing.
   - `-From` still works for each build.
3. **The worker.**
   - `nemo.rs`: `Words::load` and `Speakers::load` take the `gpu` index (`-1` for the processor, as now). The device
     functions from `ggml.dll` (decision 2), loaded with the engine.
   - `protocol.rs`: `Job` gains an optional `device` (`{ name, nth }`; absent is the processor), so old jobs still
     read. A `devices` line for the probe. `device-missing` as an event. `Timings` gains `device` (the name, or none).
   - `worker.rs`/`run.rs`: the `--devices` mode; a run on a card resolves the index and fails with `device-missing`
     when it can't; `threads` stays the processor's count and is reported only for the processor.
   - Check, with a source build and the real models on both of the PC's cards: both models at once on one card from
     two threads (decision 8), cancel during a run frees the card at once, a 1-hour run.
   - `cpu.rs`: the AVX2 check is unchanged; both engines need it.
4. **Rust's commands.**
   - `runtime_dir()` finds both engines (beside the exe, and `vulkan\` under it; in a debug build the same under
     `DESCRIBE_STT_RUNTIME_DIR` or `src-tauri/stt-runtime/`).
   - `stt_devices` (decision 2), listed in `COMMANDS`, `build.rs` and the capability like the others. It returns an
     empty list when there's no Vulkan engine.
   - `stt_start` takes the device; on `device-missing` it starts a processor worker with the same job (decision 5); a
     crash in a run on a card becomes `gpu`, and the worker gives `gpu` itself for the models' failures (decision 6).
     `LocalSttTimings` gains `device`.
   - **Debug switches** (release builds ignore them): `DESCRIBE_STT_FAKE_DEVICES=<json>` returns a made-up list, and
     the fake engine's script can fail with `gpu`, so the UI can be checked over CDP without a card.
     `DESCRIBE_STT_PRETEND_NO_GPU=1` returns none.
5. **The page.**
   - `bridge.ts`: `devices()` with its zod schema; `transcribe` passes the device; `gpu` in `LOCAL_ERROR_KINDS`; the
     timings' `device`.
   - `settings.ts`: `localDevice` (decision 3), the device in use (decision 4), the list from the bridge.
   - `SpeechPackSection.vue`: the **Run on** group (real radios in a `<fieldset>` with a `<legend>`), shown as decision
     4 says; the **Ran on** row (decision 7).
   - `errors.ts`: the `gpu` message with the card's name. `ProviderError`'s options gain `retryOn: 'processor'`;
     `JobStatus.vue` shows **Try on the processor** beside **Try again** for it, and `job.ts` runs the same job once
     with the processor.
   - `job.ts`: `lastLocalRun` keeps the device.
   - Nothing reaches the web build: `verify:single-file` still finds none of the local engine's markers.
6. **Packing and notices.**
   - `pack-desktop.mjs` stages the `vulkan\` folder as it stages the processor engine (sizes and hashes from its
     `built.json`), and records the MSIX's size before and after in desktop.md.
   - `make-notices.mjs`: the Vulkan engine's files in the desktop notices. ggml-vulkan is ggml's (MIT); check what the
     Vulkan SDK's headers compiled into it need (Vulkan-Hpp and SPIRV-Headers' licences), and add them.
   - The MSIX manifest, the capability's other permissions and the CSP don't change.
7. **Docs.**
   - AGENTS.md: the Desktop row of the stack table, and the `desktop:stt-runtime` command (two builds, the Vulkan SDK).
   - local-stt.md: Prerequisites (the Vulkan SDK), *As built (Phase 37)* with Task 1's and Task 3's numbers, and the
     G9 laptop table. desktop.md: the commands, the debug switches, the G rows below, and E7 reworded ("No GPU used
     with Processor chosen").
   - DECISIONS.md: D58 completed with what the build found.
   - USER_GUIDE.md: the **Run on** choice and what to do when the card fails. PRIVACY.md: nothing changes (nothing
     leaves the computer).
   - ROADMAP: §5's layout (the `vulkan\` engine), §2's scope line, the table.

## The checklist (reference/desktop.md)

On the maintainer's PC with the development-signed app (G1–G8, G10) and on the work laptop with the app from the Store
(G1, G2, G4, G9). The agent's rows over CDP with the fake devices and engine where a card isn't needed.

| ID | Check |
|---|---|
| G1 | With the models ready: Settings shows **Run on** with **Processor** checked and each card by name (the PC: the RTX 2070 SUPER and the UHD 770; the laptop: the Radeon 740M). The choice survives a restart. Without the models: no group. |
| G2 | A 5-minute recording on each card: a transcript with speakers; Timings says **Ran on** the card; Task Manager shows the card busy and the processor mostly free. |
| G3 | **Processor** chosen: the run is as before (E7's GPU 0.0 %), Timings says "Processor (8 threads)". |
| G4 | Cancel during a run on a card: it stops at once, and the next run starts normally. Closing the window during one asks first, as today. |
| G5 | A failure on the card (the fake engine's `gpu` script): the message names the card; **Try on the processor** runs it on the processor; Settings still says the card. Screen reader: the message is announced, both buttons reachable. |
| G6 | The saved card gone (`DESCRIBE_STT_FAKE_DEVICES` without it): Settings checks **Processor**; a run uses the processor without a message; the card back, the choice is back. |
| G7 | No Vulkan (`DESCRIBE_STT_PRETEND_NO_GPU=1`): no group; runs as before. |
| G8 | A 1-hour recording on the RTX 2070 SUPER and on the UHD 770: times, peak memory, the cards' memory. Recorded in local-stt.md. |
| G9 | **The work laptop** (the maintainer, the Store build): Phase 36's L9 recordings on the Radeon 740M, plugged in and on battery, and the 1-hour one during a Teams call; Settings' Timings for each, beside L9's processor numbers. Measured, not a gate (D58). |
| G10 | The MSIX: its size before and after, both engines inside, the Windows App Certification Kit passes. |

## Acceptance criteria

- [x] Task 1's numbers and checks are in local-stt.md, and neither card failed to transcribe (or the maintainer was told
      and decided).
- [x] On a computer with a Vulkan card and the models ready, Settings offers **Processor** and each card; a recording
      transcribed on a card has words and speakers like the processor's, and Timings names the card.
- [x] With **Processor** chosen, without a card, or without Vulkan, transcribing works exactly as before, on the same
      engine files.
- [x] A failure on a card names it and offers **Try on the processor**, which works; the setting is unchanged.
- [x] A saved card that's gone falls back to the processor without a message, and comes back with the card.
- [x] Both models run on the chosen card.
- [x] The HTML file is unchanged; `verify:single-file` passes.
- [ ] New UI reviewed against D13, and for keyboard and screen-reader use. *D13: Task 5's texts. The keyboard: real
      radios in a `<fieldset>` and real buttons, not tried by hand. The screen reader (G5): the maintainer.*
- [x] G1–G10 have results, or *not run* with a reason (G9 doesn't gate the phase).
- [ ] The Definition of Done in AGENTS.md.

## Required tests

- **cargo:** a job without `device` reads as the processor's; the `devices` line and `device-missing` round-trip;
  resolving `{ name, nth }` to ggml's index (two identical cards, a missing one, CPU-type devices left out); a failure
  in a run on a card becomes `gpu`, and on the processor stays as now; `device-missing` restarts on the processor;
  `runtime_dir` finds both engines; `stt_devices` with no Vulkan engine returns an empty list; the command list
  matches `build.rs`. Opt-in (`--ignored`): `tone-5s.wav` transcribed on GPU 0 through the Vulkan engine, and
  `model_paths_with_non_ascii_letters_load` on it too.
- **Vitest:** the bridge's schemas for devices, the device on start and `gpu`; the settings store (`localDevice`
  default, a missing card, an unreadable pref); `SpeechPackSection` (the group only when ready with a card, the
  checked radio, **Ran on**); `JobStatus` and `job.ts` (**Try on the processor**, running once on the processor,
  `lastLocalRun.device`); `errors.ts`'s `gpu` message.
- **E2E (web build):** the existing suite unchanged.
- **Desktop:** G1–G10.
- **No real API calls** unless the maintainer asks for them in the session (CLAUDE.md).

## Out of scope

- CUDA, Metal, DirectML, Windows ML or an NPU.
- Choosing the device automatically, measuring which is faster, or a device per model.
- Another precision of the models (fp16 and the like), or another version of the engine.
- `GGML_BACKEND_DL` and ggml's runtime CPU variants (an AVX-512 processor engine): D51's list, separately.
- Recording the device in the transcript or its export.
- Setup or the HTML file; ARM64.

## The research (2026-11-19)

Kept as written before planning, with what planning settled marked. Every number here is read from NVIDIA's documents
and release files, or is an estimate that says so; nothing had run on a GPU.

### Why it came up

- Phases 33–36 run both models on the processor only. The reason was the measurement, not the engine: the work
  laptop's Radeon 740M couldn't be measured, and the maintainer's GPUs are nothing like it (D50, Phase 33's *Out of
  scope*). The engine is built with `GGML_CUDA` and `GGML_VULKAN` off, and `build-stt-runtime.ps1` refuses a build
  with either.
- **The laptop today** (Phase 36, L9, 2026-11-17): 37 minutes in 301 s plugged in, **7.4× real time**, so an hour in
  about 8 minutes. On battery it is estimated at about 4.3× (an hour in about 14 minutes), close to D50's floor.
- **The words set the pace.** The speakers model finishes just before the words only because the decoder's queues
  hold it within about 40 s of them (`stt/run.rs`). On its own it ran at 40× real time on the PC (Phase 33, M6).

### The hardware

| Machine | GPU | What matters here |
|---|---|---|
| Work laptop (the target, D50) | AMD Radeon 740M, integrated: RDNA 3, **4 compute units** (256 shaders), boost 2.5–2.8 GHz depending on the laptop, about **1.4 TFLOPS FP32** ([Notebookcheck](https://www.notebookcheck.net/AMD-Radeon-740M-GPU-Benchmarks-and-Specs.716455.0.html), [cpu-monkey](https://www.cpu-monkey.com/en/igpu-amd_radeon_740m)). | No memory of its own: it uses the laptop's DDR5. It shares the processor's **15–30 W** with the six CPU cores. No NPU. |
| Maintainer's PC | NVIDIA GeForce RTX 2070 SUPER (Turing, compute capability 7.5, 8 GB) | Runs Vulkan and CUDA. Far stronger than the 740M, with memory of its own. |
| Maintainer's PC | Intel UHD Graphics 770 (integrated) | The nearest in kind to the 740M (integrated, shared memory) but another vendor, another driver, and weaker. |
| Colleagues' other laptops | Unknown: likely Intel Iris Xe or Arc, AMD Radeon, some NVIDIA | Only Vulkan covers all three vendors. |

**A rough estimate, not a measurement.** The laptop's six cores with 256-bit FMA at about 3.3 GHz peak at roughly
0.6 TFLOPS FP32; the 740M at about 1.4 (RDNA 3's dual issue can double that on paper). So the 740M's peak is perhaps
2× the processor's, not 10×, and both draw on the same power budget. **Expect a modest gain on the laptop, if any.** A
machine with a dedicated card would gain far more: NVIDIA's own benchmark has a streaming model at 238× real time on an
RTX 4090 against 19× on an 8-thread processor ([BENCHMARK.md](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/BENCHMARK.md)).
*Planning:* the maintainer ships it whatever the gain, and leaves the choice to the user (D58).

### The models

- **Nothing changes.** The q8_0 GGUF files DeScribe downloads run on every ggml backend, so `pack.json` and the
  download (Phase 35) stay as they are. Each card lists NVIDIA GPUs as the models' supported hardware.
- NeMo-Speech.cpp's converter also writes `fp16` ("Apple Silicon, older GPUs"), `bf16`, K-quants and FP4
  ([docs/asr/models.md](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/asr/models.md)). NVIDIA publishes
  only q8_0, so any other precision means converting from `.nemo` and hosting the copy ourselves (D2, D51's item 3).
  Out of scope.
- ggml's Vulkan backend has kernels for 8-bit weights, including integer dot-product paths where the driver offers
  them. Whether AMD's Windows driver offers them on the 740M is to check (`vulkaninfo`).

### The engine: what NeMo-Speech.cpp offers

All as of **v0.3.0** (2026-10-30), the version DeScribe pins. Three commits have landed since, none about Vulkan,
Windows, Parakeet or the diarizer.

#### Backends

- **CPU, CUDA, Vulkan and Metal.** On Windows: CPU, CUDA and Vulkan, each its own build tree
  (`scripts/windows/build.ps1 -Backend cpu|cuda|vulkan`). The Windows backend table marks ASR supported on all three
  ([windows-build.md](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/development/windows-build.md)).
- **The C API already takes a GPU.** `nemo_speech_asr_backend_config.gpu` ("-1 = CPU") and
  `nemo_speech_diar_model_config.gpu` ("GPU device index; -1 = CPU"). `nemo.rs` passes `-1` to both today. No new
  function is needed to use a GPU.
- **How a device is picked** (`src/runtime/ggml/backend.cpp`): the Nth device that ggml reports as a GPU or an
  integrated GPU. If there is none, creating the model fails with "use_gpu=true but no matching GPU device found", so
  the worker learns it at load.
- **The CPU backend is always there too.** ggml's scheduler gives the processor any operation the GPU backend can't
  run. Each such fallback costs a round trip between card and processor. NVIDIA's `check_backend_coverage` tool lists
  them, but "the lazy offline transducer path is outside this diagnostic's coverage", and **offline Parakeet TDT is
  exactly DeScribe's path**. Task 1's stage timings stand in for it.
- **Vulkan uses stock ggml.** CPU and CUDA builds apply NVIDIA's `patches/` (`NEMO_SPEECH_GGML_PATCHED=ON`); Vulkan
  builds don't. So the processor code inside a Vulkan build is not the build DeScribe ships and Phase 33 measured.
  *Planning: one reason for two engines (decision 1).*
- The runtime sets `GGML_VK_DISABLE_GRAPH_OPTIMIZE=1`, since that pass breaks its persistent stream caches.

#### The release files (Windows x64, v0.3.0)

Read from each zip's directory, without downloading or running anything.

| Archive | Size | GPU part | Notes |
|---|---|---|---|
| `…-windows-x86_64-cpu.zip` | 8.7 MB | – | The build Phase 33 checked against its own. |
| `…-windows-x86_64-vulkan.zip` | 22.4 MB | `ggml-vulkan.dll`: **44.3 MB** (13.8 MB compressed) | Everything else as in the CPU zip. Uses the system's `vulkan-1.dll` and the vendor's driver. |
| `…-windows-x86_64-cuda.zip` | 508.6 MB | `ggml-cuda.dll` 109.7 MB, `cublas64_13.dll` 50.3 MB, `cublasLt64_13.dll` 477.9 MB | `-CublasShim` builds a small stand-in for cuBLAS, but `ggml-cuda.dll` alone is 110 MB. |

DeScribe ships today five engine DLLs plus the MSVC and OpenMP runtimes, **6.7 MB** (D53). The Vulkan engine beside it
adds about 52 MB installed, about 17 MB to the MSIX (an estimate: G10 measures it). D58 lifts D50's 40 MB for this.

#### The ways to reach a GPU

| | Vulkan (NeMo-Speech.cpp) | CUDA (NeMo-Speech.cpp) | ONNX Runtime with DirectML or Windows ML |
|---|---|---|---|
| The work laptop's Radeon | **Yes** | No: NVIDIA only | Yes |
| Intel and NVIDIA GPUs | Yes | NVIDIA only | Yes |
| Added to the app | +44 MB installed, about +14 MB in the MSIX | +110 MB with the shim, about +640 MB without | A new runtime of its own |
| What the user's PC needs | `vulkan-1.dll` and a Vulkan driver, which AMD, Intel and NVIDIA drivers install | An NVIDIA driver new enough for the CUDA version | Windows ML's vendor providers need Windows 11 24H2 |
| Engine and models | Same engine, same C API, same files | Same engine, same C API, same files | Another engine and third-party ONNX conversions, which Phase 33 turned down. DirectML is in "sustained engineering"; [Windows ML](https://learn.microsoft.com/windows/ai/new-windows-ml/supported-execution-providers) is its successor. |
| Tested by NVIDIA | **Compile and link only on Windows:** its CI's Windows Vulkan job runs inference on the processor, since the runner shows no Vulkan device (`.github/workflows/gpu.yml`) | GPU inference in CI, on Linux only | – |
| Field reports | [Issue #96](https://github.com/NVIDIA/NeMo-Speech.cpp/issues/96) (2026-10-31): Parakeet TDT 0.6B v3 and diarization **worked with the v0.3.0 Windows Vulkan zip on a Radeon 780M**, the 740M's larger sibling (12 compute units). | Same issue: CUDA failed to start on an RTX 4050 laptop GPU (driver 555.97) | – |

**What the research pointed to,** and planning chose (D58): Vulkan, built by DeScribe from the pinned source as the
processor engine is, beside the processor engine rather than instead of it.

#### Loading the engine

With ggml's backends linked in (not `GGML_BACKEND_DL`), `ggml.dll` registers the Vulkan backend itself, so `ggml.dll`
imports `ggml-vulkan.dll`, which imports `vulkan-1.dll`. *Task 1 confirms it with `dumpbin /dependents`.* On a PC
without a Vulkan loader (some virtual machines, the basic display driver) `LoadLibraryExW` would then fail for the
whole engine. The ways out were two engine folders, which planning chose, or `GGML_BACKEND_DL`, where ggml loads
backends as plugins: upstream's [PR #59](https://github.com/NVIDIA/NeMo-Speech.cpp/issues/59) is open and says "GPU
backends, Windows, and macOS remain untested".

Naming a device isn't in the C API, but ggml's registry functions (`ggml_backend_dev_count`, `_get`, `_name`,
`_description`, `_type`, `_memory`) live in `ggml.dll`. *Task 1 confirms they are exported.*

### Risks and unknowns

Planning's answer is in italics where it has one.

1. **Speed on the 740M.** Unknown, and the estimate above says modest. The TDT decoder works token by token: if each
   step is a small graph sent to the card, the cost of each dispatch could eat the encoder's gain.
   `NEMO_SPEECH_TIMING=1` logs each stage's time. *Measured (Task 1, G8, G9), not a gate.*
2. **The shared power budget.** On the laptop the card and the processor share 15–30 W. On battery this matters most.
   *G9 measures it.*
3. **Memory on an integrated card.** The model sits in the laptop's own RAM either way. AMD's Windows driver reports a
   small dedicated heap (the BIOS's carve-out, often 512 MB on business laptops), smaller than Parakeet's 714 MB.
   ggml's Vulkan backend treats integrated cards as sharing memory and has `GGML_VK_PREFER_HOST_MEMORY`; issue #96
   suggests the 780M loaded the model. D50's 4 GB is read as RAM in use (D51), and on an integrated card its share
   counts too. *Decision 9; Task 1 and G8 measure `GPU Process Memory(*)\Shared Usage`.*
4. **Accuracy.** GPU kernels round differently. *The maintainer: a few words differing is fine; not measured.*
5. **The first load.** The Vulkan backend builds its pipelines when the device starts; the first run after an install
   or a driver update may take seconds longer. *Task 1 times it cold and warm.*
6. **Which card.** The index counts GPUs and integrated GPUs in ggml's order. In issue #96, on a laptop with both a
   Radeon 780M and an RTX 4050, device 0 was the Radeon. *The user chooses each card by name (decisions 2–5).*
7. **Drivers.** Company laptops often carry the maker's older AMD drivers, and Vulkan faults depend on the driver.
   Windows resets a card that doesn't answer within 2 s (TDR), which would end the worker. *The worker's process
   protects the app; decision 6 offers the processor.*
8. **Upstream testing.** NVIDIA runs no GPU inference on Windows Vulkan. Two open issues abort in Vulkan with
   `GGML_ASSERT(ne3 == ne13)` ([#48](https://github.com/NVIDIA/NeMo-Speech.cpp/issues/48),
   [#89](https://github.com/NVIDIA/NeMo-Speech.cpp/issues/89)), in the streaming server and its batching, not
   DeScribe's path; the diarizer is a stream too. *Task 3's checks and G2, G8.*
9. **Using the laptop meanwhile.** A Teams video call uses the card. *G9's Teams run.*
10. **No stand-in for the laptop.** The emulation caps the processor; nothing makes the PC's cards behave like the 740M.
    *The real numbers come from the Store build on the laptop (G9), which Settings' Timings already reports.*

### Sources (read 2026-11-19)

- NeMo-Speech.cpp v0.3.0: [README](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/README.md),
  [build](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/build.md),
  [Windows build](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/development/windows-build.md),
  [diagnostics](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/development/diagnostics.md),
  [ASR configuration](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/asr/configuration.md),
  [ASR models](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/asr/models.md),
  [troubleshooting](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/troubleshooting.md),
  [patches](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/patches/README.md),
  [BENCHMARK.md](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/BENCHMARK.md),
  `include/nemo_speech/asr.h`, `diar.h`, `src/runtime/ggml/backend.cpp`, `tools/check_backend_coverage.cpp`,
  `.github/workflows/gpu.yml`, `scripts/windows/package-release.ps1`.
- Its [releases](https://github.com/NVIDIA/NeMo-Speech.cpp/releases) (file listings) and issues
  [#48](https://github.com/NVIDIA/NeMo-Speech.cpp/issues/48), [#59](https://github.com/NVIDIA/NeMo-Speech.cpp/issues/59),
  [#89](https://github.com/NVIDIA/NeMo-Speech.cpp/issues/89), [#96](https://github.com/NVIDIA/NeMo-Speech.cpp/issues/96).
- The Radeon 740M: [Notebookcheck](https://www.notebookcheck.net/AMD-Radeon-740M-GPU-Benchmarks-and-Specs.716455.0.html),
  [cpu-monkey](https://www.cpu-monkey.com/en/igpu-amd_radeon_740m); the Ryzen 5 PRO 215:
  [Notebookcheck](https://www.notebookcheck.net/AMD-Ryzen-5-PRO-215-Processor-Benchmarks-and-Specs.1154700.0.html).
- Microsoft: [DirectML](https://learn.microsoft.com/windows/ai/directml) and
  [Windows ML's execution providers](https://learn.microsoft.com/windows/ai/new-windows-ml/supported-execution-providers).
- llama.cpp's Vulkan backend on integrated GPUs: `GGML_VK_PREFER_HOST_MEMORY`
  ([#11592](https://github.com/ggml-org/llama.cpp/pull/11592)) and the
  [Vulkan performance discussion](https://github.com/ggml-org/llama.cpp/discussions/10879).

## Handoff

*(Task 1's numbers and what they changed, the texts as shipped and what was trimmed, G1–G10, and anything the next
release needs.)*

**Planning (2026-11-20):** the maintainer answered the planning questions (above, and D58). Nothing in this phase has
been built, and Task 1 hasn't run.

**Task 1 (2026-11-20, the agent, on the maintainer's PC).** The numbers are in
[local-stt.md, *On the graphics card*](../reference/local-stt.md#on-the-graphics-card-phase-37-task-1).
- **Both cards transcribe.** One chunk at a time, the RTX 2070 SUPER did 37 minutes in 21.9 s (102×, 7× the processor)
  and the UHD 770 in 217.0 s (10.3×, 0.7× the processor, with the processor almost idle). The words differ from the
  processor's by 0.1–0.3 %; speakers agree on 99.9–100 %. **No reason to stop.**
- **Not done: the Vulkan SDK.** The agent's permission check refused `winget install --id KhronosGroup.VulkanSDK -e`
  (1.4.363.0). The runs didn't need it (the drivers install `vulkan-1.dll` and `vulkaninfo`), but **Task 2 does: the
  maintainer installs it first** and records the version in local-stt.md's Prerequisites.
- **For Task 3 (the worker), the important finding: batching chunks on a card is broken in v0.3.0.** The CLI batches a
  folder's files on a GPU. On both cards that batch either aborts the process with `GGML_ASSERT(ne3 == ne13)` (upstream
  #48/#89) or **returns empty words for both chunks of a pair, with exit 0.** With `--concurrency 1` it never happened
  (81 chunks on each card). The app's worker sends one chunk at a time through the C API, so it should be safe, but:
  - keep the worker at one words call at a time per card, and never batch;
  - Task 3's check with the real worker must compare each chunk's word count with the processor's on the 37-minute file,
    not only look for errors, since the failure is silent;
  - decision 8 (words and speakers on one card from two threads) is still Task 3's to check. The CLI runs here had the
    two models in separate processes (pipeline) or one after the other (combined).
- **Decision 2 needs two DLLs:** `ggml.dll` exports the registry (`ggml_backend_dev_count`, `_get`, `_by_type`), but
  `ggml_backend_dev_type`, `_description`, `_memory` and `_name` are exported by **`ggml-base.dll`**. `nemo.rs` loads
  both.
- **The device index:** the CLI's `--device vulkan:N` (there is no `--gpu`), `N` counted over GPU and integrated-GPU
  devices in ggml's order, the same as `doctor`'s and as the C API's `gpu` field. Here 0 is the RTX 2070 SUPER and 1 the
  UHD 770. The CPU-type device comes last in the list and is left out (decision 2).
- **Decision 1's chain is confirmed:** `ggml.dll` → `ggml-vulkan.dll` → `vulkan-1.dll`. And stock ggml on the processor
  is 13 % slower than NVIDIA's patched build, so two engines is right.
- **Decision 9:** `GGML_VK_PREFER_HOST_MEMORY` wasn't needed on the UHD 770.
- **For Tasks 4 and 7:**
  - **Committed memory per words process roughly doubles** on a card (7.1–7.8 GB against 3.4 GB) from host-visible
    buffers; RAM in use doesn't. Don't give the worker a commit limit.
  - **The first run on a card loads for 6–8 s** while the pipelines are built, then under 1 s. The first run after an
    install or driver update is slower, and that's expected.
  - **The whole-file path runs out of memory on an 8 GB card** at 37 minutes. The app never uses it.
- **Harness:** `pinrun --profile unpinned` (GPU engine use and `GPU Process Memory` per adapter LUID; CPU time),
  `stt-bench --device` and `--concurrency`, `run-gpu.ps1`, `summarize-gpu.mjs`. The summary flags crashed runs and
  empty chunks, which `stt-bench` itself still reports as a finished run.

**Task 2 (2026-11-20, the agent, on the maintainer's PC).** The Vulkan engine builds, with the LunarG Vulkan SDK
1.4.363.0, which the maintainer installed.
- **`stt-runtime.json`** gains a `vulkan` section. Its `folder`, `build`, `vulkanSdk` (pinned, as the commit is),
  `cmakeArgs` and `engineFiles` (the five, plus `ggml-vulkan.dll`) sit beside the top-level fields, which are still the
  processor engine. The source, commit and MSVC runtime are shared. `pack-desktop.mjs` and `make-notices.mjs` read only
  the top-level fields, so until Task 6 they **cover the processor engine only**, and `desktop:pack` ignores `vulkan\`.
- **`build-stt-runtime.ps1`** builds both by default, or one with `-Only cpu|vulkan`, which keeps the other folder.
  - `-From <bin>` needs `-Only`. It now checks the copied build's flags, and for Vulkan the SDK it used, when the
    build's `CMakeCache.txt` is beside `bin\`.
  - The build dirs are `.stt-runtime-build\build-cpu-asr` and `build-vulkan-asr`, and the two share the source and vcpkg.
  - The script reads `VULKAN_SDK` from the machine's environment when the shell predates the install, and stops,
    with the winget line, if the SDK is missing or of another version.
  - After copying, `dumpbin /dependents` checks each engine file. Every import must be in its folder or in Windows. The
    processor engine must import nothing of Vulkan's. For the Vulkan engine, `ggml.dll` must import `ggml-vulkan.dll`,
    and `ggml-vulkan.dll` must import `vulkan-1.dll`.
  - Each `built.json` gains `backend`, and the Vulkan one also gains `vulkanSdk`.
- **What it built:**
  - `vulkan\` holds 10 files, **48.9 MB** installed. `ggml-vulkan.dll` is 44.3 MB, the same size as in NVIDIA's zip.
    `ggml-base.dll` is stock ggml (673 KB, against the patched 693 KB).
  - CMake used `GGML_VULKAN=ON`, `NEMO_SPEECH_GGML_PATCHED=OFF`, `GGML_NATIVE`/`AVX512`/`AVX_VNNI`/`CUDA` off, and AVX2,
    FMA, F16C and BMI2 on.
  - The imports are as Task 1 found them.
  - `nemo-speech --json doctor` from the build tree lists the RTX 2070 SUPER (gpu, index 0) and the UHD 770
    (integrated-gpu, 1).
  - The 5-minute WAV, with both models (`transcribe --diar-model`, `-c 1`), took 8 s on the RTX and 116 s on the UHD
    770. That's the whole-file path, not the app's chunks. It gave 751 and 752 words, with 2 speakers each.
  - The CLI's test build decodes only WAV, FLAC and MP3.
- **Build times:** 2.4 min for Vulkan from a fresh `.stt-runtime-build\`. Probably vcpkg's binary cache from Phase 33 made it
  quick; the expected 10 minutes didn't happen. Then about 1 min for both, incrementally.
- **The processor engine is still the measured one, byte for byte.** A fresh processor build here produced DLLs of the
  same sizes but different hashes (link timestamps), so the agent restored the Phase 33 files from a backup.
  - **`npm run desktop:stt-runtime` without `-Only` replaces them** with an equivalent build.
  - For Vulkan work, use `-Only vulkan`.

**Task 3 (2026-11-20, the agent, on the maintainer's PC).** The worker runs both models on a card. It lists the cards,
and says when the job's card is gone. Numbers are in local-stt.md's log (the Task 3 row) and `out/worker-gpu/summary.md`.
- **Decision 8, with a change: the two models load one at a time on a card.** The first run on a card aborted with
  `vkCreateFence: Invalid device` (exit `0xC0000409`). ggml-vulkan's `ggml_vk_get_device` creates a card's device the
  first time it's asked for, with no lock. With both models loading at once, both created one, and the first was freed
  under its model. `run.rs`'s `Loading` holds a lock around each model's load **on a card only**. Then they share the
  device, which guards its own queue, and run on their two threads as before. On the processor nothing changed: they
  still load together.
- **The checks all passed after that.**
  - 37 min three times and 1 h once on each card: no assert, no crash, and **no empty 30 s window** against the
    processor (`check-worker-gpu.mjs`). 0.15–0.26 % of words differ; speakers agree on 99.95–100 %.
  - 37 min: 16.2–16.4 s on the RTX 2070 SUPER (137×, faster than Task 1's CLI at 21.9 s), 209–210 s on the UHD 770
    (10.7×). The processor took 125.9 s (17.8×; the PC, unpinned). 1 h: 25.8 s, 335.2 s and 201.9 s.
  - Cancel during a 37-minute run (`cancel-worker-gpu.ps1`): the worker ended in 80–133 ms. The card's memory was
    back by the first sample after that (each sample takes about a second), and a run straight after finished. The
    script ends the process. The app ends its job object, which does the same thing underneath.
  - `GGML_VK_PREFER_HOST_MEMORY` wasn't needed (decision 9).
  - Peak commit on a card is 8.7–9.4 GB, against 4.9 GB on the processor (Task 1's host-visible buffers).
- **The shapes, for Task 4** (`protocol.rs`):
  - `Job.device: Option<Device { name, nth }>`, where absent is the processor. Rust must also set `runtimeDir` to the
    Vulkan engine for a card.
  - `Event::DeviceMissing` (`{"event":"device-missing"}`) comes before `Started`, with exit code 4. The worker also
    sends it when the engine in `runtimeDir` won't load.
  - `Event::Devices { devices: [{ name, kind: "gpu" | "integrated-gpu", memoryBytes }] }`.
  - `Timings.threads` is now `Option<u32>` (none on a card), and `Timings.device` the card's name.
- **For Task 4, in `worker.rs`:**
  - `worker::run` returns `Finished::Done(Outcome)` or `Finished::DeviceMissing`.
  - `worker::devices(dir, timeout)` runs `--stt-worker --devices <dir>` and ends it after `timeout`. Anything going
    wrong gives an empty list. It isn't called yet: `stt_devices` calls it with 15 s. It took 0.44 s here.
- **Placeholders Task 4 replaces** (`commands.rs`, so the build stays green until then):
  - `Finished::DeviceMissing` becomes an `Engine` error. It can't happen yet, since nothing sends a device.
  - `LocalSttTimings.threads` is `timings.threads.unwrap_or_default()`.
- **The opt-in tests can't mix engines in one process.** Both engines' DLLs have the same names, so a second engine
  would bind to the first one's ggml (`run.rs` tests refuse it). Run `cargo test -- --ignored on_a_card` (with
  `DESCRIBE_STT_TEST_GPU=1` for the second card) and `-- --ignored on_the_processor` separately.
  `model_paths_with_non_ascii_letters_load` is now `…_on_the_processor` and `…_on_a_card`.
  - `worker::devices` and `worker::run` start `current_exe()`, which in `cargo test` is the test binary. So the probe
    as a process was checked by hand with the debug exe, and on the processor engine and a missing folder it gives
    an empty list.
- **New spike scripts:**
  - `run-worker-gpu.ps1`: the app's worker under `pinrun`, with its jobs, events and logs in `out/worker-gpu/`.
  - `check-worker-gpu.mjs`: the summary, and an exit code of 1 on an empty window.
  - `cancel-worker-gpu.ps1`.
- Clippy: the old `missing_transmute_annotations` warnings in `nemo.rs` are gone (the `sym!` macro allows it, since
  the type is the field's). The two left, in `splash.rs` and `lib.rs`, were already there.

**Task 4 (2026-11-20, the agent, on the maintainer's PC).** The commands use both engines. Task 3's placeholders are
gone.
- **For Task 5, the shapes** (`commands.rs`):
  - `stt_devices` → `GpuDevice[]` (`{ name, kind: 'gpu' | 'integrated-gpu', memoryBytes }`, in ggml's order). It's empty
    without a `vulkan\` engine (no probe then), without AVX2, or when the probe fails or takes over 15 s.
  - `stt_start` takes an optional `device: { name, nth }`. Left out, it runs on the processor, so today's `bridge.ts`
    still works. A card with no Vulkan engine runs on the processor at once. On `device-missing` the same job runs
    once more on the processor engine. Either way there's no message, and the result's timings say the processor.
  - **`LocalSttTimings.threads` is now `number | null`** (null on a card), and there's a new `device: string | null`.
    `bridge.ts`'s `threads: z.number().int().positive()` rejects `null`, so **Task 5 must loosen it before it sends a
    device**.
  - A new error kind, `gpu`. In a run on a card, `engine` and `out-of-memory` become `gpu`, and so does a worker that
    dies (`crashed()`'s kinds), with the engine's detail. `unreadable`, `cancelled`, `cpu` and the rest stay as they
    are. After a fallback to the processor, errors are the processor's.
- **The debug switches, for Task 7's desktop.md** (release builds ignore them, `fake.rs`):
  - `DESCRIBE_STT_FAKE_DEVICES=<json array of GpuDevice>`: the list `stt_devices` returns. With `DESCRIBE_STT_FAKE`,
    the fake worker looks for the job's card in it and says `device-missing` when it isn't there, so the real fallback
    runs.
  - `DESCRIBE_STT_PRETEND_NO_GPU=1`: no cards, and `stt_start` ignores the device.
  - The fake script's new `cardFailure` ends a run on a card with that failure. On the processor the script runs as
    usual. `fixtures/local-stt/fake-gpu.json` is `fake-run.json` with `cardFailure: gpu`, for G5
    (it was `engine`, which the app turned into `gpu`, until audit GPU-1).
  - On a card the fake engine reports `threads: null` and the card's name.
- **Checked by hand** (debug exe over CDP, `tone-5s.wav`):
  - The real probe listed the RTX 2070 SUPER and the UHD 770 in 227 ms.
  - Runs on each card gave `device` set and `threads: null`.
  - An unknown card ran on the processor (threads 8, device null).
  - With the fake engine and devices, a listed card failed with `gpu` and its detail. No device, or an unlisted card,
    gave a result.
  - `DESCRIBE_STT_PRETEND_NO_GPU=1` listed nothing.
- `engines()` replaces `runtime_dir()`. The Vulkan engine is the first candidate's `vulkan\` that holds both
  `nemo_speech_asr_c.dll` and `ggml-vulkan.dll`.

**Task 5 (2026-11-20, the agent, on the maintainer's PC).** The page uses the cards. Rust is unchanged.
- **Where it lives:**
  - `settings.ts` holds `localDevice` (`'cpu'` or `{ name, nth }`; anything unreadable is `'cpu'`) and `gpuDevices`.
    `refreshDevices()` fills it, and `SpeechPackSection` calls it whenever the band shows *ready*. The store also has
    `deviceOptions`, and `checkedDevice` (the saved card if it's listed, else **Processor**, with the saved value kept).
  - The run's card travels as `TranscriptionInput.device`, which only the local provider reads. `job.ts` sends the
    *saved* card even when Settings doesn't list it, and Rust falls back.
  - `job.retryOnProcessor()` runs the last local snapshot with `device: null`. **Try again** after it repeats that
    processor run, and the next **Transcribe** uses Settings again.
- **Shapes:**
  - `TranscriptionTimings.threads` is `number | null`, plus a new `device: string | null`.
  - `job.lastLocalRun` reads a record from before Phase 37 as the processor (`device: null`).
  - `ProviderError`'s opts gain `retryOn: 'processor'`.
  - The local `toProviderError(error, { fileName, card })` takes the card's name.
- **The texts as shipped:**
  - **Run on** (a `<fieldset>` with a visible `<legend>`), with **Processor** and each card by name.
  - "The graphics card (NAME) stopped while transcribing.", with **Try again** (primary) and **Try on the processor**.
    Without a name it says "The graphics card stopped while transcribing.".
  - Timings' **Ran on**: "Processor (8 threads)", or the card's name.
  - One addition to the plan: a repeated card name gets " (2)", " (3)", so two identical cards can be told apart.
- **The web build:** `TAURI_MARKERS` gains `stt_devices` and `Try on the processor`. The button's label is a
  `__DESKTOP__ ? … : ''` constant, since text in the template reached the web build.
- **Over CDP** (debug exe, a scratch WebView2 profile, `DESCRIBE_STT_PICK=tone-5s.wav`), for Task 7's G rows:
  - **G1 pass:** with `fake-gpu.json` and one made-up card, **Processor** was checked first, and the card stayed checked
    after a restart.
  - **G5 pass:** a run on the card showed the message naming it, with **Try again** and **Try on the processor**. The
    second gave a transcript, Settings still had the card, and Timings said "Processor (8 threads)". There were no
    console errors.
  - **G6 pass:** with the saved card missing from the list, **Processor** was checked and a run finished with no
    message, on the processor. With the card listed again, it was checked again.
  - **G7 pass:** with `DESCRIBE_STT_PRETEND_NO_GPU=1` there was no group.
  - **The real engine** (no fakes, `.speech-pack/`): the probe listed the RTX 2070 SUPER and the UHD 770, and
    `tone-5s.wav` on each said **Ran on** that card, with no console errors.
  - G1's "without the models: no group" is covered by `SpeechPackSection.spec.ts`. *Screen reader (G5): the
    maintainer.*
  - The script isn't in the repo, as before.

**Task 6 (2026-11-20, the agent, on the maintainer's PC).** The MSIX carries both engines, and the desktop notices list
what the Vulkan engine adds.
- **`pack-desktop.mjs`** checks each engine with `checkEngine()`: its `built.json` is there, of `stt-runtime.json`'s
  version and backend, every file listed with the same size and SHA-256, and for Vulkan the same `vulkanSdk`. Then it
  stages the processor engine beside the exe and the Vulkan one in `vulkan\` (`vulkan.folder`, which must match
  `VULKAN_FOLDER` in `commands.rs`).
  - Both always ship (D58), so there's no switch to leave one out. A missing Vulkan engine stops the pack and names
    `npm run desktop:stt-runtime -- -Only vulkan`.
  - The processor's `built.json` is Phase 33's and has no `backend`, so a missing one reads as `cpu`.
  - Checked by hand: no `built.json`, another SDK, the wrong backend and a changed `ggml-vulkan.dll` each stop it before
    the build.
  - The summary now gives the installed size too.
- **The sizes** (version 1.3.0, unsigned): the MSIX is **21.1 MB**, against 5.5 MB from the same tree without
  `vulkan\`. Installed, it's 65.5 MB against 16.6 MB. In desktop.md's *Size*. All 19 engine files in the MSIX have
  their `built.json` hashes.
  - The pack replaced `release/DeScribe-v1.3.0-x64.msix`, Phase 36's checkpoint, with one from this tree. Rebuild it
    from that commit if it's still to be submitted.
- **The notices:**
  - ggml's heading names `ggml-vulkan.dll`.
  - Two new entries: **Vulkan-Headers** 1.4.363 (`vulkan.h`, and `vulkan.hpp`, which Vulkan-Hpp generates into that
    repo; Apache-2.0 OR MIT, shown as MIT, as `chooseTexts` does) and **SPIRV-Headers** `vulkan-sdk-1.4.363.0`
    (`spirv.hpp`, Khronos's MIT text).
  - The texts are from the two repos at tag `vulkan-sdk-1.4.363.0`, since the SDK ships none: Vulkan-Headers'
    `LICENSES/MIT.txt` as published, and the part of SPIRV-Headers' `LICENSE` that covers `include/`.
  - `NATIVE_DESKTOP.checked` gains `vulkanSdk`. Another SDK in `stt-runtime.json` stops `make-notices.mjs` until the
    list is checked again.
  - Left out, on purpose:
    - the shaders, which are ggml's GLSL compiled by glslc at build time, so ggml's entry covers them;
    - `vulkan-1.lib`, an import library whose stubs hold no loader code. `ggml-vulkan.dll`'s link line is
      `ggml-base.lib`, `vulkan-1.lib` and Windows' own libraries;
    - `vulkan-1.dll`, which is the driver's.
  - The web notices are unchanged.
- **For G10 (the maintainer):** the Windows App Certification Kit on the new MSIX, and installing it (`-- --sign`) to
  see the cards listed from the installed app.
- **Not this task's, for whoever next touches the e2e suite:** `a11y.e2e.ts`'s "Project: every state…" timed out in
  axe's `analyze()` (30 s) in two full `npm run test:e2e` runs here, and passed alone (about 10 s) four times out of
  four. Task 6 changed nothing under `src/` or `tests/`. It needs a longer timeout for that test or a split.

**Task 7 (2026-11-20, the agent).** The docs say what was built. Nothing in the code changed.
- **AGENTS.md:** the Desktop row (two engines), and the `desktop:stt-runtime` and `desktop:pack` commands (both
  engines, the Vulkan SDK, `-Only`).
- **local-stt.md:** *As built (Phase 37)*, with the two engines side by side, the probe, the one-at-a-time loads and
  Task 3's worker numbers. A new G9 table for the work laptop, empty until the maintainer runs it. The SDK was already
  in Prerequisites (Task 2).
- **desktop.md:** *On the graphics card (Phase 37)*, with `stt_devices`, `stt_start`'s device, the debug switches and
  the G table. E7 now reads "with **Processor** chosen". The worker line names `vulkan\`. Two log rows.
- **DECISIONS.md D58:** the measured sizes instead of the estimates, and *What the build found*.
- **USER_GUIDE.md:** a paragraph on **Run on**, and a troubleshooting row for the card's failure. PRIVACY.md is
  unchanged, since nothing leaves the computer.
- **ROADMAP:** §2's scope line, §5's `src/stt/` and `stt-runtime.json` lines, and the table: ◐ Built, with the
  maintainer's checks open.
- **Also, outside the task's list:** TESTING.md's opt-in tests now name Task 3's `on_the_processor` and `on_a_card`,
  run in two commands, and its per-release list gains G1–G10.
- **The G rows as they stand:**
  - pass: G1, G3, G5, G6, G7 and G8 (the agent, on the PC);
  - in part: G2 and G4 (the worker passes; in the app, the maintainer), and G10 (the sizes; the certification kit
    is the maintainer's);
  - still to run: G9, on the work laptop, plus the laptop column of G1, G2 and G4, and G5's screen reader.
- **The phase stays ◐ until** those run, as Phases 35 and 36 do. G9 gates nothing (D58). Run G10's certification kit
  before the MSIX goes to the Store.

**G10 (2026-11-20, the maintainer):** the Windows App Certification Kit **passed** on the latest build, the 1.3.0
MSIX from Task 6 with both engines. G10 now passes. Still open: G9, the laptop column of G1, G2 and G4, G2 and G4 in the
app on the PC, and G5's screen reader.

**Audit GPU-1 fixed (2026-11-20, an agent):** only the card's failures are `gpu` now. Before, `run_job` made every
`engine` or `out-of-memory` in a run on a card `gpu`, so a Media Foundation failure, or the worker failing to start,
said "The graphics card stopped" and pointed at the driver.
- **The worker** gives `gpu` itself for the models' failures and for the Vulkan engine not loading (`run.rs`
  `engine_failure(error, gpu)`, `Loading::failure`). The decoder's failures keep their kind.
- **`worker::run`** turns a crash on a card into `gpu` (`worker::on_a_card`, moved from `commands.rs`). `run_job`
  passes errors through as they are.
- `fake-gpu.json`'s `cardFailure` is now `gpu`, since the app no longer converts it. G5 behaves as before.
- **Left as is:** a panic in the decoder thread on a card still reads as the card's. The worker dies, and a crash
  can't say where it came from. Catching it in `decoder_thread` isn't worth it for code that hasn't been seen to panic.
- `cargo test --lib`: 104 pass. `npm test` passes. The e2e tests weren't run, and neither was G5 over CDP with the new
  fixture.

**Audit GPU-2 fixed (2026-11-20, an agent):** a run on a card now has the probe's deadline while the worker lists the
cards. Before, a driver that hung while listing left the run at *Preparing* until Cancel.
- **A new event, `device-found`** (`{"event":"device-found"}`), which the worker sends as soon as it has found the job's
  card, before any work. The fake worker sends it too. The deadline ends there, not at `Started`: `Started` waits for
  Media Foundation to open the recording, and a OneDrive file that's online-only downloads first, which can take
  longer than 15 s.
- **`worker::run`** reads stdout on a thread of its own (`lines_of`), so `read_events` can stop waiting. If neither
  `device-found` nor `device-missing` comes within `worker::LISTING_TIMEOUT` (15 s, moved from `commands.rs`), it ends
  the worker and returns `Finished::ListingHung`. It doesn't wait for the worker or join its stderr, since a hang in the
  kernel driver might not let it end. The probe has never waited, for the same reason.
- **`run_job`** runs a `ListingHung` job on the processor, as for a missing card, and sets `Stt::listing_hung`. While
  that's set, `job_for` skips the card and `stt_devices` returns no cards without probing. A probe that times out
  (`worker::devices` now returns `Err(ListingHung)`) sets it too. It lasts until the app restarts, so only the first run
  waits 15 s. `stt_devices` now returns a `Result`, as Tauri requires of an async command that takes `State`. It never
  fails, and the page sees the same array.
- **Left as is:**
  - A worker stuck in the kernel driver is left behind until it ends, at the latest when the app closes (its job
    object).
  - A hang after `device-found`, while a model creates the card's device, still has no deadline: the first load
    legitimately takes 6–8 s while the pipelines are built (Task 1), and longer on a slow driver. Only Cancel covers
    it, and a Cancel that can't end a worker stuck in the driver still waits in `child.wait()`, as before.
  - Nothing tells the user, as decision 5 asks. GPU-3 would give the maintainer a reason to read ("listing the cards
    took longer than 15 s").
- **Tests:** `a_card_that_takes_too_long_to_list_ends_the_run`, `a_hang_while_listing_ends_the_worker`,
  `once_the_card_is_found_the_run_has_no_deadline`, `a_card_found_missing_before_the_deadline_is_missing`,
  `a_run_on_the_processor_has_no_deadline`, `a_hang_while_listing_runs_the_same_job_on_the_processor`,
  `once_listing_has_hung_the_cards_arent_probed`, and a hang case in `a_run_on_a_card_needs_the_vulkan_engine`. A real
  hanging driver wasn't available, so the path is proven by these alone.
- Also reworded `run.rs` `cards()`'s comment (audit CQ-3).

**Audit GPU-3 fixed (2026-11-20, an agent):** a run that asked for a card and ran on the processor now records which
card it didn't use and why. Before, the reason went only to the worker's stderr, which nothing reads after a fallback.
- **`device-missing` carries a `reason`** (`{"event":"device-missing","reason":"…"}`), with no path: "the Vulkan engine
  found only …" or "the Vulkan engine found no graphics card" (`run.rs` `not_listed`), or "the Vulkan engine didn't
  load: …" (`cards()` now returns a `Result`). The fake worker sends the same.
- **Rust adds the others:** `job_for` skips the card with "the Vulkan engine isn't installed" or, after a hang, "listing
  the cards hung earlier, so they're skipped until DeScribe restarts"; `run_job` gives "listing the cards took longer
  than 15 s" for `ListingHung`. `run` puts the reason in the timings as `fellBack: { device, reason }` (else null).
- **The page:** `fellBack` is in the bridge's schema and the `lastLocalRun` record (`.catch(null)`, so an older record
  reads). Under Settings' **Timings**, **Ran on** says "Processor (8 threads), not AMD Radeon 740M Graphics", and a row
  **Why** appears only then. Still no message, as decision 5 asks. The audit's `console.warn` wasn't used: the release
  build has no DevTools (`tauri` without the `devtools` feature), so a colleague's console can't be read.
- **Left as is:** the probe's own reason. When the Vulkan engine never loads on a computer, Settings lists no card and
  hides **Run on**, so no card is saved and no run records why. Showing that would be new UI that decision 4 doesn't
  plan for. `DESCRIBE_STT_PRETEND_NO_GPU` still drops the card before the job, so it records no fallback.
- **Tests:** `an_engine_that_wont_load_says_why`, the reasons in `a_scripted_run_finds_its_card_among_the_made_up_ones`,
  `a_run_on_a_card_needs_the_vulkan_engine`, `a_missing_card_runs_the_same_job_on_the_processor`,
  `a_hang_while_listing_runs_the_same_job_on_the_processor`, `a_missing_card_ends_the_worker_at_once` and the event's
  round trip; on the page, the bridge, the record and the Timings rows. Not checked in the app over CDP.

**Audit GPU-4 fixed (2026-11-20, an agent):** a click on **Processor** while the saved card is gone now saves the
processor. Before, **Processor** was already checked (decision 4), a click on a checked radio fires no `change`, and the
card came back with the card though Settings last showed **Processor**.
- **Run on**'s radios save on `click` as well as `change`. `click` covers the mouse, the label and Space on the checked
  radio; `change` is kept for arrow keys moving the choice. `setLocalDevice` does nothing for the choice already saved,
  so the second event writes nothing.
- **Unchanged:** with no card listed, **Run on** is hidden, so the saved card still comes back with the card (decision 4).
- **User Guide:** the fallback sentence now ends "unless you choose **Processor** meanwhile".
- **Tests:** `SpeechPackSection.spec.ts` "saves the processor clicked while the saved card is gone…" (fails without the
  fix) and `settings.spec.ts` "saves the processor chosen while the saved card is gone, and writes nothing for the same
  choice again". Not checked in the app over CDP.

**Audit GPU-5 fixed (2026-11-20, an agent):** a card whose driver gives no description no longer hides every card.
Before, `Registry::list()` gave it the name `""`, the page's schema (`name: z.string().min(1)`) refused the whole list,
and Settings listed no card, with only a `console.warn`.
- **`nemo.rs` `gpus()` names it by its place** among the cards, "Graphics card 2", a description of only spaces
  included. The probe and a run both list through `gpus()`, so the saved choice and `gpu_index` agree.
- **Named, not dropped**, as the audit also offered: `gpu_index` is a card's place in `gpus()`, the engine's count, so
  dropping an unnamed card would move every card after it to the one before. ggml's own name (`ggml_backend_dev_name`,
  "Vulkan1") wasn't used: it needs another export and reads poorly in **Run on**.
- **The page is unchanged**, and its schema stays strict.
- **Tests:** `a_card_with_no_description_is_named_by_its_place` and
  `a_card_with_no_description_keeps_the_cards_after_it_in_place`. No driver here leaves the description empty, so the
  path is proven by these alone.

**Audit GPU-6 fixed (2026-11-20, an agent):** two identical cards are now told apart wherever DeScribe names a card.
Before, only **Run on** said "NVIDIA RTX A2000 (2)". The failure message, **Ran on** and a fallback's "not …" used the
name alone. The fallback's "not …" was a third place that the audit didn't list; GPU-3 added it.
- **One label:** `src/domain/gpuCard.ts` `cardLabel({ name, nth })`, used by `deviceOptionsFor()`, `provider.ts` (the
  message) and `ranOn()`. **Run on**'s labels are unchanged.
- **Rust sends the card, not its name:** `Timings.device` (worker to app), `LocalSttTimings.device` and
  `FellBack.device` are `{ name, nth }`. The worker and the app are one exe, so the protocol needed no compatibility.
  The bridge's schema now refuses a bare name.
- **The record:** `lastLocalRun` reads a card saved as a name alone (this phase's runs before the fix) as `nth` 0.
- **The message** is unchanged for one card. The second of two identical ones reads "The graphics card (NVIDIA RTX
  A2000 (2)) stopped while transcribing.", with nested parentheses, only on such a PC.
- **`check-worker-gpu.mjs`** prints the card's name and `nth`.
- **Tests:** `gpuCard.spec.ts`; the bridge (the new shape; a bare name refused); `provider.spec.ts` "names the second of
  two identical cards as Run on does"; `job.spec.ts` (a second card kept, an older record by name); the **Ran on** and
  fallback rows in `SpeechPackSection.spec.ts` on a second card; in Rust, the serialised timings and
  `a_run_on_a_card_says_which` on `nth` 1. Not checked in the app over CDP, and no PC here has two identical cards.
