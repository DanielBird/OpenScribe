# Phase 33 — Spike: local speech models, and downloading them

**Goal:** find out whether the desktop app can transcribe a recording on the work laptop itself, with speaker labels
and word times, using NVIDIA's open speech models, and how the app gets those models onto the computer by
downloading them from Hugging Face. Record the facts in a new reference doc, choose the models and the runtime, and give a go/no-go for
Phases 34–36. No changes to `src/` or to the shipped app in this phase.

**Status of the plan:** asked for by the maintainer on 2026-11-14 (DECISIONS.md **D50**). Written from desk research
on the same day: nothing below has been run. Every fact in *Already known* has a source; treat the rest as
assumptions for this phase to check.

**The work laptop can't run the benchmarks** (the maintainer, 2026-11-14). Every measurement in this phase is made
on the maintainer's PC, held back to behave like the laptop ([the emulated laptop](#the-emulated-laptop)). So this
phase's go is an **estimate**. The first real numbers come when the app is installed on the laptop from the Store
and has downloaded the models, in Phase 36.

**Depends on:** Phase 24 (the desktop app and its MSIX). Start from `main`, on a branch `phase-33-local-stt-spike`.

**Read first:**
- [DECISIONS.md](../DECISIONS.md) D2, D11, D18, D35, D36, D38, D40, T3, T17 and D50;
- [reference/desktop.md](../reference/desktop.md), all of it;
- [10-folder-spike.md](10-folder-spike.md) and [reference/file-system-access.md](../reference/file-system-access.md),
  for the shape of a spike and of a reference doc with a verification log;
- the sources in *Already known*. Follow the official docs and model cards, and don't guess (AGENTS.md, *External
  APIs*). The models and their runtimes changed several times in 2026, so read each card again on the day.

## What the maintainer asked for (D50)

1. The desktop app can transcribe with speaker labels **on the computer**, with NVIDIA models, as an alternative to
   ElevenLabs. The HTML file doesn't change.
2. The models are **optional**: the app stays small, and those who want local transcription get the models
   separately. First asked for as an optional package in the Microsoft Store; changed by the maintainer the same day
   to a **download from Hugging Face, made by the app** (below).
3. With the models downloaded, the user **chooses** local or ElevenLabs. That there is one model for the words and
   another for the speakers is **hidden**: the user sees one thing.
4. The benchmark is the work laptop: **AMD Ryzen 5 PRO 215 with Radeon 740M graphics, 32 GB of RAM**. Trade off
   install size, memory and what the models can do. The laptop itself can't be used for benchmarks, so the
   maintainer's PC stands in for it, set up to match it as closely as possible. That PC's dedicated GPU must play no
   part.
5. **About** says which NVIDIA models are used and under which licences.

## Already known (2026-11-14, desk research)

### The work laptop

- Ryzen 5 PRO 215: 6 cores (2 Zen 4, 4 Zen 4c), 12 threads, 15–30 W. Radeon 740M integrated graphics (RDNA 3), which
  shares the system's RAM. **No NPU.**
  ([Notebookcheck](https://www.notebookcheck.net/AMD-Ryzen-5-PRO-215-Processor-Benchmarks-and-Specs.1154700.0.html))
- Instruction sets, as Notebookcheck lists them: AVX2, FMA3 and AVX-512. 16 MB of L3 cache. DDR5-5600 or
  LPDDR5x-7500 memory. *Not confirmed:* AVX-VNNI (Zen 4 is believed to have only the AVX-512 form), and whether the
  laptop's memory is one module or two.
- Published scores, from two ThinkPads (an L16 Gen 2 at 30 W and a T16 Gen 5): **Cinebench 2024** 101 single and
  **557 multi**; **Cinebench R23** 1,713 single and **10,036 multi**. These are what the emulation is calibrated
  against.
- The Radeon 740M can't be measured, so **the first release runs on the CPU only.**

### The maintainer's PC, which stands in for it (read 2026-11-14)

- Intel Core i7-13700K: 8 P-cores with hyper-threading and 8 E-cores, 24 threads. AVX2 and AVX-VNNI, no AVX-512.
  30 MB of L3 cache. A desktop: no battery, and no power or heat limit like a laptop's.
- 64 GB of DDR4 in four modules, reported at 2,667 MHz.
- Two GPUs: an **NVIDIA GeForce RTX 2070 SUPER** (dedicated) and the processor's Intel UHD Graphics 770.
- Unrestricted, it is roughly three times the laptop in Cinebench multi-core. Nothing measured on it unrestricted
  says anything about the laptop.

### Candidate models

Words (speech to text):

| Model | Licence | Languages | Notes |
|---|---|---|---|
| [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | CC-BY-4.0 | 25 European, detected automatically | 600M parameters. Offline. Punctuation and capitals; word and segment times. The card says 24 min of audio with full attention and 3 h with local attention, on a large GPU: long recordings need chunking. The card doesn't say that the detected language is returned. |
| [Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b) | OpenMDW-1.1 (check the card) | 40+ locales, prompted or `auto` | Cache-aware streaming, also runs on whole files. The default model of NVIDIA's own runtime. Card not read yet. |
| [Nemotron Labs Unified ASR 0.6B](https://huggingface.co/nvidia/nemotron-labs-unified-asr-0.6b) | OpenMDW-1.1 | The same 25 as Parakeet v3, prompted or `auto` | Released late October 2026. Its card reports a lower English word error rate offline than Parakeet v3 (4.68 against 4.93). Word times and runtimes other than NeMo aren't stated. |

Not candidates: Canary 1B v2 (a billion parameters and an attention decoder: too slow on a CPU) and the speech LLMs.

Speakers (diarization):

| Model | Licence | Speakers | Notes |
|---|---|---|---|
| [Nemotron 3 Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization) | OpenMDW-1.1 | 8 | 100M parameters, 10 ms frames. Chunked, so no limit on length. Much lower error rates than Sortformer v2.1 on meeting data in its card. Trained mostly on English, Mandarin and Indian languages. |
| [Streaming Sortformer 4spk v2.1](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1) | NVIDIA Open Model License | 4 | 117M parameters, 80 ms frames. Gets worse with five or more speakers. v2's licence is reported as CC-BY-4.0 by third parties; unconfirmed. |

All take 16 kHz mono audio. None has keyterms: **the glossary can't steer local transcription.** ElevenLabs allows 32
speakers and 3 GB or 10 h per file; locally it is 8 speakers at most.

### Candidate runtimes

| Runtime | What it is | For | Against |
|---|---|---|---|
| [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) | NVIDIA's own C++ runtime, on ggml. Apache-2.0. | Runs Parakeet TDT v3, Nemotron 3.5 and both diarization models, alone or combined. Windows builds; CPU and Vulkan backends; a C SDK (headers, shared libraries) in the release archives. NVIDIA publishes 8-bit GGUF files, so nothing has to be converted. | Young (37 commits when read). Reads PCM WAV only. Word times in its output, its speed on a laptop CPU and its memory use aren't documented. A fork's README claims about 6× real time on an unnamed CPU for a streaming model: unverified. |
| ONNX Runtime from Rust (the [`ort`](https://ort.pyke.io/) crate, or [`parakeet-rs`](https://docs.rs/crate/parakeet-rs) on top of it) | Microsoft's runtime, with community ONNX exports of the models. | Mature runtime. `parakeet-rs` (MIT OR Apache-2.0) does Parakeet TDT and Sortformer v2/v2.1 with times. DirectML for the GPU. | The model files are third-party conversions ([Nemotron 3 Diarization's](https://huggingface.co/onnx-community/Nemotron-3-Diarization-ONNX) included), so their provenance and licences need checking one by one. `parakeet-rs` notes a 4–5 minute limit per call for TDT, and doesn't list Nemotron 3 Diarization. |

**Size, estimated:** a 600M-parameter model at 8 bits is about 640 MB, and the diarization model 100–400 MB depending
on its precision. So the download is roughly **0.8–1.1 GB**. Memory while running is unknown; expect a few GB.

### Getting the models onto the computer

**Decided by the maintainer (2026-11-14): the app downloads the models itself, from Hugging Face.** The first plan
was an optional package in the Microsoft Store. It was dropped because submitting one needs Microsoft's permission
("To submit an app that uses optional packages and/or related sets to the Microsoft Store, you will need
permission", [Optional packages and related set authoring](https://learn.microsoft.com/windows/msix/package/optional-packages)),
and nothing recent shows an app that isn't a game getting it. D50 lists what else wasn't chosen.

- **Checked on the work laptop** (the maintainer, 2026-11-14): `curl.exe` in a terminal downloads model files from
  Hugging Face. Which file, and which hosts it was sent on to, wasn't recorded; D5 below records them.
- Hugging Face serves a file at `https://huggingface.co/<repo>/resolve/<revision>/<file>`. The revision can be a
  commit hash, so a URL can name exact bytes that never change.
- That address answers with a redirect to a delivery host, and those hosts have changed several times
  (`cdn-lfs*.hf.co`, `cas-bridge.xethub.hf.co`, `us.aws.cdn.hf.co` and more, going by
  [Hugging Face's forum](https://discuss.huggingface.co/t/how-to-get-a-list-of-all-huggingface-download-redirections-to-whitelist/30486)).
  So the app can't keep a list of them. It follows redirects over HTTPS and trusts each file's **hash**, not the
  host it came from.
- Company networks often filter Hugging Face: by category, by leaving out the delivery hosts, or by breaking large
  downloads when they inspect encrypted traffic. It works on the maintainer's work laptop. It may not for every
  colleague, so a blocked download needs a clear message.
- *Not known:* whether NVIDIA publishes each chosen model in the form the runtime reads (NeMo-Speech.cpp "pulls"
  8-bit GGUF files from Hugging Face, but the research didn't find the repositories); whether any is gated behind a
  login; Hugging Face's limits and terms for an app that downloads on its users' behalf; and what the Store's
  policies say about an app that downloads content after it is installed. The models are data, not code: the engine
  ships in the app.

### The licences

- **CC-BY-4.0** (Parakeet TDT v3): give credit, link the licence, and say if the material was changed (a conversion
  or quantization is a change).
- **OpenMDW-1.1** ([text](https://openmdw.ai/license/1-1/)): a distribution keeps a copy of the agreement and the
  notices of origin that came with the model. No restriction on use or on the output.
- **NVIDIA Open Model License** (Sortformer v2.1): not read yet. Read it before choosing that model.
- **Who distributes matters.** If the app downloads NVIDIA's own files from NVIDIA's repository, NVIDIA is the one
  distributing them, and DeScribe credits them and shows their licences in About. If Dtype hosts a copy (D2 below),
  Dtype distributes it, and the copy itself must carry the licence and notices.
- This is the planning agent's reading, not legal advice. **The maintainer confirms it before the download ships.**

## Who does what

1. **The agent** builds the harness and the download prototype (Tasks 1–6), runs them on the maintainer's PC, and
   writes the reference doc.
2. **The maintainer** runs the `curl.exe` checks on the work laptop (D5). They supply the recordings, switch the PC's power scheme for the benchmark runs and back again (the agent doesn't change
   system settings), and judge the transcripts.
3. **The agent** writes up the results, the choices and the go/no-go (Tasks 7–8).

## To decide before starting (the maintainer)

1. **Recordings for the benchmark** (never committed, and never sent anywhere by the harness): English, German and
   French; an interview with two speakers and a meeting with five or more; one of about 5 minutes, one of about an
   hour and one of about three hours. For each, an ElevenLabs transcript from DeScribe as the reference.
2. **The thresholds below.** They are a proposal.
3. **The emulation below,** and in particular its margin.

**Decided 2026-11-14:** the app installed from the Store may transcribe real recordings on the work laptop. That is
the only place the estimate gets checked (Phase 36's timing checkpoint).

## Proposed thresholds for "go"

The goal is for the work laptop, plugged in. The right-hand column is what has to be measured on the maintainer's PC
for the goal to be believed.

| | Goal on the laptop | Measured under emulation |
|---|---|---|
| Speed | An hour of audio is transcribed and labelled, start to finish, on the CPU alone. **Target: 10 minutes** (6× real time). **Floor: 15 minutes** (4× real time); slower is a no-go. Set by the maintainer on 2026-11-14. | Each with a margin of half again, in the *Laptop* profile. **Target: 9× real time** (an hour in 6 min 40 s). **Floor: 6× real time** (an hour in 10 minutes). At least **2× real time** in the *Throttled* profile. |
| Memory | The transcribing process stays under 4 GB at its peak, for the three-hour recording too. | The same number, measured directly: memory use doesn't depend on the CPU's speed. One run also completes inside a 4 GB limit. |
| Size | The download is 1.5 GB or less. The main MSIX grows by 40 MB or less. | The same, measured directly. |
| Accuracy | The maintainer finds the English, German and French transcripts usable without ElevenLabs. | The same: the output doesn't depend on the machine. Record the word error rate against the ElevenLabs transcript for each. |
| Speakers | The two-speaker interview is labelled correctly but for brief slips. | The same. Record what happens with five or more. |
| Times | Clicking a turn plays from the right place. | Word times within half a second, at the end of the three-hour recording as well as the start. |
| The laptop | It stays usable for other work during a run, a three-hour recording doesn't collapse from heat, and it works on battery. | **Can't be measured here.** The margin and the *Throttled* profile stand in for it until Phase 36's run on the laptop. |

**Speed is what the choices turn on.** Between the floor and the target the answer is go, and the write-up says
what would close the gap. Published figures (2026-11-14; none from this laptop, and all for ONNX Runtime) put the
words model at about 18× real time on a desktop i7-12700K, and community claims put the Sortformer family at 20–40×
on 12–24 cores. The two steps run one after the other, so on the laptop the target is plausible and not assured:

- The speakers step is the least documented and roughly doubles the work. Measure it first.
- NeMo-Speech.cpp's speed on a CPU is undocumented. If it is slower than ONNX Runtime, that decides the runtime.

## The emulated laptop

Every timing in this phase is taken in one of two profiles on the maintainer's PC. Record the profile with each
number; a number without one doesn't count.

**What both profiles fix:**

1. **No GPU.** The harness is built with the CPU backend only: no CUDA and no Vulkan compiled in, so the RTX 2070
   SUPER can't be used even by accident. Confirm it once by watching both GPUs' usage during a run.
2. **Only instructions the laptop has.** Build for AVX2, FMA and F16C, with AVX-VNNI and native tuning off (no
   `-march=native`, no `GGML_NATIVE`). The i7 lacks AVX-512, which the laptop has, so this errs on the slow side.
   The same binary would then run on the laptop. Record the build flags.
3. **Six cores, twelve threads.** The harness is pinned to twelve logical processors: six P-cores with both their
   hyper-threads, which is the laptop's shape. Find them from the efficiency class Windows reports
   (`GetLogicalProcessorInformationEx`); don't assume they are numbers 0–11. Pin with `start /affinity` or
   `ProcessorAffinity`, so child processes inherit it.
4. **The thread counts that could ship:** 6 and 12. Never 24.
5. **A capped clock,** from a power scheme made for this (below).

**The two profiles differ only in the cap:**

| Profile | Calibrated so that, pinned as above, | Stands for |
|---|---|---|
| *Laptop* | Cinebench 2024 multi-core is about **557** and Cinebench R23 multi-core about **10,036** (within 5 %). | The work laptop, plugged in. |
| *Throttled* | Both are about **60 %** of that (about 335 and 6,000). | The laptop on battery, hot, or held to 15 W. |

**Calibrating** (the maintainer makes and switches the power scheme; these are system settings):

1. Copy the Balanced scheme as "DeScribe laptop emulation" (`powercfg /duplicatescheme`). The PC's own scheme isn't
   edited, and switching back undoes everything.
2. In the copy, set the hidden **maximum processor frequency** for mains power: `PROCFREQMAX` and its
   efficiency-class-1 twin `PROCFREQMAX1`, in MHz
   ([Microsoft's reference](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/options-for-perf-state-engine-maxfrequency)).
   Sources disagree on which of the two governs P-cores on a hybrid Intel processor, so set both and check the
   P-cores' clock under load in Task Manager.
3. Run both Cinebench versions pinned to the twelve logical processors, and move the cap until the multi-core scores
   match. Start near 3,000 MHz. Record the cap in MHz for each profile, the scores reached, and the single-core
   scores that result (the laptop's are 101 and 1,713; they needn't match, but record the gap).
4. If the board ignores the frequency cap, use a job object's hard CPU rate cap on the harness instead, calibrated
   the same way, and say so in the reference doc.
5. Switch back to Balanced after every session. Check the scores again at the start of each session: a Windows or
   BIOS update can change what the cap does.

**What the emulation can't copy**, and the margin is there for:

- **Memory speed.** Model inference leans on it. The PC has DDR4 at 2,667 MHz; the laptop DDR5 at up to 5,600, but
  possibly as a single module. It could go either way.
- **Cache:** 30 MB of L3 here against 16 MB.
- **Heat and power limits** over a long run, and **battery**.
- **Other work on the laptop** (Teams, Edge, a virus scanner) competing for the same six cores.
- **Different cores.** Matching Cinebench matches a rendering workload, not this one. The laptop's AVX-512 may help
  it; nothing here can show that.

If the maintainer can ever run one published benchmark on the laptop itself, or a colleague has the same model,
replace the Notebookcheck scores with that number and calibrate again.

## Tasks

1. **Prerequisites and calibration.** List what the harness needs beyond Phase 24's tools (CMake, …) with versions,
   as Phase 24's Task 1 did, plus Cinebench 2024 and R23. With the maintainer, make the power scheme and calibrate
   both profiles ([the emulated laptop](#the-emulated-laptop)) before any timing is taken.
2. **The harness: `scripts/spikes/local-stt/`.** A small command-line program, not part of the app:
   `<recording> --asr <model> --diar <model> --threads n` writes one JSON file with the words (text, start, end,
   confidence if there is one), the speaker segments, the language if the model reports one, and the timings (load,
   decode, words, speakers, total) and peak memory.
   - CPU only, built as the emulated laptop requires. It writes into the JSON the logical processors it was pinned
     to, its thread count, the active power scheme's name and the processor's clock during the run, and it refuses
     to report a timing as a laptop estimate when it wasn't pinned to twelve.
   - A wrapper script runs it in a named profile (pinning it, and checking that the emulation scheme is active), so
     no one has to remember the affinity mask.
   - Build it once per runtime that is still a candidate. Start with NeMo-Speech.cpp and its published GGUF files.
     Build the ONNX Runtime one if NeMo-Speech.cpp fails a question below **or misses the speed target**: the
     faster runtime wins, other things being equal.
   - Model files go in a gitignored folder, fetched by a script with pinned URLs and SHA-256 hashes. Record each
     file's size and hash.
   - It makes no network requests when it runs.
3. **Questions the harness must answer**, each a row in the reference doc:

   | ID | Question |
   |---|---|
   | M1 | Does the runtime build and run on Windows x64 with MSVC, CPU only and without native tuning, and how big are its libraries? Which CPU features does it need, and what does it do on a CPU without them? |
   | M2 | Per words model: speed, peak memory and load time in the *Laptop* profile, for the three lengths, at 6 and 12 threads. The one-hour recording in the *Throttled* profile too. Load time once straight after a restart, when nothing is cached. |
   | M3 | Does the output have a start and end per word? How far off are they at 5 minutes, 1 hour and 3 hours? |
   | M4 | Long recordings: does the runtime chunk a three-hour file itself, or must the caller? Are words lost or doubled at the joins? Does memory grow with length? |
   | M5 | Language: is the detected language reported? What happens to a recording that switches language, and to a language outside the model's list? Does prompting the language (where the model takes one) beat `auto`? |
   | M6 | Per speakers model: speed and memory; the labels on the interview and on the meeting; whether a speaker keeps their label across three hours; what a ninth speaker does (or a fifth, for Sortformer). Does the optional number of speakers on Setup have anything to map to? |
   | M7 | Words to speakers: with the runtime's combined mode if it has one, and with words and segments merged afterwards (each word to the speaker with the most overlap). Which reads better at speaker changes and in overlapping speech? |
   | M8 | Memory under pressure: the three-hour recording inside a job object limited to 4 GB. Does it finish, and does it slow down? |
   | M9 | Precision: 8-bit against 16-bit files, for size, speed and accuracy. Is anything smaller than 8 bits still accurate? |
   | M10 | A run cancelled part-way: how quickly does it stop and free its memory? |
   | M11 | Other work at the same time: the one-hour recording in the *Laptop* profile while a second program keeps two of the twelve logical processors busy. How much slower is it? |
   | M12 | Word error rate against the ElevenLabs transcript, per language and model, from a small script (lowercase, punctuation removed). |

4. **Audio decoding.** The models take 16 kHz mono PCM; users choose MP3, M4A, MP4 and WAV files, up to gigabytes.
   Find the way to get there that copes with a three-hour MP4 in constant memory:
   - Windows' Media Foundation source reader from Rust (the `windows` crate the app already uses): no new code to
     ship or licence, and it reads what Windows plays;
   - or a Rust decoder such as `symphonia` (MPL-2.0), which is simpler to call but adds licence notices and may not
     read every file.

   Decoding in the web view isn't a candidate: `decodeAudioData` needs the whole file in memory. Check each against
   the same MP3, M4A, MP4 and WAV files as W6, plus one file ElevenLabs accepts and the decoder doesn't, to see the
   error.
5. **From the page to Rust.** The page has a `File` with no path. Measure the candidates on a 1 GB file:
   - the page streams the file to Rust in chunks through Tauri's IPC (raw request bodies), into a temporary file in
     the package's `TemporaryFolder`;
   - Tauri's own file drop and a native Open dialog give Rust a path, at the cost of changing `FileDrop` in the
     desktop build and of playback, which today plays the `File`.

   Record the time, the memory in both processes, and what cleaning up the temporary copy takes (after the run, and
   at the next start after a crash).
6. **Downloading the models.** Build a small prototype of the downloader beside the harness (not in the app), and
   answer:

   | ID | Question |
   |---|---|
   | D1 | Where does each chosen model file live? Is it in NVIDIA's own Hugging Face repository in the form the runtime reads? Record the URL pinned to a commit, the size and the SHA-256. Is the repository gated (a login or an accepted licence before download)? A gated file can't be used. |
   | D2 | If NVIDIA doesn't publish a file in that form: a converted copy has to be hosted by Dtype (a Hugging Face repository, or a GitHub release). Dtype then distributes the model, so the copy carries the licence and notices, and says what was changed. The maintainer decides whether to do that or choose another model or runtime. |
   | D3 | Hugging Face's terms and limits for an app that downloads files for its users without an account: what they allow, what a refusal for too many requests looks like, and how the app should identify itself. |
   | D4 | The Store's current policies on an app that downloads content after installation, and what the listing has to say about it. Quote the policy text. |
   | D5 | **On the work laptop, by the maintainer, with `curl.exe` only:** for each real file's pinned URL, the status, the hosts it is redirected through (`-L -v`), the speed and total time, whether a ranged request resumes (`-r`), and whether a proxy or an inspected certificate is in the path (the certificate's issuer in `-v`). Nothing is installed or built there. |
   | D6 | The HTTP stack for Rust. Windows' own (WinRT's `HttpClient` or WinHTTP, through the `windows` crate the app already has) uses Windows' certificate store and proxy settings and adds no crate; `reqwest` is simpler to write. On the maintainer's PC: redirects, resuming with a range, progress, cancel, and a gigabyte without holding it in memory. Choose the one that will behave like `curl.exe` did on the laptop in D5; it can't be tried there before Phase 35's Store build. |
   | D7 | Where the files live. In the installed app, the package's `LocalCache` or `LocalState` folder (T17): are they removed on uninstall, kept across an app update, and readable memory-mapped? Check with a test-identity package on the maintainer's PC, as Phase 24 did. Disk use, and the free space to ask for before starting. |
   | D8 | Interruptions: the network drops, the PC sleeps, the app is closed, the disk fills. What is left behind, and does the download carry on from where it stopped? How long does hashing a gigabyte take? |
   | D9 | Failures the user must be able to tell apart: blocked by the network, offline, refused for too many requests, disk full, a file that doesn't match its hash. A filter's block page can arrive as an ordinary page with status 200, so check that the size and hash catch it. |

7. **`docs/reference/local-stt.md`,** in the style of the other reference docs: the models and their licences as
   read on the day (with the licence sentences quoted), the runtime, the emulation (the PC, the build flags, the
   pinned processors, each profile's cap and the Cinebench scores it reached, so a later agent can set it up again),
   the M and D tables with each result's profile, the decoding and transfer findings, each model file's pinned URL,
   size and hash, and a verification log. Head the timings **"Estimated for the work laptop"**, and leave a
   column for the laptop's real numbers, which Phase 36 fills in.
8. **The choices and the go/no-go,** in the reference doc and in a DECISIONS entry that completes D50:
   - the words model and the speakers model, and their file precision;
   - the runtime, and whether it runs inside `describe.exe` or as a separate worker process started by it (a worker
     keeps a crash in native code away from the user's unsaved edits, frees all its memory when it exits, and
     makes Cancel a matter of ending it);
   - the thread count to ship, from the 6 and 12 measured (CPU only is already decided: the laptop's GPU can't be
     measured);
   - how audio is decoded and how the recording reaches Rust;
   - where each model file is downloaded from (NVIDIA's repository, or a copy Dtype hosts), the HTTP stack, and
     where the files are kept;
   - the limits to show users: languages, speakers, length;
   - what to change first if the laptop turns out slower than estimated (fewer or more threads, a smaller
     precision, the other words model), with what each costs, so Phase 36 doesn't start from nothing;
   - then update the tasks of Phases 34–36 to match, and say what changed in their *Handoff* sections.

   The go is **provisional**: it holds until Phase 36's run on the laptop confirms or corrects it.

## Recommendation to test first

So the phase starts from something definite: **Parakeet TDT 0.6B v3 for the words and Nemotron 3 Diarization for the
speakers, in NeMo-Speech.cpp with NVIDIA's own 8-bit GGUF files, on the CPU, as a worker process.** It is one runtime
from the models' maker, two permissive licences, 25 languages with English, German and French among them, and 8
speakers. Nemotron 3.5 ASR is the first alternative for the words (more languages, and the runtime's default), and
ONNX Runtime the alternative runtime.

## Acceptance criteria

- [ ] Both profiles are calibrated against the laptop's published Cinebench scores, and the reference doc has
      enough to set them up again.
- [ ] Every M and D row has a result, or *not run* with the reason. Every timing names its profile, was taken
      pinned to twelve logical processors with a CPU-only build, and neither GPU was used.
- [ ] The PC's own power scheme is active again, and unchanged.
- [ ] Each chosen model file has a pinned URL, a size and a hash, isn't gated, and D5 has results from the work
      laptop.
- [ ] `docs/reference/local-stt.md` exists with the facts, the licence sentences and the verification log.
- [ ] A provisional go/no-go against the emulated thresholds, agreed with the maintainer, and the DECISIONS entry.
      It says whether the speed reached the target or only the floor, and if only the floor, what would close the
      gap.
- [ ] Phases 34–36 are updated where the findings change them.
- [ ] Nothing in `src/`, `src-tauri/` or the shipped builds changed. `npm run typecheck`, `npm run lint` and
      `npm test` still pass, and no recording, transcript or model file is committed.

## Out of scope

- Any change to the app: Phases 34–36.
- Live transcription from the microphone, though the streaming models could do it.
- Any GPU. The Radeon 740M can't be measured, the PC's Intel UHD 770 is a different and weaker GPU with another
  driver, and the RTX 2070 SUPER is nothing like either. A GPU path would need a laptop to measure it on.
- Running the harness, or any development build, on the work laptop.
- ARM64, and machines without the benchmark's CPU features (record what happens; don't fix it).
- Local translation or summaries. Claude and Gemini stay as they are.
- Fine-tuning, word boosting, or anything that changes a model.

## Handoff

*(The choices, the emulation as set up and the numbers per profile, the download findings, and what Phases 34–36
must change.)*
