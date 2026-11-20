# Local speech models (NeMo-Speech.cpp, Hugging Face): reference for DeScribe

*Written 2026-11-15 in Phase 33 from the runs in the [verification log](#verification-log): part A on the maintainer's
PC without a maintainer, part B from [the maintainer's tasks](../phases/33-maintainer-guide.md) and the work laptop's
download check. **[Provisional go](#gono-go), at the target,** recorded in DECISIONS.md D51, which completes D50.
"Uncapped" timings are the PC's full clock and say how the engine behaves; "**Estimated for the work laptop**" ones
come from the calibrated *Laptop* and *Throttled* profiles. The column for the laptop's own numbers is Phase 36's.*

Official sources (read 2026-11-14/15):
- [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) v0.3.0 and its
  [CLI](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/cli.md),
  [SDK](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/sdk.md) and
  [Windows build](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/development/windows-build.md) docs.
- The models' cards:
  - [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3);
  - [Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b);
  - [Nemotron 3 Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization);
  - [Streaming Sortformer 4spk v2](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2).
- Hugging Face: [rate limits](https://huggingface.co/docs/hub/rate-limits) and
  [terms of service](https://huggingface.co/terms-of-service).
- [Microsoft Store Policies 7.20](https://learn.microsoft.com/windows/apps/publish/store-policies) (2026-09-14).
- The licences: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.en) and
  [OpenMDW-1.1](https://openmdw.ai/license/1-1/).

## What DeScribe needs (D50)

- In the desktop app, a recording is transcribed with speaker labels and word times on the computer, as an
  alternative to ElevenLabs.
- On the work laptop (Ryzen 5 PRO 215, CPU only), an hour should take 10 minutes (target) and no more than 15 (floor).
- Peak memory under 4 GB. A download of 1.5 GB or less. The MSIX grows by 40 MB or less.
- The models are downloaded by the app from Hugging Face, and the user sees one thing, not two models.
- Tests are English with two speakers (the maintainer, 2026-11-14).

## Prerequisites

On the maintainer's PC, 2026-11-14/15, beyond Phase 24's ([desktop.md](desktop.md)):

| Tool | Version | Used for |
|---|---|---|
| CMake | 4.4.4 (`winget install Kitware.CMake`) | building NeMo-Speech.cpp |
| Ninja | 1.13.2 (`winget install Ninja-build.Ninja`) | building NeMo-Speech.cpp |
| MSVC | 14.44.35207 (VS 2022 17.14); VS also has 14.38, its pinned v143 default | see [the runtime](#the-runtime) |
| vcpkg | tag 2026.07.29, bootstrapped by NeMo-Speech.cpp's `build.ps1` into `vendor/vcpkg` | sentencepiece, abseil, protobuf |
| Node | 22.19.0 | `fetch-models.mjs`, `compare.mjs`, `make-test-set.mjs`, `summarize.mjs` |
| ffmpeg | 8.0 (gyan.dev full build) | making the test set, and as the decoding reference. Never shipped. |
| Cinebench | 2024.1.0 and R23.2.0, on the Desktop | calibrating the emulation |
| Vulkan loader and `vulkaninfo` | instance 1.4.341, in System32 (installed by the graphics drivers: NVIDIA 617.14, Intel 101.6129) | Phase 37, Task 1: listing the cards. Nothing else is needed to *run* a Vulkan engine. |
| LunarG Vulkan SDK | 1.4.363.0, at `C:\VulkanSDK\1.4.363.0` (`winget install --id KhronosGroup.VulkanSDK -e --version 1.4.363.0`, installed by the maintainer). `stt-runtime.json` pins it (`vulkan.vulkanSdk`). | Phase 37: building the Vulkan engine. `VULKAN_SDK` is set only in new shells; `build-stt-runtime.ps1` reads it from the machine's environment if the shell lacks it. |
| `dumpbin` | MSVC 14.44.35207's, at `VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\` (not on PATH) | Phase 37, Task 1: the engine's imports and exports |

Everything the spike builds or fetches is in `scripts/spikes/local-stt/`. The gitignored parts are `models/`,
`vendor/`, `out/` and `*/target/`.

## The models

All four are NVIDIA's own q8_0 GGUF files, in NVIDIA's own Hugging Face repositories, **not gated**
(`"gated": false`), pinned to the revision NeMo-Speech.cpp v0.3.0's `models/index.json` names. No other precision is
published as GGUF.

| Role | Model | Licence | Revision | File | Bytes | SHA-256 |
|---|---|---|---|---|---|---|
| Words | Parakeet TDT 0.6B v3 | CC-BY-4.0 | `541d1f99c6b0c3cd0b11a95167540bb8edefd82b` | `parakeet-tdt-0.6b-v3.q8_0.gguf` | 713,975,456 | `e3880d0aaaaf2c308ea2c35016b2b895c423eb3fda924c1b463d1c19b7f4d32e` |
| Words | Nemotron 3.5 ASR Streaming 0.6B | OpenMDW-1.1 | `1c8deaecc64b91f034d73e08dd8b64625eb3395d` | `nemotron-3.5-asr-streaming-0.6b.q8_0.gguf` | 741,548,352 | `a5c435f294eea8f88ce68dd27b8c3bfea7f777cb2fbba04fcd30eaa555f429ae` |
| Speakers | Nemotron 3 Diarization | OpenMDW-1.1 | `f667ed73aee57d40cc39428eb768b4fd87a0a29e` | `Nemotron-3-Diarization.q8_0.gguf` | 107,012,128 | `08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1` |
| Speakers | Streaming Sortformer 4spk v2 | CC-BY-4.0 | `5240a64075176943f677d30fa2171c780229f341` | `diar_streaming_sortformer_4spk-v2.q8_0.gguf` | 147,075,776 | `0679cfeb1ce356d0dea9470b31274f4bfc7eb927497d82005483770666da998a` |

URL: `https://huggingface.co/<repo>/resolve/<revision>/<file>`. The list is `scripts/spikes/local-stt/models.json`.
**Parakeet with Nemotron Diarization is 821 MB.**

**Not candidates after the research:**
- **Sortformer v2.1:** NeMo-Speech.cpp runs v2, not v2.1, and v2.1 is `.nemo` only.
- **Nemotron Labs Unified ASR:** `.nemo` only. It runs only through `parakeet-rs`, on third-party ONNX conversions.
- **Nemotron 3.5 ASR:** much slower than Parakeet on a CPU (M2).
- **Sortformer v2:** slower than Nemotron Diarization for the same labels (M6).

The Nemotron cards list only NVIDIA GPUs as supported hardware. Running on a CPU is covered only by NeMo-Speech.cpp's
own benchmarks.

### The licences

As read on the day; the maintainer confirms the reading before anything ships (Phase 35).

- **CC BY 4.0** (Parakeet, Sortformer v2), section 3(a)(1). Sharing requires keeping:
  - "identification of the creator(s) of the Licensed Material";
  - "a copyright notice";
  - "a notice that refers to this Public License";
  - "a notice that refers to the disclaimer of warranties";
  - "a URI or hyperlink to the Licensed Material".

  It also requires saying "if You modified the Licensed Material". The app downloads NVIDIA's own file unchanged, so
  there is no change to declare.
- **OpenMDW-1.1** (Nemotron 3 Diarization, Nemotron 3.5), last updated 2026-05-27:
  - "If you distribute any portion of the Model Materials, you shall retain in your distribution (1) a copy of this
    agreement, (2) all copyright notices and other notices of origin";
  - no restriction on use, which it grants "without restriction";
  - none on outputs: "This agreement does not impose any restrictions or obligations with respect to any use,
    modification, or sharing" of outputs.
- **Who distributes:** the app downloads from NVIDIA's own repositories, so NVIDIA distributes the files (D2 below
  isn't needed). DeScribe credits the models and shows the licence texts in About (D36, Phase 36).

## The runtime

**NeMo-Speech.cpp v0.3.0** (2026-10-30), NVIDIA, Apache-2.0: commit `20999cc9`, with llama.cpp `bd4f514d` for ggml.
`scripts/spikes/local-stt/build-runtime.ps1` builds it with NVIDIA's `scripts/windows/build.ps1 -Backend cpu -Profile asr`
and these flags, which `CMakeCache.txt` confirms:

| Flag | Value | Why |
|---|---|---|
| `GGML_NATIVE` | OFF | no tuning for the build PC |
| `GGML_SSE42`, `GGML_AVX`, `GGML_AVX2`, `GGML_FMA`, `GGML_F16C`, `GGML_BMI2` | ON | the laptop has them (they are also ggml's defaults with `GGML_NATIVE=OFF`) |
| `GGML_AVX_VNNI`, `GGML_AVX512` (and its sub-flags) | OFF | the i7 lacks AVX-512 and the laptop is believed to lack AVX-VNNI, so this errs on the slow side |
| `GGML_CUDA`, `GGML_VULKAN` | OFF | no GPU can be used, even by accident |
| `GGML_OPENMP` | ON | needs `vcomp140.dll` |
| `GGML_LLAMAFILE` | ON | NeMo-Speech.cpp's default (tiled Q8_0 matmuls) |

- **The build:** 1.5 minutes once vcpkg's libraries are built (9 minutes the first time).
- **A trap:** vcpkg builds with the newest MSVC installed, while `vcvars64.bat` picks VS's pinned v143 default (here
  14.38). The link then fails on `__std_search_1` and similar. `build-runtime.ps1` sets `VCVARS_USER_VERSION` to the
  newest toolset.
- **What it makes (M1):** 7.1 MB in all:

  | File | Bytes |
  |---|---|
  | `nemo_speech_asr.dll` | 4,349,440 |
  | `ggml-cpu.dll` | 947,712 |
  | `ggml-base.dll` | 693,248 |
  | `ggml.dll` | 61,440 |
  | `nemo_speech_asr_c.dll` (the C API) | 60,416 |
  | `nemo-speech.exe` | 965,120 |

  Plus the MSVC runtime and `vcomp140.dll`, which NVIDIA's prebuilt zip ships beside them.
- **The prebuilt zip:** `nemo-speech-0.3.0-windows-x86_64-cpu.zip` (8,694,509 bytes, SHA-256 `4ed9740e…5b05`) is
  built the same way (`GGML_NATIVE=OFF`, x86-64-v3).

**The CLI (`nemo-speech`):**
- `transcribe` writes JSON with each word's `start`, `end`, `confidence` (always 1 for Parakeet) and, with
  `--diar-model`, a 1-based `speaker`. `languages` is empty for Parakeet: it doesn't report the language.
- `diarize` writes segments (`start`, `end`, `speaker`).
- It reads WAV only (PCM16 or float32, 8–96 kHz, mono or stereo) and resamples it itself.
- **The network:**
  - it fetches a missing indexed model by itself;
  - `--diarize` without `--diar-model` downloads the default Sortformer;
  - a local GGUF path "does not use the network".

  The harness always passes both model paths and points `NEMO_SPEECH_MODEL_DIR` at an empty folder.
- **Settings:** `--asr.backend.threads N` sets the words model's threads, and the speakers model shares them in
  `transcribe --diarize`. Run alone, `diarize` and the C API's diarizer are fixed at **4 threads** (`ggml_runtime::Params`).
- **Environment variables:** `NEMO_SPEECH_TIMING=1` logs each stage's time, and `NEMO_SPEECH_MEMSTATS` logs memory.
  CLI settings can also come from `NEMO_SPEECH_<KEY>` variables, **in the CLI only**.
- **Long audio:** offline Parakeet is always full-context ("attention=full-context"). Past the positional limit it cuts
  at the quietest 100 ms and decodes segment by segment through one stateful decoder. Cost per frame grows with
  segment length (M4).
- **The diarization preset:** `--diar-preset` / `--preset` takes `streaming`, `offline`, `v3-streaming` or
  `v3-offline`. The default is the live, low-latency geometry. `v3-offline` is about 10× faster on a file (M6).

**The C API (`nemo_speech/asr.h`, `diar.h`):**
- **What it has:**
  - per-word times, a speaker tag and language codes;
  - a streaming push API for both models;
  - a thread-local `nemo_speech_asr_last_error()`.
- **What it lacks:**
  - **a thread count:** `backend_config` has only `gpu`, so words run on min(8, hardware threads), which is 8 on the
    PC and on the laptop;
  - **progress callbacks;**
  - **cancel:** the status code exists, but nothing returns it.
- `max_speaker_count` "is accepted for compatibility but is ignored".
- `diar-stream` (harness) drives `diar.h` from Rust through `LoadLibraryExW`/`GetProcAddress`: create, open, push 30 s
  pieces, finish, segments. It works.
- **Model paths are UTF-8.** Both models load through `ggml_runtime::GGUFLoader`, which opens the file with
  `gguf_init_from_file` and `llama_file`. Both call ggml's `ggml_fopen`, which converts UTF-8 to wide characters and
  calls `_wfopen`. So a user folder with ø or ü works on any ANSI code page. See
  [non-ASCII paths](#non-ascii-paths-audit-des-1).
- **A new engine version** must pass `cargo test --lib -- --ignored model_paths_with_non_ascii` before it ships.

## The emulated laptop

| | |
|---|---|
| PC | i7-13700K: 8 P-cores (efficiency class 1, logical processors 0–15) and 8 E-cores (class 0, 16–23); AVX2, no AVX-512; 64 GB DDR4-2667; RTX 2070 SUPER and UHD 770 |
| The profile's processors | `0xfff0`: logical processors 4–15, so P-cores 2–7 with both hyper-threads. From `GetLogicalProcessorInformationEx` (`pinrun topology`); cores 0 and 1 are left out because they take most interrupts. |
| Pinning | `pinrun` puts itself in a job object with that affinity, so the command and its children are pinned from their first instruction. Checked: `busy` saw exactly 4–15. |
| GPUs | `pinrun` samples `GPU Engine(*)\Utilization Percentage` for the job's processes: 0.0 % in every run, no engine instance at all. |
| Schemes | "DeScribe laptop emulation" (`9589d08a-f1fa-4ac5-a58b-054c7b850953`) and "DeScribe laptop emulation (throttled)" (`951023bb-4e1a-473f-bb3a-829e8fe9edd1`), copies of Balanced made by `setup-emulation.ps1`. Balanced itself was not edited, and was active again after every session. |
| Caps and scores | **Laptop: `PROCFREQMAX` = `PROCFREQMAX1` = 3,375 MHz** on mains power. Pinned, R23 multi 10,118 (+0.8 % on the laptop's 10,036); 2024 multi 400 (−28 % on 557, a disturbed run: at 3,200 MHz it scored 497, −10.7 %, and the run at 3,375 saw a 5.3 GHz spike); single-core R23 1,206 (−30 % on 1,713), 2024 74 (−27 % on 101). Measured clock in the runs: about 3,290 MHz. **Throttled: 1,950 MHz:** 2024 multi 321 (−4.0 % on 334), R23 multi 5,761 (−4.3 % on 6,022), both within 5 %; single-core 2024 42.7. Its measured clock read about 1,100 MHz: the cap selects a lower state than its number. The check before the timed runs: R23 10,096 (−0.2 % from the calibration). |
| Cinebench, pinned, full clock | Single-core: 2024 114.0 (the laptop 101), R23 1,958 (the laptop 1,713). **R23 multi 16,307** (the laptop 10,036: **1.62×**). **2024 multi 763.4** (the laptop 557: **1.37×**), a single pass of 434 s, rendered with 24 threads ("CPUX … 24") because Cinebench 2024 sizes its threads by the machine and can't pin them inside the job ("SetThreadGroupAffinity failed"). |
| The calibration rule | The two benchmarks disagree by 18 %, so no cap brings both within 5 % of the laptop. **`calibrate.ps1` errs on the slow side:** it takes the cap at which neither benchmark is more than 5 % faster than the laptop. That matches R23 and leaves 2024 about 15 % below the laptop, and it records both errors. A change from the phase file's "both within 5 %". |
| Cinebench's output | Printed only to a console it attaches to ("parentconsole"), never to a redirected stdout, and kept in no file, so `pinrun --capture-console` runs it on a pseudo console (ConPTY). |
| The PC's own scheme | Balanced (`381b4222-f694-41f0-9685-ff5bb260df2e`), with no cap (`PROCFREQMAX` 0). The frequency caps are hidden settings: read them with `powercfg /qh`, not `/q`. |

**What the uncapped runs say:** pinned to the twelve, the P-cores ran at about 4.9 GHz. Pinned this way the PC is
only about 1.5× the laptop in Cinebench terms, not 3×, because the laptop's six cores face six P-cores, not the whole
PC. The calibration measures the real ratio.

## Results

"Uncapped" is the PC pinned to the twelve at full clock. It says how the engine behaves, not how fast the laptop is.

| ID | Question | Result so far | Estimated for the work laptop | Work laptop (Phase 36) |
|---|---|---|---|---|
| M1 | Builds on Windows x64, CPU only, no tuning? Size? CPU features? | **Yes.** 7.1 MB of libraries and exe, plus the MSVC runtime and `vcomp140.dll`. Needs AVX2, FMA and F16C, fixed at build time: there is no runtime dispatch, so a CPU without AVX2 would stop on an illegal instruction. The app must check `IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE)` before loading it. *Not run on such a CPU: that needs Intel SDE, a download not approved.* | (the same) | |
| M2 | Speed, memory and load time per words model | Uncapped, 12 threads, 5 min: **Parakeet** whole 33.8 s (9×), in 30 s chunks 13.2 s (23×). **Nemotron 3.5** offline 185.5 s (1.6×), `--stream` 69.4 s (4.3×): out. Parakeet's threads, 30 s chunks: 6 → 17.3×, 8 → 18.0×, 12 → 22.7×. | **Laptop profile, words (8 threads) and speakers (4) in parallel:** 5 min in 28.3 s (**10.6×**); **1 h in 334.1 s (10.8×)**; **3 h in 998.2 s (10.8×)**. One after the other: 1 h at 12 threads 372.6 s (9.7×), at 6 threads 467.4 s (7.7×). **Throttled:** 1 h in 567.1 s (6.35×). Load and warm-up: 0.48 s; **0.87 s straight after a restart** (task 5). | |
| M3 | Word start and end? How far off at 5 min, 1 h, 3 h? | Each word has a start and an end. Chunked words against the engine's own whole-file pass: 90 % within 0.08 s. Against the 37-minute run, repeated into the 3-hour file: 90 % within 0.07 s in the last 10 minutes. **Against ElevenLabs** (the Andrew recording, 34.5 min): median −0.02 s; **99 % of words within 0.5 s**; 90 % within 0.20 s in the first 10 minutes and 0.21 s in the last. | (the same) | |
| M4 | Long recordings: who chunks? Words lost at joins? Memory growth? | The runtime chunks only at the positional limit, full-context, which is slow. **The caller should chunk:** 30 s pieces, 2 s overlap, each piece keeping the words whose middle falls in its own part. Against the whole-file pass: 1.7 % of words differ (5 substitutions, 1 deletion, 7 insertions, mostly at joins; the merge can improve). Words' memory stays at **918 MB** for 5 min, 1 h and 3 h. The CLI's `diarize` grows: 198 MB (5 min), 1.1 GB (1 h), **3.3 GB (3 h)**, because it loads the whole file. **Pushed through the C API's stream in 30 s pieces it stays at 155–162 MB for 3 hours** (40× real time). | (the same) | |
| M5 | Language reported? Switching, outside the list, prompted against `auto`? | Parakeet doesn't report the language (`languages: []`) and takes no prompt. Nemotron 3.5 takes `--language` but is out on speed. Switching and outside the list: *not run (scoped out by the maintainer, 2026-11-14)*. | (the same) | |
| M6 | Speakers model: speed, memory, labels, three hours, a ninth speaker, Setup's number | **Nemotron 3 Diarization** with `v3-offline`: 5 min in 10.8 s on its fixed 4 threads (28×); 3 h in 423 s through the CLI, 269 s through the C API (40×). The default preset is about 10× slower (124.8 s for 5 min). Two speakers found every time. Labels over 3 h (the recording five times over, against the 37-minute labels): **99.7–100 % in every 10-minute window, the same mapping throughout.** **Sortformer v2:** 35.8 s for 5 min, 99.2 % agreement with Nemotron's labels: out. Ninth speaker: *scoped out*. Setup's number of speakers has nothing to map to: the C API ignores `max_speaker_count` and the CLI has no setting. | (the same) | |
| M7 | Combined mode against merging words and segments afterwards | Speaker agreement between them: 99.6 % (5 min). **Merging afterwards is the way** (Phase 34's `mapper.ts`): it lets the words be chunked, which combined mode can't. Against ElevenLabs (Andrew): **98.8 % of words get the same speaker**, 98.5–99.1 % in every 10 minutes. | (the same) | |
| M8 | Inside a 4 GB limit | **Yes, for each process.** 3 h of words in a job limited to 4 GB of committed memory per process (`pinrun --memory-limit-mb 4096`): finished, peak commit 3,370 MB, working set 917 MB, 614.5 s (no slowdown). Peak working set: words 918 MB, speakers 162 MB (C API). But **committed** memory is far higher than what's in use: 3.4 GB for words (5 min to 3 h alike) and 1.6 GB for the speakers. So both in one process would pass 4 GB committed while using about 1.1 GB. The CLI's `diarize` alone reaches 4.8 GB committed at 3 h, so it would fail the limit. **The threshold should be read as the working set (RAM in use), with each model in its own worker under 4 GB committed.** | The same (memory doesn't depend on the clock). In the *Laptop* runs: words 919 MB at every length; speakers through the CLI 200 MB (5 min), 1.1 GB (1 h), 3.3 GB (3 h); through the C API 162 MB at 3 h (part A). | |
| M9 | 8-bit against 16-bit or smaller | *Not run:* only q8_0 is published as GGUF. Another precision needs NeMo-Speech.cpp's Python converter and the `.nemo` checkpoint (2.5 GB), and the result would be a changed model (D2). | | |
| M10 | Cancel | The C API has no cancel call. **Stopping between pushed pieces:** `diar-stream --cancel-after-sec 20` stopped at 840 s of audio; closing the stream and destroying the model took 8.7 ms. **Killing the CLI process** (`stt-bench --cancel-after 20`): gone in 50 ms, with everything freed. A worker process gives Phase 34 both. | | |
| M11 | Other work on 2 of the 12 | | **No measurable effect:** 1 h with `busy` on 2 of the 12 took 333.6 s (10.79×), against 334.1 s without. The words' 8 threads and the speakers' 4 fit on the 10 left. | |
| M12 | Word error rate against ElevenLabs | The Andrew recording (34.5 min, two speakers), against DeScribe's ElevenLabs transcript of it: **18.5 %** as transcribed (13.5 % without "um"/"uh"). With both sides normalised the same way (fillers and backchannels removed, repeats collapsed, gonna/kinda/wanna expanded): **11.3 %**, of which substitutions 1.9 %, deletions 2.0 % and insertions 7.4 %. The insertions are verbatim speech ElevenLabs leaves out ("like", "you know", "I mean", "kind of"); Parakeet keeps "um" (+153), "uh" (+92) and repeated words (114 against 18), writes no digits (no ITN), and drops backchannels ("mm", "hmm", "okay"). **The maintainer read the transcripts (2026-11-15): "the quality looks sufficient … good enough to proceed"**, and suggested a later pass that removes repetitions ("Yeah Yeah") and fillers ("um um"). The first reference used (task 1) was of a different recording, so those comparisons are kept apart in `out/invalid-reference/`. | | |

### Speed and memory, uncapped

The maintainer's test recording (English, two speakers): `tests/audio/test_audio.m4a` (37 min 22 s). The 5-minute,
1-hour and 3-hour files are a cut of it and the recording joined to itself (`make-test-set.mjs`). Words: Parakeet in
30 s chunks with 2 s overlap. Speakers: Nemotron 3 Diarization, `v3-offline`. Both through the CLI. WS = peak
working set; commit = peak private bytes.

| Run | Audio | Total | × real time | Words: s / WS / commit | Speakers: s / WS / commit |
|---|---|---|---|---|---|
| 5 min, words on 12 threads, then speakers | 300 s | 21.2 s | 14.1 | 13.5 s / 915 MB / 3.4 GB | 7.2 s / 198 MB / 1.7 GB |
| 5 min, in parallel (words 8 + speakers 4) | 300 s | 19.4 s | 15.5 | 18.8 s / 914 MB / 3.4 GB | 11.8 s / 198 MB / 1.7 GB |
| 37 min, in parallel | 2,242 s | 142.5 s | 15.7 | 138.2 s / 916 MB / 3.4 GB | 86.9 s / 699 MB / 2.2 GB |
| 1 h, in parallel | 3,600 s | 229.1 s | 15.7 | 222.4 s / 917 MB / 3.4 GB | 140.4 s / 1.1 GB / 2.6 GB |
| 3 h, in parallel | 10,800 s | 686.2 s | 15.7 | 666.7 s / 917 MB / 3.4 GB | 423.0 s / 3.3 GB / 4.8 GB |
| 3 h, speakers through the C API stream | 10,800 s | 268.6 s | 40.2 | | 268.6 s / 162 MB / 1.6 GB |

Decoding is included in "Total" (Media Foundation: 0.6 s for 5 min, 4.1 s for 37 min, 18.8 s for 3 h).

## Decoding (Task 4)

`decode-probe`, against ffmpeg's 16 kHz mono decode. The inputs are the 5-minute cut and ffmpeg conversions of it;
r is the correlation of a 10 s excerpt at the best lag within ±100 ms.

| Format | Media Foundation | symphonia 0.5 (aac, isomp4, mp3, wav, pcm) |
|---|---|---|
| M4A (AAC) | OK, 0.62 s, 22 MB, 16 kHz itself, r = 1.0 | OK, 0.20 s, 9 MB, 48 kHz (needs resampling) |
| MP4 (H.264 + AAC) | OK, 0.66 s, r = 1.0 | OK, 0.20 s, 48 kHz |
| MP3 | OK, 0.45 s, r = 0.997 at a 36 ms lag (MF keeps the encoder delay; ffmpeg trims it) | OK, 0.21 s, 48 kHz |
| WAV (44.1 kHz stereo) | OK, 0.25 s, r = 1.0 | OK, 0.09 s, 44.1 kHz |
| FLAC | OK, 0.26 s, r = 1.0 | fails (no FLAC feature) |
| WebM (Opus) | OK, 0.86 s, r = 0.997 | fails |
| WMA | OK, 0.46 s, r = 1.0 | fails |
| AMR (8 kHz) | OK, 0.99 s, r = 0.9998 | fails |
| **Ogg Opus (`.opus`)** | **fails:** `0xC00D36C4` (MF_E_UNSUPPORTED_BYTESTREAM_TYPE), at `MFCreateSourceReaderFromURL` | fails |
| 3 h MP4 (tone) | 21.5 s, **29 MB** peak working set: constant memory | 4.4 s, 11 MB, 48 kHz |

- **Media Foundation's source reader** converts to 16 kHz mono 16-bit PCM itself when asked (the `SetCurrentMediaType`
  above), in constant memory. It reads every format W6 plays, plus FLAC, WMA, AMR and WebM, with no code to ship or
  licence.
- **Ogg Opus** is the format ElevenLabs takes and Windows doesn't. Its message should name the format and suggest
  ElevenLabs or another format.
- **symphonia** is faster but reads fewer formats, needs a resampler (`rubato`) and adds MPL-2.0 notices.
- **Choice: Media Foundation.**

## From the page to Rust (Task 5)

`ipc-probe` (Tauri 2.12.5, WebView2 156), unpackaged, driven over CDP as Phase 24 did. The page reads the `File` in
slices and sends each with `invoke('upload_chunk', bytes, { headers })`; Rust appends the raw body to a file in the
temporary folder.

| File | Chunks | Result |
|---|---|---|
| 64 MB | 1 MB and 16 MB | 3.0 s each (22 MB/s). Rust's working set: 29–41 MB (1 MB chunks), up to 166 MB (16 MB). |
| 256 MB | 4 MB | **The page dies after about 100 MB.** WebView2's private memory: 196 MB at the start, 469 MB at 32 MB sent, 611 MB at 64 MB, 857 MB at 96 MB. One WebView2 process takes about 4.5 MB per MB sent. A 2 s pause every 32 MB (time for garbage collection) changes nothing, so it's retained, not merely collected late. |
| 1 GB | 1, 4 and 16 MB | The same: the page closes part-way. |

- **Streaming the file through IPC isn't viable for a recording** (a 3-hour MP4 is gigabytes) with this Tauri and
  WebView2. Chunk size doesn't matter, and the leak is in WebView2's processes, not in Rust.
- **Rust needs a path:**
  - Tauri's drag-and-drop event (`tauri://drag-drop`, with `dragDropEnabled: true`) and a native Open dialog
    (`IFileOpenDialog`, on its own STA thread) both give one at once, with no copy and no memory cost.
  - **What it costs:** with `dragDropEnabled: true` WebView2's own HTML drop no longer reaches the page, so the
    desktop build's `FileDrop` changes (Phase 24 turned it off for exactly that). And playback, which plays the `File`
    today, needs another source for a dropped path: Tauri's asset protocol (`convertFileSrc`, an asset scope, and
    `media-src` in the CSP), or the page opens the same path again.
  - Phase 34 decides between them; the path routes themselves were checked by hand only (guide task 6).
- **The temporary copy after a crash:** a partial upload left by an aborted probe was found at the next start and
  deleted in under 1 ms (`temp_leftovers`, `clean_temp`). With a path there is no temporary copy at all, only the
  decoded WAV if the engine wants one, and the C API takes the samples directly, so not even that.

## Downloading the models

| ID | Question | Result |
|---|---|---|
| D1 | Where each file lives, pinned, gated? | [The models](#the-models): NVIDIA's own repositories, the form the runtime reads, not gated. |
| D2 | A copy hosted by Dtype? | **Not needed**, since NVIDIA publishes every chosen file in the form the runtime reads. |
| D3 | Hugging Face's terms and limits for an app without an account | <ul><li>**Rate limits:** `/resolve/` URLs are "Resolvers", and anonymous users get 3,000 per 5-minute window per IP address. The app makes 2 resolver requests per download (one per file), so even many colleagues behind one company IP stay far below it. A refusal is `429`, with `RateLimit` (`"resolvers";r=…;t=<seconds to reset>`) and `RateLimit-Policy` headers; the live check saw `RateLimit-Policy: "fixed window";"resolvers";q=3000;w=300`. Hugging Face recommends `HF_TOKEN`, which an app downloading for its users can't use.</li><li>**Terms** (effective 2022-09-15): nothing on automated access, user agents or rate limits. Content under a licence "is intended to remain under the terms of such license", and access may be suspended "with or without cause".</li><li>**Identifying itself:** nothing required. Phase 35 picks the User-Agent; the spike used `DeScribe-spike/0.1`.</li></ul> |
| D4 | The Store's policies on downloading content after install | Policies 7.20 (2026-09-14). <ul><li>**10.2.2** forbids changing functionality "through any form of dynamic inclusion of code" ("download a remote script and subsequently execute"). The models are data, and the engine ships in the app.</li><li>**10.1.1:** metadata must "accurately describe the functions, features, user experience and any important limitations".</li><li>**10.2.4:** a product "may depend on non-integrated software (such as another product, module, or service) to deliver its primary functionality if you disclose the dependency at the beginning of the description". Local transcription isn't the primary function (ElevenLabs is the default), but the listing should say the speech models are an optional download of about 0.8 GB from Hugging Face.</li><li>**11** counts as content "anything that's delivered from a server or that the product connects to", which 11.2 requires to be licensed (they are).</li><li>**10.1.5** (acquiring other products through the Store) doesn't apply: the models aren't a product.</li></ul> |
| D5 | On the work laptop, with `curl.exe` | Windows' own curl (Schannel), on the company network, 2026-11-15. <ul><li>**huggingface.co** answers `302`, with its own certificate (Amazon), so it isn't inspected.</li><li>**The delivery host `us.aws.cdn.hf.co` is inspected by Cisco Umbrella:** its certificate chain is Cisco Umbrella Secondary SubCA → Primary SubCA → Root CA, installed by the company in Windows' store. The check of whether that certificate has been revoked can't be done there: curl fails with `CRYPT_E_NO_REVOCATION_CHECK (0x80092012)` and gets no data.</li><li>**With `--ssl-revoke-best-effort`** (unknown revocation status allowed, as browsers do): Parakeet's 713,975,456 bytes arrive in 30.3 s (**23.6 MB/s**), through 3 redirects (1 on the maintainer's PC).</li><li>**A Range request isn't honoured:** `-r 0-1048575` returns `200` with the whole 107 MB file. **Resuming doesn't work on this network**, so an interrupted download starts over: `hf-fetch` already treats a `200` to a ranged request that way. A restart costs about 35 s for both files.</li></ul>**For the app:** trust Windows' certificate store, since the inspecting CA is only there (a bundled root list such as rustls' webpki roots would fail); don't fail on an unknown revocation status; rely on the pinned SHA-256 for integrity, since an inspecting proxy can't alter the file unseen; don't count on resuming. |
| D6 | The HTTP stack | <ul><li>`hf-fetch`, both stacks, on the 107 MB diarization file. **WinHTTP:** 48.5 MB/s. **reqwest (native-tls):** 56.5 MB/s.</li><li>Both follow `302 huggingface.co → 200 us.aws.cdn.hf.co` (a signed Xet-bridge URL), and both resume with `Range` (`206` from the CDN) after an interruption at 50 MB. Hash time 0.05–0.06 s per 107 MB from cache (about 0.6 s/GB; `fetch-models.mjs`: 1.1 s for 714 MB).</li><li>**Recommended: WinHTTP**, which ships with Windows. It uses Windows' proxy settings, PAC/WPAD included, through `WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY`, and Windows' certificate store, as `curl.exe` (Schannel) did on the laptop. reqwest uses the same store but not PAC, and adds a crate. To confirm against D5.</li></ul> |
| D7 | Where the files live; uninstall, update, memory-mapping, free space | <ul><li>**Unpackaged** (`describe-stt-probe --d7 --write`): 1 GB written in 0.44–0.49 s and read memory-mapped in 0.28–0.32 s in the temporary, LocalCache and LocalState stand-ins.</li><li>**Packaged** as `DeScribe.SttProbe` (task 6): its folders are `%LOCALAPPDATA%\Packages\DeScribe.SttProbe_<id>\{TempState,LocalCache,LocalState}`. 1 GB written in 0.44–0.47 s and memory-mapped back in 0.29–0.30 s in each. **Kept across the update to 2.0.0.0** (the files and 1.0.0.0's marker were there), and **removed with the package on uninstall** (`Test-Path` of the package folder: `False`).</li><li>**Choice: LocalCache.** It isn't backed up or roamed, it survives updates, uninstalling removes it, and the engine can map the files from it.</li></ul> |
| D8 | Interruptions: network, sleep, closing | <ul><li>**A closed window** (task 7, step 3): 611 MB left in `.part`; the next run resumed from byte 640,679,936 and finished with the right hash.</li><li>**The network turned off** (task 7's first run): WinHTTP ended the download with `timeout` (12002) after 44 s, and a restart while the network was still down failed at once with `dns` (12007).</li><li>Resuming after the network came back, and the sleep step: *not run*. The download (5 MB/s cap added afterwards) finished before the interruption on this PC's fast connection. The guide's `-Steps 1,2` can still run them; on the company network resuming doesn't work anyway (D5).</li></ul> |
| D9 | Failures the user must be able to tell apart | Every one comes out as its own kind on both stacks (`test-server.mjs` and real hosts):<ul><li>a block page with 200 `text/html` → `not-the-file`;</li><li>a block page sent as a file → `not-the-file`, on the size;</li><li>403 and 451 → `blocked`;</li><li>429 → `rate-limited` with `Retry-After`;</li><li>a cut connection → `connection-dropped`, keeping the `.part` file to resume (WinHTTP reports a cut as the end of the body, so the size check is what catches it);</li><li>a redirect to plain HTTP → `insecure-redirect`;</li><li>a wrong hash → `hash-mismatch`;</li><li>no such host → `dns` (WinHTTP 12007);</li><li>an untrusted certificate (`self-signed.badssl.com`) → `tls` (WinHTTP 12175);</li><li>disk full → `disk-full` (simulated; Windows reports `ERROR_DISK_FULL`, 112).</li></ul> |

## Go/no-go

**Provisional go, at the target** (2026-11-15; DECISIONS.md D51), **agreed with the maintainer** the same day. It
holds until Phase 36's run on the work laptop confirms or corrects it.

| | Goal on the laptop | Measured under emulation | Result |
|---|---|---|---|
| Speed | An hour in 10 min (target), 15 min at most (floor) | Target ≥ 9×, floor ≥ 6× in *Laptop*; ≥ 2× in *Throttled* | **10.8×** for 1 h and 3 h in *Laptop* (an hour in 5.6 min); **6.35×** in *Throttled* (an hour in 9.5 min). **Target met.** |
| Memory | Under 4 GB at the peak, 3 h included | The same | **Met with the C API's stream for the speakers:** working set 919 MB (words) and 162 MB (speakers) at 3 h. Each worker under a 4 GB commit limit (3.4 GB and 1.6 GB). Through the CLI the speakers reach 3.3 GB at 3 h: not the way to ship. Committed memory is about 3× the working set, so the threshold is read as the working set. |
| Size | Download ≤ 1.5 GB; MSIX +40 MB at most | The same | **821 MB**; the engine adds 7.1 MB plus the MSVC runtime and `vcomp140.dll` (about 2 MB in NVIDIA's zip). The MSIX itself isn't measured until Phase 34. |
| Accuracy | Usable without ElevenLabs (EN, DE, FR; scoped to English) | WER against ElevenLabs | **The maintainer: sufficient.** 4 % of words misheard (1.9 % substituted, 2.0 % missed); 11.3 % normalised, 18.5 % as transcribed (verbatim speech). German and French are first checked on the laptop (Phase 36, L4). |
| Speakers | The two-speaker interview right but for slips | The same | **98.8 %** of words agree with ElevenLabs; labels held for 3 hours (99.7 %+ per 10 minutes against the repeated recording). |
| Times | Clicking a turn plays from the right place | Words within 0.5 s at the start and the end | **99 %** within 0.5 s (Andrew), in the first and the last 10 minutes alike; 3 h checked against the repeated recording. |
| The laptop | Usable meanwhile; 3 h without collapsing from heat; on battery | Can't be measured | Other work on 2 of 12 processors: no effect. *Throttled* (battery, heat) still at 6.35×. **The laptop itself: Phase 36.** |

**What makes it provisional:**
- The emulation's two benchmarks disagree. Cinebench R23 is matched to the laptop; 2024 is below it, which errs on
  the slow side.
- The laptop's DDR5, AVX-512 and smaller cache can't be copied here.
- The words were measured through the CLI. Phase 34 calls the C API (`asr.h`) and must check it is as fast.

**If the laptop turns out slower than estimated** (Phase 36), in this order:
1. **An engine built with AVX-512.** The laptop's Zen 4 cores have it and this build leaves it out, because it can't
   be tested on the PC. It means a second engine build, or ggml's runtime CPU variants (`GGML_BACKEND_DL`,
   `GGML_CPU_ALL_VARIANTS`), which cost a few MB and a test on the laptop.
2. **Threads.** The words run on the C API's default of 8 and the speakers on a fixed 4. The 12 threads used one
   after the other were slower here (9.7×), but the laptop may differ. A thread setting needs a small patch to
   NeMo-Speech.cpp's C API or its C++ API, and the patch has to be carried forward.
3. **A lighter precision.** Only q8_0 is published. Anything smaller means converting from `.nemo` with NVIDIA's
   Python tools and hosting the copy ourselves (D2): licence notices, the changes stated, and accuracy measured again.
4. **Steer long recordings to ElevenLabs.** For example, past an hour, say on Setup that This computer will be slow.
   It costs nothing to build, but it's a limit users see.

Nemotron 3.5 ASR and Sortformer v2 are not on this list: both were slower.

## As built (Phase 34)

DECISIONS.md D53; the app's commands and debug switches in [desktop.md](desktop.md#transcribing-on-this-computer-phase-34).

- **The engine** is the build Phase 33 benchmarked, defined by `src-tauri/stt-runtime.json` and assembled by
  `npm run desktop:stt-runtime` into `src-tauri/stt-runtime/`: five engine DLLs plus the MSVC 14.44 and OpenMP
  runtimes, 6.7 MB.
- **The worker** is `describe.exe --stt-worker`. It runs both models at once in one process, fed by one Media
  Foundation decoder in 5 s blocks:
  - words in 30 s pieces with 2 s overlap (`stt/chunks.rs`);
  - speakers pushed 30 s at a time into the `v3-offline` stream.
- **C API settings, from its source:** `gpu: -1`; word times and punctuation turned on (the defaults are zeroed, and
  then the text comes back lower-case and unpunctuated); word times are int32 milliseconds.
- **The speed check** (E9), pinned to `0xfff0` at full clock, so it compares with the uncapped rows above:

  | File | Phase 34 (one worker, the C API) | Phase 33 (two CLI processes) | Peak commit | GPU |
  |---|---|---|---|---|
  | 5 min | 18.8 s | 19.4 s | 4.9 GB | 0.0 % |
  | 1 h | 224.6 s (16.0×) | 229.1 s (15.7×) | 4.9 GB | 0.0 % |

  So the C API's words are as fast as the CLI's, which D51 left open. One process is as fast as two.
- **In the app** (E1, debug exe), the 5-minute recording took 16.9 s in the engine, with peak RAM 1.09 GB.
- **The merge:** each word goes to the speaker with the most overlap, else the nearest segment. A lone word follows
  the speaker on both sides, unless its own segment holds most of it.
  - *Not yet measured:* agreement with and without that smoothing on the Andrew recording.
- **The clean-up:** drops um, umm, uh, uhh, erm, äh, ähm, öhm and euh, and keeps once a word one speaker repeats
  ("that that" and "had had" excepted). On by default.
- **The *Laptop* profile** (E6; the release exe's worker, the schemes recreated by `setup-emulation.ps1` with the
  calibrated caps):

  | File | Phase 34 | Phase 33's harness | × real time |
  |---|---|---|---|
  | 1 h | 328.3 s | 334.1 s | 11.0 |
  | 3 h | 972.6 s | 998.2 s | 11.1 |

  - The app is 2–3 % faster than the harness: within the 15 % the acceptance allows, and inside the target (an hour
    in 400 s).
  - Word times at the end of the 3-hour file match the first copy: 1,533 of 1,644 words paired, all within 0.5 s.
  - Phase 36's laptop column is still to run.

### Non-ASCII paths (audit DES-1)

The models live under the user's profile, so a user name such as "Søren Müller" puts ø and ü in their paths. `c_path`
(`stt/nemo.rs`) passes them as UTF-8.

- **The engine's source** (NeMo-Speech.cpp `20999cc`, llama.cpp `bd4f514`):
  - The words model (`asr/model.cpp`) and the speakers model (`asr/diar/sortformer_model.cpp`) both load through
    `GGUFLoader`, so through `ggml_fopen` (UTF-8 → `MultiByteToWideChar(CP_UTF8)` → `_wfopen`).
  - The memory map uses the open file's handle, not the path.
- **The engine's narrow opens** (`fopen`, `std::ifstream` from a `char` path) are all in features DeScribe doesn't
  use:
  - the CLI's WAV reader;
  - the ITN grammar folder (`postproc` is null);
  - the profanity list and the YAML config;
  - the SALM encoder lookup, which needs a `nemo_speech.speech_model` key that neither model's header has.
- **The DLLs' imports agree:** `nemo_speech_asr.dll` takes `ggml_fopen` from `ggml-base.dll`, which imports `_wfopen`.
- **The recording** is opened by Media Foundation, and **the DLLs** by `LoadLibraryExW`, both wide. The paths reach
  the worker as JSON.
- **The test:** `run::tests::model_paths_with_non_ascii_letters_load` (opt-in, `--ignored`) links both models into
  `%TEMP%\describe-Søren-Müller-æøå-<pid>\`, with the recording beside them as `opptak-ø.wav`, and transcribes.
  - It passes on the maintainer's PC (ANSI code page 1252, so a narrow open would have failed).
  - With `c_path` changed to replace non-ASCII letters, as a lossy ANSI conversion would, it fails with "Failed to
    load GGML file".
- **No `activeCodePage` manifest:** nothing needs it, and it would change the whole process's ANSI behaviour.

## The download as built (Phase 35)

DECISIONS.md D54; the commands, folders and debug switches in [desktop.md](desktop.md#the-speech-models-download-phase-35).

- **`src-tauri/src/stt/download.rs`** is `hf-fetch`'s WinHTTP stack made into app code:
  - `WinHttpOpen` with `WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY`, user agent `DeScribe/<version>`; timeouts 30 s to
    resolve, connect and send, 60 s with nothing received. No revocation check.
  - Redirects disabled in WinHTTP and followed by hand, up to 10, HTTPS only. The first URL must be the pinned one.
  - Each file to `<file>.part`; `Range: bytes=<part>-` when a part is there. A `206` must carry
    `Content-Range: bytes <part>-…/<size>`, else the part is dropped (`blocked`); a `200` starts the file again.
  - The size on offer, then the size received, then the SHA-256, and only then the file's name and its receipt entry.
  - **A synchronous `WinHttpReadData` waits until its whole buffer is full,** so the first build's progress moved a
    megabyte at a time and Cancel kept only whole megabytes. The reader asks `WinHttpQueryDataAvailable` first and
    reads what has arrived.
  - Cancel sets a flag and closes the request handle, so a read that waits returns at once (`cargo test`: a stalled
    server, cancelled after 0.4 s).
  - Free space checked first: the files still to fetch plus 100 MB.
- **What a detail says:** the file, the status and each hop's host (`words.gguf: HTTP 403 (huggingface.co 302 →
  us.aws.cdn.hf.co 403)`), never a signed URL; folders as `<speech-pack>` or `%USERPROFILE%`.
- **Tests:** `src-tauri/src/stt/download_tests.rs`, against a small HTTP server in the test on 127.0.0.1: a whole
  download, a redirect, resume, a server ignoring Range, a bad Content-Range, wrong sizes both ways, a wrong hash, a
  web page, every status, a cut connection, nothing listening, cancel, a full disk, a file that can't be written
  (`write`, not `disk`), a skipped verified file, a damaged and an outdated pack, an unpinned URL, progress as bytes
  arrive.

| ID | Check | Maintainer's PC | Work laptop (from the Store) |
|---|---|---|---|
| S1 | A fresh install: Settings says the models are missing, with the size. **Download** runs to *installed*. Record the time and the speed. **On the work laptop this proves the download works on its network.** | **The agent, against the stand-in:** missing with "8 MB from huggingface.co"; Download ran to *installed* with both files and the receipt. *The real download: the maintainer.* | **Pass (the maintainer, 2026-11-17, 1.3.0):** the models downloaded on the company network, and transcribing with them worked. Time and speed not recorded. |
| S2 | During a download: leave Settings and come back; the progress is still there. **Cancel**, then **Download** again: it carries on. | **Pass (the agent, stand-in at 400 kB/s):** "926 kB of 8 MB", Back to Home and Settings again, "1 MB of 8 MB" with Cancel; Cancel kept 1,966,080 bytes in `words.gguf.part`; Download again asked `Range: bytes=1966080-` and finished. *With Hugging Face: the maintainer.* | *not run* |
| S3 | The network cable out mid-download, the PC put to sleep, the app closed (it asks first), then resumed each time. No partial file is ever loaded. | *The maintainer.* A cut connection (the stand-in's `drop`) ends in "Couldn't reach huggingface.co", the part kept and the pack still *missing*. | |
| S4 | Failures, each with its own message: the host blocked, a full disk, a model file altered on disk, a URL that answers 404. | **The agent, stand-in:** 403, an HTML page and a redirect to plain HTTP → "Your network didn't allow…"; 404 → "…can't download its speech models any more"; 429 → "Hugging Face is busy" (detail: `Retry-After 120`); one byte altered → "didn't arrive intact"; a cut → "Couldn't reach…". Each with Technical details and the button again; no file named. A file altered on disk after a download: *damaged*, **Download again** → *installed*. Full disk: `cargo test` only. *The `hosts` file, a firewall rule and a small virtual disk: the maintainer.* | |
| S5 | **Remove:** the files are gone and the disk space is back; Setup offers no choice (Phase 36); ElevenLabs still works. | **Pass (the agent):** confirmation first; the pack folder gone. *Disk space and ElevenLabs: the maintainer.* | *not run* |
| S6 | Restart the app: *installed* at once, without hashing again. | **Pass (the agent):** *installed* 67 ms after opening Settings. | *not run* |
| S7 | Update to a build with the same list: still installed. To one with a different list: *outdated*, and the old files go once the new ones are in. | *The maintainer* (`cargo test` covers both). | |
| S8 | Uninstall: the models' folder is gone (record where it was). | *The maintainer.* | *not run* |
| S9 | Network panel and a capture of the app's connections during a download: only `huggingface.co` and its redirect hosts, and the three API hosts. Nothing at launch. | **The agent, stand-in:** no request to it at launch; the page's 29 requests all to the app itself and IPC. *A capture of Rust's connections to Hugging Face: the maintainer.* | |
| S10 | The Windows App Certification Kit on the build. | *The maintainer.* | |

## The work laptop's numbers (Phase 36, L9)

The first real measurement (Phase 36's Task 1). On the work laptop, with the 1.3.0 build from the Store and the models
downloaded in Settings. Each run's numbers are in Settings → **Transcribe on this computer**: the *Last recording*
line, and **Timings** under it. Settings keeps only the last run, so write each one down before the next.

Recordings: `scripts/spikes/local-stt/out/test-set/test_audio.1h.m4a` and `test_audio.3h.m4a`, copied to the laptop.

| Run | Phase 33's estimate | Last recording | Speed | Reading the audio | Words | Speakers | Total | Threads | Peak memory | Fans, heat, other apps, sleep |
|---|---|---|---|---|---|---|---|---|---|---|
| 37 min (`test_audio.m4a`), plugged in, Balanced, other apps open (2026-11-17) | 208 s (*Laptop*, 10.8×) | 00:37:22 in 00:05:14 | 7.1× | – | – | – | 314 s | – | – | Timings not copied. The first run after the download. |
| 37 min, plugged in, Balanced, every other app closed (2026-11-17) | 208 s (*Laptop*, 10.8×) | 00:37:22 in 00:05:01 | 7.4× | 9.0 s | 301.4 s | 297.0 s | 301.4 s | 8 | 1.11 GB | Fans and heat not noted. |
| 1 h, plugged in | 334 s (*Laptop*) | | | | | | | | | |
| 3 h, plugged in | 998 s (*Laptop*) | | | | | | | | | |
| 1 h, on battery | 567 s (*Throttled*) | | | | | | | | | |
| 1 h, during a Teams call with Edge open | – | | | | | | | | | |

**What the 37-minute runs say** (2026-11-17):
- **At the target, plugged in:** 7.4× real time, so an hour in about 8.1 minutes (the target is 10, the floor 15).
  Peak memory 1.11 GB, as on the PC (1.09 GB in Phase 34's E1). D51's list of changes isn't needed.
- **The emulation was 1.45× too fast:** *Laptop* estimated 10.8×, the laptop did 7.4×, and *Throttled* is 6.35×. The
  laptop lies between the two profiles, nearer *Throttled*. Pinned at full clock, the PC is 2.1× the laptop on this
  work (15.7× in Phase 33's 37-minute row), against 1.37–1.62× in Cinebench: Cinebench was a poor stand-in. Phase 33's
  margin of half again (9× emulated for 6× real) was used almost exactly.
- **Recalibrate against the engine, not Cinebench:** find the cap at which the release worker, pinned to `0xfff0`,
  takes about 301 s on `test_audio.m4a`. It lies above *Throttled*'s 1,950 MHz and below 3,375. *Not done yet.*
- **The words set the pace.** Words and Speakers in Timings are each the time from the start until that model
  finished, not the time it worked. The worker's decoder feeds both through queues of 8 blocks of 5 s
  (`stt/run.rs`), so the speakers can't run more than about 40 s of audio ahead of the words, and finish just before
  them. 297.0 s therefore says nothing of the speakers' own speed.
- **Other apps cost little:** closing everything gained 4 % (314 s to 301 s), as M11's two busy processors suggested.
- **Balanced is the number to quote,** since colleagues mostly run in it. A run in Best performance would show
  whether the laptop's power limit holds it back: *not run*.
- **Still to run:** the 3-hour file (heat over about 24 minutes), the 1-hour file on battery (the riskiest: if battery
  costs what *Throttled* suggests, about 4.3×, an hour in about 14 minutes), and the 1-hour file during a Teams call.

- **At the target** (an hour in 10 minutes or less, under 4 GB): carry on.
- **10 to 15 minutes:** carry on; the texts promise no more than the number.
- **Past 15 minutes or 4 GB:** D51's list goes to the maintainer with what each costs. The feature ships either way
  (D55).
- **In every case:** correct the emulation's caps from the real numbers (`calibrate.ps1`), and record the new caps
  here.

## On the graphics card (Phase 37, Task 1)

*2026-11-20, the agent, on the maintainer's PC.* NVIDIA's prebuilt v0.3.0 Vulkan release, run through its CLI on the
RTX 2070 SUPER, the UHD 770 and the processor. **Not pinned and not capped:** these numbers describe the cards, not the
work laptop (G9 measures the laptop). Scripts: `scripts/spikes/local-stt/run-gpu.ps1` (the runs) and
`summarize-gpu.mjs` (the table, `out/gpu/summary.md`). The harness gained `pinrun --profile unpinned` (no affinity;
GPU engine use and `GPU Process Memory(*)` per adapter; the job's CPU time) and `stt-bench --device`/`--concurrency`.

### The release

| | |
|---|---|
| Zip | `nemo-speech-0.3.0-windows-x86_64-vulkan.zip`, 22,417,032 bytes, SHA-256 `72b3b8b41bfe2be0320eff4e9d310594e4f99deefcde4a157799a039656963ce`: matches its `.sha256` and GitHub's digest. In `vendor/nemo-speech-0.3.0-windows-x86_64-vulkan/` (gitignored); file list in `out/vulkan-zip.json`. |
| Beside it | The CPU zip again (`4ed9740e…5b05`, matches), for NVIDIA's patched-ggml baseline and its exports. |
| Files | The CPU zip's, plus **`ggml-vulkan.dll` 44,272,128 bytes**. `ggml-base.dll` 673,280 and `ggml-cpu.dll` 976,896 (stock ggml) against the CPU zip's 692,736 and 947,200 (patched). The full release also carries `llama*.dll`, `nemo_speech_speechlm/nmt/tts.dll`, `concrt140.dll` and the `msvcp140_*` extras, which DeScribe's own `-Profile asr` build doesn't need. |
| **Imports** (`dumpbin /dependents`, `out/vulkan-dumpbin.txt`) | `ggml.dll` → `ggml-cpu.dll`, **`ggml-vulkan.dll`**, `ggml-base.dll`. `ggml-vulkan.dll` → `ggml-base.dll`, **`vulkan-1.dll`**. `nemo_speech_asr.dll` → `ggml.dll`, `ggml-base.dll`, `dbghelp.dll`. **Decision 1's chain holds:** without `vulkan-1.dll` the whole engine fails to load. The CPU zip's `ggml.dll` imports no Vulkan. |
| **Exports** (`dumpbin /exports`) | **Split across two DLLs.** `ggml.dll` exports the registry: `ggml_backend_dev_count`, `ggml_backend_dev_get`, `_by_name`, `_by_type`, `ggml_backend_reg_count` and the like. **`ggml-base.dll`** exports the device's accessors: `ggml_backend_dev_type`, `_description`, `_memory`, `_name`, `_get_props`. The CPU build's `ggml.dll` exports the same registry functions. So decision 2's probe takes the count and devices from `ggml.dll` and their details from `ggml-base.dll`. |

### The devices

`vulkaninfo` (instance 1.4.341) and `nemo-speech --json doctor` (`out/vulkan-doctor.json`) agree:

| ggml / CLI index | `doctor` name, type | Description (decision 5's name) | Driver | Vulkan `deviceLUID` | PDH LUID | Memory (`doctor`) |
|---|---|---|---|---|---|---|
| 0 | `Vulkan0`, `gpu` | NVIDIA GeForce RTX 2070 SUPER | 617.14, Vulkan 1.4.351 | `12790100-00000000` | `0x00000000_0x00017912` | 7.8 GB free of 8.6 |
| 1 | `Vulkan1`, `integrated-gpu` | Intel(R) UHD Graphics 770 | 101.6129, Vulkan 1.3.295 | `ce8b0100-00000000` | `0x00000000_0x00018BCE` | 50.5 GB "free" of 34.2: the driver reports shared memory oddly |
| 2 | `CPU`, `cpu` | 13th Gen Intel(R) Core(TM) i7-13700K | – | – | – | – |

- Both cards offer `VK_KHR_shader_integer_dot_product`, and the RTX also offers `VK_KHR_cooperative_matrix`.
- The UHD 770 has one heap (31.9 GB, the system's RAM) and a 4 GB `maxMemoryAllocationSize`.
- **The device is chosen with `--device vulkan:N`** (alias `--backend`; also `auto`, `cpu`, `cuda[:N]`, `metal`), on
  `transcribe` and on `diarize` alike. There is no `--gpu N`. `N` counts GPU and integrated-GPU devices in ggml's order,
  as `backend.cpp` does, which is also `doctor`'s order.
- The words log names its backend (`[asr] … backend=Vulkan0`). `diarize` names none, but its run on the card shows
  159 MB of the card's memory and is 5× faster, so **the speakers model runs on the card too.**

### Results

The 5-minute cut and the 37-minute recording, as in Phase 33. Parakeet and Nemotron 3 Diarization from `.speech-pack/`,
`v3-offline`, 8 threads.
- **pipeline:** words in 30 s chunks with 2 s overlap, beside the speakers in their own process (the app's shape).
- **c1:** the same, with `--concurrency 1`. One chunk at a time, as the app's worker sends them.
- **combined:** `transcribe --diar-model` on the whole file, which is full-context.

WS = peak working set; commit = peak private bytes. "Differs" is against the processor's run of the same recording and
mode (`compare.mjs`).

| Run | Total | × real time | Words: s / WS / commit | Encoder / decoder (summed over chunks) | Speakers: s / WS | CPU (logical processors busy) | Card: engine max / mean, memory | Differs from the processor |
|---|---|---|---|---|---|---|---|---|
| Processor, NVIDIA's CPU zip (patched ggml), 5 min pipeline | 19.4 s | 15.5 | 18.8 s / 921 MB / 3.4 GB | 17.7 / 18.2 s | 11.3 s / 204 MB | 10.0 | – | 0 % against the Vulkan zip's processor run |
| Processor, Vulkan zip (stock ggml), 5 min pipeline | 22.0 s | 13.6 | 21.4 s / 955 MB / 3.4 GB | 20.1 / 20.5 s | 11.0 s / 237 MB | 9.5 | – | (reference) |
| Processor, Vulkan zip, 37 min pipeline | 156.4 s | 14.3 | 150.8 s / 958 MB / 3.4 GB | 145.7 / 149.3 s | 78.4 s / 738 MB | 9.5 | – | (reference) |
| Processor, Vulkan zip, 5 min / 37 min combined | 41.1 / 288.2 s | 7.3 / 7.8 | – / 3.5 / 5.6 GB | – | – | 7.5 | – | (reference) |
| **RTX 2070 SUPER, 5 min c1** | 3.5 s | **85.7** | 2.9 s / 198 MB / 7.1 GB | 1.1 / 2.0 s | 1.0 s / 181 MB | 1.1 | 28 % / 14 %, 967 MB dedicated | 0.26 % (1 substitution, 1 insertion) |
| **RTX 2070 SUPER, 37 min c1** | 21.9 s | **102.5** | 17.6 s / 447 MB / 7.8 GB | 8.1 / 16.1 s | 4.6 s / 762 MB | 1.7 | 68 % / 28 %, 1.44 GB dedicated, 117 MB shared | 0.09 % (2 sub., 3 ins.) |
| RTX 2070 SUPER, 5 min combined | 4.6 s | 65.7 | – / 430 MB / 12.2 GB | 2.1 / 2.8 s | – | 0.9 | 45 % / 20 %, 4.39 GB dedicated | 0.13 %; speakers 100 % |
| RTX 2070 SUPER, 37 min combined | **failed** after 4.8 s | – | – | – | – | – | 7.49 GB dedicated | `ErrorOutOfDeviceMemory`: full context on 37 min doesn't fit in 8 GB |
| **UHD 770, 5 min c1** | 29.4 s | **10.2** | 28.8 s / 1.13 GB / 7.1 GB | 23.4 / 26.2 s | 9.2 s / 277 MB | 0.4 | 102 % / 87 %, 1.15 GB shared | 0.26 % (1 sub., 1 ins.) |
| **UHD 770, 37 min c1** | 217.0 s | **10.3** | 212.7 s / 1.13 GB / 7.1 GB | 156.6 / 211.1 s | 57.1 s / 856 MB | 0.4 | 120 % / 94 %, 1.13 GB shared | 0.12 % (5 sub., 2 ins.) |
| UHD 770, 5 min / 37 min combined | 43.8 / 417.9 s | 6.8 / 5.4 | – / 5.9 / 7.8 GB | 345 / 361 s (37 min) | – | 0.4 / 2.0 | 100 %, 4.2 / 4.0 GB shared | 0 % / 0.09 %; speakers 100 % / 99.9 % |
| RTX 2070 SUPER, pipeline (batched) | 5 min 7.7 s (cold), 4.2 s (warm); 37 min **crashed** | – | – | – | – | – | – | 37 min: `GGML_ASSERT(ne3 == ne13)`, exit `0xC0000409`, 12 of 81 chunks unwritten and **38 empty** |
| UHD 770, pipeline (batched) | 5 min 32.3 / 28.5 s; 37 min **crashed** | – | – | – | – | – | – | 5 min: **2 of 11 chunks empty with exit 0**, cold and warm alike. 37 min: the same assert, 55 unwritten, 4 empty |

**Load time** (from the start to `[asr] mode=`, words model):
- the processor: 0.5–0.6 s;
- **the RTX: 8.0 s the very first time** (the pipelines are built), 3.7 s the next cold run, then 0.7 s;
- **the UHD 770: 6.1 s the first time**, then 0.8–2.4 s.

The first run after an install or a driver update pays this once.

**What it says:**
- **Both cards transcribe both models, one chunk at a time, correctly.** The words differ from the processor's by
  0.1–0.3 %. Speaker labels agree on 99.9–100 % of words. The transcripts read the same (checked by eye in
  `out/transcripts/`).
- **Batching several chunks on a card is broken in v0.3.0, on both vendors.** The CLI batches a folder's files ("batches
  compatible GPU steps"). On a card the batch either hits the assert of upstream issues #48 and #89 and kills the
  process, or **silently returns empty words for both chunks of a pair, with exit 0.** One at a time it never happened
  (81 chunks on each card). The app's worker sends one chunk at a time through the C API, so it should be safe. **Task 3
  must keep it so,** and check it on the real worker (see the Handoff).
- **Whole-file full context runs out of memory on the RTX at 37 minutes** (8 GB). The app never sends a whole file to the
  words model (M4's 30 s chunks), so this affects only the CLI.
- **Speed:**
  - the **RTX 2070 SUPER is 7× the processor** (102× real time against 14.3×);
  - the **UHD 770 is 0.7×** (10.3×). It's slower than this PC's twelve processors, but leaves the processor almost
    idle: 0.4 logical processors busy against 9.5.
  - On the UHD 770 the **decoder outweighs the encoder** (211 s against 157 s): the token-by-token TDT decoder is the
    integrated card's weak point, as the research feared for the 740M. G9 says what the laptop does.
- **Stock ggml on the processor is 13 % slower** than NVIDIA's patched CPU build (22.0 s against 19.4 s for 5 minutes).
  That confirms decision 1's reason for keeping the processor engine as it is.
- **Memory:**
  - Working set on the cards is at or below the processor's for words (0.2–1.1 GB). On the UHD 770 add its
    1.1–1.2 GB of shared memory, which is the same RAM.
  - **Committed memory roughly doubles** for the words process: 7.1–7.8 GB against 3.4 GB, from the Vulkan backend's
    host-visible buffers. D51 reads the 4 GB threshold as RAM in use, which this meets, but a worker with a commit limit
    (M8) would need it raised.
- **`GGML_VK_PREFER_HOST_MEMORY` wasn't needed:** both models loaded on the UHD 770 without it (decision 9).

## As built (Phase 37)

DECISIONS.md D58; the commands, debug switches and G checks in
[desktop.md](desktop.md#on-the-graphics-card-phase-37).

- **Two engines** from the same source and commit, both in `src-tauri/stt-runtime.json` and built by
  `npm run desktop:stt-runtime`:

  | | Processor | Vulkan |
  |---|---|---|
  | Folder | `stt-runtime/`, beside `describe.exe` | `stt-runtime/vulkan/`, `vulkan\` beside the exe |
  | ggml | NVIDIA's patched (`NEMO_SPEECH_GGML_PATCHED=ON`) | stock, as NVIDIA builds Vulkan |
  | Files | five engine DLLs plus the MSVC and OpenMP runtimes, 6.7 MB | the same plus `ggml-vulkan.dll` (44.3 MB), 48.9 MB |
  | Imports | nothing of Vulkan's | `ggml.dll` → `ggml-vulkan.dll` → `vulkan-1.dll` (the driver's, never shipped) |
  | Needs to build | MSVC 14.44, vcpkg | also the LunarG Vulkan SDK 1.4.363.0 |

  The processor files are still Phase 33's, byte for byte. The MSIX is 21.1 MB with both, 5.5 MB without the Vulkan
  one (desktop.md).
- **Finding the cards:** `describe.exe --stt-worker --devices <dir>` loads the Vulkan engine, lists ggml's devices of
  type GPU and integrated GPU (`ggml_backend_dev_count`/`_get` from `ggml.dll`, `_type`/`_description`/`_memory` from
  `ggml-base.dll`) and prints one JSON line. A card is named by its description, or "Graphics card N" (its place among
  the cards) when the driver gives none (audit GPU-5). It took 0.23–0.44 s here. Rust ends it after 15 s, and anything going wrong
  gives an empty list.
- **A run on a card:** the job names it as `{ name, nth }`. The worker finds its index among the GPU and
  integrated-GPU devices, in ggml's order, and passes it to both models' `gpu` field.
  - A card that isn't there, or a Vulkan engine that won't load, sends `device-missing` before any work, and Rust runs
    the same job on the processor engine. Its `reason` says which, with no path: "the Vulkan engine found only …" (or
    "found no graphics card"), or "the Vulkan engine didn't load: …". It goes into the run's timings as `fellBack`
    (audit GPU-3).
  - A card that is there sends `device-found` first. Rust waits 15 s for one or the other, as for the probe. After
    that it ends the worker without waiting for it, runs the job on the processor, and skips the cards until the app
    restarts (audit GPU-2).
  - **The two models load one at a time on a card.** Loading both at once aborted with `vkCreateFence: Invalid
    device` (`0xC0000409`): `ggml_vk_get_device` creates a card's device on first use, with no lock. After loading
    they share the device and run on their two threads.
  - **One words call at a time, never batched:** batching chunks on a card crashes or silently returns empty words in
    v0.3.0 ([Task 1](#on-the-graphics-card-phase-37-task-1)).
- **The app's worker on the PC** (Task 3; debug exe, unpinned, uncapped; `run-worker-gpu.ps1`,
  `check-worker-gpu.mjs`, `out/worker-gpu/summary.md`). "Differ" and "agree" are against the processor's run of the
  same file.

  | File | Processor (8 threads) | RTX 2070 SUPER | UHD 770 |
  |---|---|---|---|
  | 5 min | 17.4 s (17.3×) | 8.0 s (37.5×) | 29.5 s (10.2×) |
  | 37 min (three runs on each card) | 125.9 s (17.8×) | 16.2–16.4 s (137–139×) | 209.1–210.0 s (10.7×) |
  | 1 h | 201.9 s (17.8×) | 25.8 s (139.8×) | 335.2 s (10.7×) |
  | Words differ / speakers agree | (reference) | 0.15–0.26 % / 99.97–100 % | 0.19–0.26 % / 99.95–100 % |
  | Logical processors busy | 10.7–11.0 | 1.9–2.6 | 1.1 |
  | Peak commit | 4.9 GB | 9.0–9.4 GB | 8.7 GB |
  | The card's memory, engine use | – | 1.1–1.6 GB dedicated, about 0.1 GB shared; 42–54 % max | 1.1 GB shared; 100 % |

  - **No empty 30 s window** in any run on a card, the silent failure Task 1 found when batching.
  - **Cancel** during a 37-minute run on each card: the worker ended in 80–133 ms, the card's memory was back by the
    next sample, and the next run finished (`cancel-worker-gpu.ps1`).
  - **The first load on a card** takes 6–8 s while its pipelines are built, then under 1 s. Each install or driver
    update pays it once.
  - **Committed memory roughly doubles on a card,** from the Vulkan backend's host-visible buffers. RAM in use doesn't,
    so D51's 4 GB, read as RAM in use, still holds. The worker has no commit limit, and mustn't be given one.
  - On the UHD 770 the processor is almost idle, but the card is slower than this PC's processor. Whether the work
    laptop's Radeon 740M is faster than its processor is G9's to measure. D58 ships it either way.

## The work laptop on its graphics card (Phase 37, G9)

On the work laptop, with the Store build that has Phase 37 and the models downloaded. In Settings, choose **Run on:
AMD Radeon 740M Graphics** (the name as the driver gives it), then copy each run's *Last recording* line and
**Timings**, as for [L9](#the-work-laptops-numbers-phase-36-l9). Task Manager's *Performance* tab shows whether the card
is busy and the processor mostly free.

| Run | L9 on the processor | Last recording | Speed | Reading the audio | Words | Speakers | Total | Ran on | Peak memory | The card busy? Fans, heat, other apps |
|---|---|---|---|---|---|---|---|---|---|---|
| 37 min (`test_audio.m4a`), plugged in, Balanced | 301 s (7.4×) | | | | | | | | | |
| 1 h, plugged in | | | | | | | | | | |
| 3 h, plugged in | | | | | | | | | | |
| 1 h, on battery | | | | | | | | | | |
| 1 h, during a Teams call with Edge open | | | | | | | | | | |

*Not run yet:* it needs the Store build with Phase 37 on the laptop. It's measured, not a gate (D58).

## Verification log

| Date | Where | What | Result |
|---|---|---|---|
| 2026-11-14 | Maintainer's PC, Hugging Face API | `/api/models/<repo>` and `/tree/<revision>` for the four repos | Not gated; sizes and LFS SHA-256 as in [the models](#the-models). |
| 2026-11-14 | Maintainer's PC | `fetch-models.mjs` | 1.71 GB in under 30 s, via `us.aws.cdn.hf.co`; every size and hash matched. |
| 2026-11-14 | Maintainer's PC | `build-runtime.ps1` | Failed to link (MSVC 14.38 against vcpkg's 14.44); passed with `VCVARS_USER_VERSION`. |
| 2026-11-14 | Maintainer's PC, pinned `0xfff0`, uncapped | `stt-bench` on 30 s, 5 min, 37 min, 1 h, 3 h; Nemotron 3.5; Sortformer v2; presets; chunk sizes; threads | As in [results](#results). GPU 0.0 % in every run. |
| 2026-11-15 | Maintainer's PC, pinned, uncapped | `diar-stream` (C API) on 3 h | 268.6 s, 155–162 MB working set throughout. |
| 2026-11-15 | Maintainer's PC | `decode-probe` (MF, symphonia) on 9 formats and a 3 h MP4 | As in [decoding](#decoding-task-4). |
| 2026-11-15 | Maintainer's PC | `hf-fetch` (WinHTTP, reqwest) against Hugging Face and `test-server.mjs` | As in D6 and D9. |
| 2026-11-15 | Maintainer's PC, unpackaged | `describe-stt-probe --d7 --write` | As in D7; the test files were deleted afterwards. |
| 2026-11-15 | Maintainer's PC, `ipc-probe` over CDP | Upload of 64 MB, 256 MB and 1 GB through raw IPC bodies | 64 MB in 3.0 s; past about 100 MB the page dies (see [Task 5](#from-the-page-to-rust-task-5)). |
| 2026-11-15 | Maintainer's PC, pinned, uncapped | `diar-stream --cancel-after-sec 20`; `stt-bench --cancel-after 20`; 3 h of words in a 4 GB job | As in M8 and M10. |
| 2026-11-15 | Maintainer's PC, pinned, uncapped | Cinebench R23 multi-core through `pinrun --capture-console` | 16,307 (the laptop: 10,036), so 1.62×. Cinebench prints only to an attached console, so `pinrun` runs it on a pseudo console. |
| 2026-11-15 | Maintainer's PC, pinned, uncapped | `calibrate.ps1 -DryRun` (no scheme change); `run-benchmarks.ps1 -DryRun` | 2024 multi 763.4, R23 multi 16,263, 2024 single 114.0 (948 s), R23 single 1,958: all read from the pseudo console. The benchmark dry run made its three 5-minute runs and `summary.md`. Without the schemes, both scripts refuse to start. |
| 2026-11-15 | Maintainer's PC, the maintainer | `setup-emulation.ps1`; `calibrate.ps1` for both profiles | As in [the emulated laptop](#the-emulated-laptop). |
| 2026-11-15 | Maintainer's PC, *Laptop* and *Throttled* profiles, the maintainer | `run-benchmarks.ps1` and, after a restart, `-ColdLoad` | As in M2, M8 and M11. GPU 0.0 % in every run. |
| 2026-11-15 | Maintainer's PC, the maintainer | `DeScribe.SttProbe` 1.0.0.0 and 2.0.0.0, installed, updated and uninstalled | As in D7. |
| 2026-11-15 | Maintainer's PC, the maintainer | `interrupt-download.ps1` | As in D8. |
| 2026-11-15 | Work laptop, company network, the maintainer | `curl.exe`, then with `--ssl-revoke-best-effort` | As in D5. |
| 2026-11-15 | Maintainer's PC | The Andrew recording (34.5 min), the pipeline, against DeScribe's ElevenLabs transcript | As in M3, M7 and M12. The maintainer read the transcripts: sufficient. |
| 2026-11-15 | Maintainer's PC, pinned `0xfff0`, uncapped (the agent) | Phase 34's worker, `--job`, on the 5-minute and 1-hour files | 18.8 s and 224.6 s; GPU 0.0 %. |
| 2026-11-15 | Maintainer's PC, debug exe over CDP (the agent) | E1–E5, E8 | As in desktop.md's E rows. |
| 2026-11-15 | Maintainer's PC, *Laptop* profile (the maintainer switched the scheme) | E6: the release worker on 1 h and 3 h | 328.3 s and 972.6 s; GPU 0.0 %. |
| 2026-11-15 | Maintainer's PC | `ipc-probe/pack.ps1` | `DeScribe.SttProbe` 1.0.0.0 and 2.0.0.0, 2.7 MB each, signed with a new `devcert.pfx` (gitignored, not trusted yet: guide task 6). |
| 2026-11-16 | Maintainer's PC, debug exe over CDP, `speech-pack-test-server.mjs` (the agent) | Phase 35's S1, S2, S4, S5, S6, S9 | As in [the S table](#the-download-as-built-phase-35). No console errors. |
| 2026-11-17 | Work laptop, 1.3.0 from the Store, company network, the maintainer | Download speech models in Settings; then `test_audio.m4a` (37 min 22 s) twice, plugged in, Balanced | The download worked (S1). 314 s (7.1×), then 301 s (7.4×) with every other app closed. As in [the laptop's numbers](#the-work-laptops-numbers-phase-36-l9). |
| 2026-11-19 | Maintainer's PC, ANSI code page 1252 (the agent) | `model_paths_with_non_ascii_letters_load`: both models and the recording in `describe-Søren-Müller-æøå-<pid>\`; then with `c_path` mangling non-ASCII letters | Passes (0.7 s); the mangled path fails with "Failed to load GGML file". As in [non-ASCII paths](#non-ascii-paths-audit-des-1). |
| 2026-11-20 | Maintainer's PC (the agent) | `winget install KhronosGroup.VulkanSDK` | Not run: the agent's permission check refused it. The maintainer installs it before Task 2. |
| 2026-11-20 | Maintainer's PC (the agent) | `vulkaninfo`; the v0.3.0 Vulkan and CPU zips downloaded and hashed; `dumpbin /dependents` and `/exports`; `nemo-speech --json doctor`, `help transcribe`, `help diarize` | As in [on the graphics card](#on-the-graphics-card-phase-37-task-1). |
| 2026-11-20 | Maintainer's PC, unpinned, uncapped (the agent) | `run-gpu.ps1`: 5 min and 37 min on the processor, the RTX 2070 SUPER and the UHD 770, pipeline (batched and `--concurrency 1`) and combined; `compare.mjs` against the processor | As in [on the graphics card](#on-the-graphics-card-phase-37-task-1). Batched chunks on a card crash or come back empty; one at a time, both cards match the processor. Each card's use showed on its own LUID only; processor runs showed none. |
| 2026-11-20 | Maintainer's PC, unpinned, uncapped, debug `describe.exe` (the agent) | Phase 37, Task 3: `cargo test -- --ignored on_a_card` (`DESCRIBE_STT_TEST_GPU` 0 and 1) and `on_the_processor`; `run-worker-gpu.ps1` (the app's worker: 5 min, 37 min ×3 and 1 h on each card, and the processor), `check-worker-gpu.mjs`; `cancel-worker-gpu.ps1` | The first card run aborted (`vkCreateFence: Invalid device`, `0xC0000409`): the two models created the card's device at once. With the loads one at a time, every run finished. 37 min in 16.2–16.4 s on the RTX (137×) and 209–210 s on the UHD 770 (10.7×), against 125.9 s on the processor (17.8×). 1 h in 25.8 s, 335.2 s and 201.9 s. 0.15–0.26 % of words differ, speakers agree on 99.95–100 %, no empty 30 s windows. Peak commit 8.7–9.4 GB on a card (4.9 GB on the processor); the RTX used 1.1–1.6 GB of its own memory, the UHD 770 1.1 GB shared. Cancel: the worker ended in 80–133 ms, its card memory was back by the next sample, and the next run finished. |
