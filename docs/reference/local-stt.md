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
- **The *Laptop* profile** (E6) and Phase 36's laptop column are still to run.

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
| 2026-11-15 | Maintainer's PC | `ipc-probe/pack.ps1` | `DeScribe.SttProbe` 1.0.0.0 and 2.0.0.0, 2.7 MB each, signed with a new `devcert.pfx` (gitignored, not trusted yet: guide task 6). |
