# Phase 40 — Gemma on this computer: translation, summaries and the project chat

**Goal:** in the desktop app, a colleague can download Google's open model **Gemma 4 26B A4B** in Settings and use it
instead of Claude or Gemini for the three things DeScribe asks a language model to do: **Translate to English**
(`src/features/translation/`), **session summaries** (`src/features/summary/`) and the **project chat**, `/compact`
included (`src/features/agent/`). It runs on the graphics card through Vulkan, as Phase 37's speech engine does, and
nothing it reads or writes leaves the computer. Wherever a model is chosen, Gemma is offered: the last entry in the
project model list, and a third radio, **This computer**, in the Translate dialog. It can be chosen once it is
downloaded, and is greyed out until then. The HTML file doesn't change.

**Status of the plan:** planned on 2026-11-28 from the maintainer's request (below). **No spike:** the maintainer asked
for none, so the tasks build the feature directly, and what can only be measured on real hardware is in the checklist,
where it is recorded but gates nothing (as D55 and D58). All UI text here is a draft (D13).

**Depends on:** Phase 19 and 20 (the provider contract both Claude and Gemini implement), Phase 35 (the model download),
Phase 37 (Vulkan, the card list and the LunarG SDK on the maintainer's PC). Not on the work laptop: its rows (LM13) run
whenever the maintainer next has the Store build on it.

**Read first:**
- DECISIONS.md D13, D18, D23, D26, D38, D41, D44, D45, D48, D50, D51, D52, **D53**, **D54**, D55, **D58**, D62;
- [reference/llm-providers.md](../reference/llm-providers.md), [reference/local-stt.md](../reference/local-stt.md)
  (*As built (Phase 37)*), [reference/desktop.md](../reference/desktop.md), [AGENTIC_SEARCH.md](../AGENTIC_SEARCH.md);
- `src/providers/llm/types.ts`, `models.ts`, `agentLoop.ts`, `gemini.ts` and `geminiAgent.ts` (the closest pattern:
  streamed structured output, function calls, thought parts kept out of the answer), `src/providers/index.ts`;
- `src/features/translation/translate.ts`, `src/features/summary/summarise.ts`, `src/features/agent/limits.ts`,
  `ask.ts`, `compact.ts`;
- `src/stores/settings.ts` (`projectModel`, `translationModel`, `localDevice`, `deviceOptions`), `translation.ts`,
  `pipeline.ts` (`usesModel`), `chat.ts` (the frozen model), `speechPack.ts`;
- `src/ui/components/ProjectModelSelect.vue`, `TranslateDialog.vue`, `SpeechPackSection.vue`, `src/ui/providerNames.ts`;
- `src/storage/schemas.ts` (`TranslationSchema`), `src/storage/projectFiles.ts` (`SessionSummaryFileSchema`);
- `src-tauri/src/stt/` (`pack.rs`, `download.rs`, `worker.rs`, `commands.rs`, `nemo.rs`), `src-tauri/build.rs`,
  `src-tauri/capabilities/default.json`, `src-tauri/stt-runtime.json`, `scripts/build-stt-runtime.ps1`,
  `scripts/pack-desktop.mjs`, `scripts/make-notices.mjs`, `scripts/verify-single-file.mjs`.
- **Prompts:** this phase adds no wording to the prompts in `src/features/summary/` or `src/features/agent/`. If a task
  finds it must, load the `claude-api` skill first (CLAUDE.md) and keep what Claude and Gemini receive unchanged.

## What the maintainer decided (2026-11-28)

From the request that started this phase. Task 1 records them as **D63**.

1. **The model is Gemma 4 26B A4B,** Google's, downloaded by the app when the user asks, as the speech models are.
2. **It does all three jobs:** translation, session summaries and the project chat.
3. **It runs on the graphics card through Vulkan,** the API the speech engine's second engine already uses (D58).
4. **One entry in the model lists.** It can be chosen when the model is installed, and is greyed out when it isn't.
5. **No spike tests.** The phase is built directly; the hardware's numbers are measured, not a gate.
6. **The Translate dialog keeps its provider radios,** with a third, **This computer**, rather than one grouped model
   list (chosen from two mockups, 2026-11-28). The web build's dialog stays as it is.

## What is known about the model (read 2026-11-28)

From the model cards and file listings on Hugging Face, and llama.cpp's repository. Nothing here has been run.

| | |
|---|---|
| **Which repository** | The link the maintainer gave, `google/gemma-4-26B-A4B`, is the **pre-trained base** model. Chat, translation and summaries need the **instruction-tuned** one, `google/gemma-4-26B-A4B-it`. The app uses Google's own quantised file of it (decision 1). |
| **Licence** | **Apache 2.0** on both repositories. No gate or terms to accept was shown on either card (Task 3 confirms it signed out). |
| **Size** | A mixture of experts: 25.2B parameters in all, **3.8B active** per token (8 of 128 experts, plus 1 shared), 30 layers. |
| **Context** | 256K tokens. Sliding-window attention (1,024 tokens) interleaved with global layers. |
| **Input and output** | Text and images in, text out; no audio on this size. DeScribe uses text only. |
| **Languages** | "35+ languages" out of the box, pre-trained on 140+. DeScribe offers 36 recording languages (Phase 26), so a few may translate poorly. |
| **Prompt format** | Standard `system`, `user` and `assistant` roles, with a native system prompt. Thinking is on when `<\|think\|>` starts the system prompt. Thought text comes as `<\|channel>thought\n … <channel\|>` before the answer, and an empty block when thinking is off. Earlier model turns keep only their answer, except turns with tool calls, which keep their thinking. "Native support for structured tool use"; the card doesn't show the call syntax, which is in the file's chat template. |
| **Sampling** | One setting "across all use cases": temperature 1.0, top_p 0.95, top_k 64. |
| **The file** | `google/gemma-4-26B-A4B-it-qat-q4_0-gguf`, `gemma-4-26B_q4_0-it.gguf`: **14.4 GB**, quantisation-aware trained for Q4_0 by Google. Its image projector (1.19 GB) isn't needed. |
| **Other files, not chosen** | ggml-org's Q4_0 (14.6 GB, from the unquantised weights), bartowski's Q4_K_M (17 GB), Unsloth's UD-Q4_K_XL (14.2 GB): third parties' conversions, and the Q4_K_M is larger. |
| **llama.cpp** | Has the `gemma4` architecture (Gemma 4 fixes from April 2026 on, PRs #21326, #21343, #21390, #21418). The newest release on 2026-11-28 was **b12833**, with a Windows Vulkan zip. On master, `llama.h` has `llama_model_load_from_file`, `llama_init_from_model`, `llama_memory_seq_rm`, `llama_sampler_init_grammar` and `_grammar_lazy_patterns`, `llama_model_chat_template`; `llama_model_params` has `devices`, `n_gpu_layers`, `tensor_buft_overrides` and a `load_mode` enum (no `use_mmap`); `llama_context_params` has `n_ctx`, `n_batch` and `flash_attn_type`. `llama_decode` was marked deprecated in favour of a newer call. *The API moves fast: Task 2 pins a tag and Task 4 reads that tag's header, not master's.* |

**A rough estimate of speed, not a measurement.** Each token reads about 2 GB of weights (3.8B parameters at Q4_0).
On the work laptop's DDR5, shared by the Radeon 740M and the processor, that bounds writing at perhaps 25–35 tokens a
second, and 10–20 is more likely. Reading the prompt is compute-bound: at the 740M's 1.4 TFLOPS, perhaps 50–150 tokens
a second. So on the laptop, a summary of an hour's session (about 12,500 tokens in, 3–5,000 out) could take 5–12
minutes, and translating that hour, about as many tokens out as in, 10–20 minutes. A dedicated card would be several
times faster. The checklist measures it (LM3–LM6, LM13).

## Decided in this file (the maintainer can change them)

1. **The file: Google's QAT Q4_0, text only.** `gemma-4-26B_q4_0-it.gguf` from `google/gemma-4-26B-A4B-it-qat-q4_0-gguf`,
   pinned to a commit, with its size and SHA-256, in a new `src-tauri/llm-pack/pack.json` (the shape of
   `speech-pack/pack.json`). Its id names the model and the file: `google-gemma-4-26b-a4b-it-q4_0-1`.
   - **Why:** the publisher's own file, unchanged, as D51 chose NVIDIA's. Quantisation-aware training loses the least at
     4 bits, and it is the smallest file of the four. It must fit beside the speech models on a laptop's disk and, on an
     integrated card, under Windows' limit of half the RAM for a card's shared memory (risk 1).
   - The image projector isn't listed: nothing in DeScribe sends images.
2. **The engine: llama.cpp, pinned, built for Vulkan, in its own folder.** Built from source at a release tag, as
   NeMo-Speech.cpp is (D53): `src-tauri/llm-runtime.json` pins the tag, the commit, the CMake flags and the files, and
   `scripts/build-llm-runtime.ps1` builds them into `src-tauri/llm-runtime/` (gitignored). The package carries them in
   an **`llm\`** folder beside `describe.exe`: `llama.dll`, `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll`,
   `ggml-vulkan.dll` and the MSVC runtime.
   - The CPU flags are the speech engines' (AVX2, FMA, F16C, BMI2; no AVX-512, no native tuning), `GGML_VULKAN=ON`,
     `GGML_BACKEND_DL=OFF` (one set of DLLs, as D58's engines), `GGML_CUDA=OFF`, and no server, tools, examples, tests or
     curl.
   - The Vulkan SDK is the one `stt-runtime.json` pins (1.4.363.0) if the pinned llama.cpp builds with it. If it needs a
     newer one, `llm-runtime.json` pins its own and the Handoff says so; the speech engines stay on theirs.
   - **Why its own folder:** llama.cpp's `ggml.dll` is not the speech engine's (NeMo-Speech.cpp pins an older llama.cpp
     commit), and DLLs of the same name must never meet in one process (Phase 37, Task 3).
   - **Not chosen:**
     - *Sharing the speech engine's `vulkan\` ggml:* it would tie llama.cpp's version to NeMo-Speech.cpp's, which stays
       at v0.3.0 (D58), and Gemma 4's fixes are later. Size matters little (D58).
     - *llama.cpp's own release zips:* DeScribe builds what it ships from pinned source, with the laptop's CPU flags;
       the releases use `GGML_BACKEND_DL` and per-CPU variants.
     - *Ollama, LM Studio or another installed runtime:* an install beside the app, which D35 exists to avoid.
     - *ONNX Runtime with DirectML or Windows ML:* another engine and third-party conversions (as D58 found for speech).
3. **A worker process that stays.** `describe.exe --llm-worker <engine folder>`, the same exe started again (D53), in the
   app's job object.
   - **Started on the first request,** not at launch. It loads the model once (14.4 GB, so seconds to a minute) and
     keeps it, so the next request starts at once.
   - **It ends after 10 minutes without a request** (a constant), on **Remove**, and with the app. That frees the
     memory a colleague needs for Teams and Word.
   - **One request at a time.** Rust queues the rest in order: a translation's batches, a summary and a chat question
     wait their turn. The page shows each as running, as today.
   - **Cancel doesn't end it.** The worker checks a flag between prompt batches (llama.cpp's abort callback) and between
     tokens, and confirms. If it hasn't within 5 seconds, Rust ends the process, and the next request loads again.
   - A crash or a driver reset (TDR) ends only the worker, as for speech.
4. **The page reaches it through Tauri commands, not HTTP.** `llm_generate` streams events back on a Tauri `Channel`,
   as `stt_download` streams progress. **The CSP and the page's three hosts don't change.**
   - **Not chosen:** `llama-server` on `127.0.0.1`. It would make `http://127.0.0.1:<port>` a fourth page host (hard
     rule 2, the CSP, `verify-single-file.mjs`), leave a port that any program on the computer can call, and put an HTTP
     server in the package. Commands keep D53's one gateway (`src/desktop/ipc.ts`).
5. **On a graphics card, and only on one.**
   - **Which card:** the card listed by `stt_devices` (Phase 37's probe) that Settings saves as `llmDevice` (`{ name, nth
     }`, decision 12). Without a saved one, the first dedicated card (kind `gpu`) in ggml's order, else the first
     integrated one. A saved card that's gone uses that default, without a message (as D58).
   - The worker finds the card among **its own** ggml's devices by name and place, as the speech worker does, since two
     ggml builds may number them differently.
   - **Where the weights go,** worked out by the worker before loading from what ggml reports of the card's memory (a
     pure function, `placement.rs`, with unit tests):
     1. **all on the card,** if the model, the KV cache at the context size (decision 6) and the compute buffers fit,
        with a margin of 10 %;
     2. else **the experts on the processor, the rest on the card:** the experts' tensors (`ffn_*_exps`) through
        `tensor_buft_overrides`, everything else with `n_gpu_layers` all. Experts are most of the weights but a few are
        used per token, so this is llama.cpp's usual way to run a large mixture of experts on a small card. On the
        maintainer's 8 GB RTX 2070 SUPER it is the expected case. On an integrated card the memory is the same RAM
        either way, but it keeps the card's share under Windows' shared-memory limit;
     3. else it stops with `memory` (decision 11) and loads nothing.
   - The file is loaded **memory-mapped** (`load_mode` MMAP), so weights left on the processor are backed by the file
     and don't add to committed memory (Phase 37 found commit doubling on a card).
   - The placement and the card go into the request's timings, which Settings shows (decision 12).
   - **No processor option** in this phase (*Out of scope*): the maintainer asked for the card.
6. **The context and the limits.** One table in `src/providers/llm/models.ts` (`LOCAL_MODEL`):
   - **Context: 65,536 tokens,** not the model's 256K: the KV cache's memory grows with it. A 3-hour session (about
     37,500 tokens) with its brief and a summary's reply fits. If LM6 finds it doesn't fit on the laptop's card beside
     the model, Task 4 lowers it to 32,768 (or a q8_0 KV cache) and the Handoff says so. Not a gate.
   - **Replies: at most 8,192 tokens.** The provider caps `maxOutputTokens` at it (summaries ask for 32,000).
   - **Too long:** a request whose prompt and reply room exceed the context fails with `too-long` before any work. The
     worker counts the real tokens; the page doesn't guess.
   - **The chat's budgets for Gemma** (D45, D48): reading levels of 12,000, 24,000 and 36,000 tokens (low, medium,
     high), the same 3-in-13 share for summaries, and `longChatTokens` (the `/compact` suggestion) at 48,000. The tool
     call levels stay. The chat settings' hours (`readingHours`) follow the chosen model. A project whose frozen context
     alone doesn't leave room for a question fails with `too-long`, naming Claude and Gemini.
7. **The prompt format is read from the file, not guessed.** The page renders Gemma's turns as text
   (`src/providers/llm/local/format.ts`, pure), from the chat template inside the pinned GGUF.
   - Task 4's worker mode `--llm-worker --template` prints it (`llama_model_chat_template`). It is saved as
     `fixtures/local-llm/chat-template.jinja`, and `scripts/make-gemma-fixtures.mjs` renders it with a Jinja renderer (a
     dev dependency) into golden prompts: a system prompt with and without thinking, a structured request, tools
     declared, a call and its result, a resumed chat. `format.spec.ts` compares `format.ts`'s output with them. The
     file is pinned by its hash, so the template can't change under the app.
   - **The page sends segments, not one string:** `{ text, special }`. The template's own markers are `special: true`;
     everything else, transcripts above all, is tokenised with special tokens **off**. A transcript that contains
     `<|channel>` or `<|think|>` stays text and can't open a turn or a thought (prompt injection by recording).
8. **Structured output: a grammar, thinking off.** Translation batches and summaries use `generateStructured` as now.
   - The zod schema becomes JSON Schema (`z.toJSONSchema`, as `toGeminiSchema` does), and `src/providers/llm/local/grammar.ts`
     turns that into a GBNF grammar, which the worker gives llama.cpp's grammar sampler. The converter covers what
     DeScribe's schemas use (objects with their properties in order, arrays with item counts, strings with enums and
     lengths, integers and numbers, nullable) and **throws for anything else**. Its spec runs every schema the app sends
     through it, so a new schema can't fail in a colleague's app.
   - The prompt ends with the model's turn and the empty thought block, so the grammar starts at the JSON.
   - The reply is still parsed and checked with zod, as for Claude and Gemini: anything wrong is `bad_output`, which
     the summary's one retry and the translation's existing handling already cover.
9. **The chat: Gemma's own tool calls, through the shared loop.** `src/providers/llm/local/agent.ts` is an
   `AgentAdapter` for `runAgentLoop`, as `geminiAgent.ts` is.
   - Tools are declared, called and answered in the template's syntax (decision 7's goldens). A **lazy grammar**,
     triggered at the call's opening marker, holds a call to a listed tool's name and its input schema. A call that
     still can't be read is sent again once (`resend`, as Gemini's malformed calls).
   - **Effort** (D48): **Low** turns thinking off; **Medium** and **High** turn it on. Gemma has no levels, so they are
     the same. Thought text never reaches the answer (the adapter drops the channel, as `geminiAgent.ts` drops thought
     parts) and is kept only in turns with tool calls, as the card says.
   - **The prefix is reused.** The worker keeps the last request's tokens in its KV cache, and a new request decodes
     only what differs (`llama_memory_seq_rm` from the first differing token). Each step of a chat resends the same
     instructions, context and conversation, so only the newest turn is read. Gemma's sliding-window layers need
     llama.cpp's full-size window cache for that (`swa_full` in `llama_context_params` when last read; Task 4 checks the
     pinned header). Without it, the worker reads the whole prompt each time: right, but slower. The usage reports
     cached tokens as `cacheReadTokens`, and LM7 checks it.
   - Saved chats resume as text (`resume`), as for the others. A chat started on Gemma continues on Gemma.
10. **A third provider, `local`, and the stored shapes.**
    - `LlmProviderId` becomes `CloudLlmProviderId | 'local'`, where `CloudLlmProviderId` is `'claude' | 'gemini'`.
      `PROVIDER_NAMES`, the key fields and `KEY_PROVIDERS` stay cloud-only: there is no key.
    - **A translation made with Gemma** is saved with `provider: 'local'` and the model's id. `TranslationSchema` has
      `z.enum(['claude', 'gemini'])`, so by D38 older builds would refuse the whole transcript. **Task 1 widens it to any
      non-empty string, as D52 did for transcription engines,** and lands first.
    - **A summary made with Gemma** has `provider: 'local'`. `SessionSummaryFileSchema` reads an unknown provider as
      missing, which means Claude: Task 1 widens it to any non-empty string too, so a Gemma summary is never called
      Claude's.
    - Chat files save the model as a string already.
    - The export names it: "English (translated with Gemma 4 on this computer, `<model>`)".
11. **The model lists: one entry, greyed out until it's ready, and never a silent swap to the cloud.**
    - **The project model** (`ProjectModelSelect.vue`: the Analyse header and Add to project): `PROJECT_MODELS` gains
      **Gemma 4 (this computer)**, last, in the desktop build only. Until the model is ready it is a disabled
      `<option>` reading **Gemma 4 (download in Settings)**.
    - **The Translate dialog keeps its radios** (the maintainer's choice from two mockups, 2026-11-28): **Claude**,
      **Gemini** and, in the desktop build only, a third, **This computer**. Until the model is ready that radio is
      disabled. A visually hidden description, "Download Gemma in Settings", says why, since a disabled radio shows no
      tip. With **This computer** chosen, the **Model** list holds **Gemma 4** alone. It stays a list so the dialog keeps
      its shape when the provider changes. There's no key field, and no data notice (decision 12).
      - **The web build's dialog is unchanged:** the third radio isn't in it.
      - **A saved choice of This computer that isn't ready** opens the dialog on Claude, with its model and its data
        notice. This doesn't break the next bullet's rule: the dialog shows the choice before anything is sent, and
        **Translate** sends it.
      - *Not chosen:* one **Model** list grouped by provider (`<optgroup>`), without the radios. It put Gemma in the
        model list itself, but changed the web build's dialog too.
    - **Ready** means the file is there and checked (`llm_status`: *ready*, from the receipt, so no hashing at launch).
      The card is checked when Gemma runs (decision 13's `no-card`).
    - **A saved project model of Gemma that isn't ready stays chosen** (shown, disabled, as the selected entry). The
      pipeline and the chat send without a dialog, so this is where a swap would go unseen. Whatever needs
      the model then says Gemma isn't ready and names Settings. **It is never replaced by Claude or Gemini without the
      user choosing:** a colleague chose Gemma to keep the text on the computer. This is unlike D56 (speech), where the
      fallback only costs money.
    - Nothing of this is in the web build: `verify:single-file` gains its markers.
12. **No key, no data notice, no cost; a Settings band.**
    - No key is asked for or checked. `pipeline.ts`'s key check and `chat.ts`'s "needs a key" skip `local`.
    - The data notices ("Only the transcript text goes to Anthropic", Add to project's "The transcript text is sent to
      …") aren't shown for Gemma: nothing is sent.
    - No cost: `MODEL_PRICES` has no entry, so `estimateCostUsd` gives `null`, which the chat already shows as no cost.
    - **Settings, desktop only: a band after *Transcribe on this computer*,** `LocalModelSection.vue` with
      `stores/localModel.ts` (the shape of `speechPack.ts`): the status, **Download Gemma (14.4 GB)** with its progress
      and Cancel, **Remove**, and the model's credit and licence (as `SpeechModelsCredit.vue`).
      - **Shown only when a card is listed:** the band calls `refreshDevices()` when Settings opens, as the speech band
        does when ready. Without a card there's nothing to offer, and the list's disabled entry says why (decision 13).
      - **Run on**, only with two or more cards: a radio group of the cards (no **Processor**), saved as `llmDevice`
        (optional, so D18 doesn't apply). With one card there's no choice to show (D13).
      - The last request's **Timings** behind a closed disclosure, as D56's: the card and placement, the load time, the
        tokens read and written, and each per second. They help when a colleague reports slowness.
    - **Clear saved data** leaves the model, as it leaves the speech models (D54).
13. **The failures,** each a `ProviderError` kind the stores already handle (D41: technical details behind **Technical
    details**). Drafts:
    - not ready: "Gemma isn't downloaded on this computer. Download it in Settings, or choose another model."
    - `no-card`: "Gemma needs a graphics card, and DeScribe didn't find one."
    - `memory`: "Gemma doesn't fit in this computer's memory now. Close other programs, or wait for a transcription to
      finish, then try again."
    - `too-long`: "This is too long for Gemma on this computer. Choose Claude or Gemini for it."
    - `gpu`: "The graphics card (NAME) stopped while Gemma was working." with **Try again**. No processor offer.
    - `bad_output`: "Gemma sent a reply that DeScribe couldn't read. Try again." `aborted`: "Cancelled."
    - **While the model loads** (the first request, or after 10 idle minutes), the chat's activity line and the
      pipeline's status say "Loading Gemma…". A minute of nothing would otherwise look like a hang.
14. **Speech and Gemma together.** A transcription on the computer and a Gemma request may run at once, even on the same
    card. If memory runs out, the one that couldn't load fails with its own `memory` message. LM8 measures it.
    - A download of either pack, and a removal, exclude each other's pack only (D54's rule, per pack).
    - Closing the window while Gemma works asks first, from Rust's own state as for a download (D54), and F5 cancels
      the request.
15. **What doesn't change:** the HTML file; the features' prompts and checks (the quote check, D44, guards Gemma's
    quotes as it guards the others', and its misses show as the usual marks); Setup, Glossary and Output apart from the
    Translate dialog's third radio; the speech engines.

## Tasks

Each task ends green (typecheck, lint, `npm test`, `cargo test`).

1. **Widen the readers (the first commit, decision 10).**
   - `TranslationSchema.provider` and `SessionSummaryFileSchema.provider`: any non-empty string. The types: a known
     provider or `(string & {})`, as D52's `TranscriptionRequestInfo.provider`.
   - The export's translation line and anything else that names a translation's provider shows an unknown one as it was
     saved.
   - DECISIONS.md: **D63** with the maintainer's decisions and decisions 1–5 above, and the readers' widening.
   - Tests: a transcript translated with `'local'` and with an unknown provider reads; a summary with `'local'` keeps it.
2. **The engine build (decision 2).**
   - `src-tauri/llm-runtime.json`: llama.cpp, the release tag (the newest when this task starts; b12833 on 2026-11-28)
     and its commit, the CMake flags, the Vulkan SDK, `engineFiles`, the MSVC runtime, the folder `llm`.
   - `scripts/build-llm-runtime.ps1` (`npm run desktop:llm-runtime`): clone at the commit, build, copy into
     `src-tauri/llm-runtime/` with a `built.json` (version, backend, sizes, SHA-256), and check each DLL's imports with
     `dumpbin /dependents`, as `build-stt-runtime.ps1` does: every import in the folder or Windows, `ggml.dll` importing
     `ggml-vulkan.dll`, and that importing `vulkan-1.dll`. `-From <bin>` copies an existing build. It refuses a build
     with `GGML_CUDA` or `GGML_BACKEND_DL` on.
   - Write the pinned `llama.h`'s functions and structs the worker uses into a new `reference/local-llm.md`
     (*The engine*), from that tag's header.
3. **The model pack (decision 1).**
   - Confirm, signed out (`curl.exe -I`), that the file downloads without a token. **If the repository is gated, or the
     licence page the card links to adds terms to Apache 2.0, stop and tell the maintainer** (D50 needs an ungated file
     with a licence the app can ship).
   - `src-tauri/llm-pack/pack.json`: the file, its bytes and SHA-256 (from Hugging Face's API for the pinned commit),
     the URL pinned to that commit, the name, the card, `Apache-2.0`, "© Google LLC", `changes: null`, and the model's
     context and reply limits for the page (decision 6).
   - **One download and check for both packs:** `stt/pack.rs` and `stt/download.rs` become `src-tauri/src/packs/`,
     taking a pack (its compiled list, its folder name, its receipt), so speech and Gemma share WinHTTP, the redirects,
     the `.part` files, the receipt and the kinds of failure (D54). `pack::is_pinned` and its `cargo test` cover both
     lists. The speech commands keep their names and behaviour.
   - The folder: the package's `LocalCache\llm-pack\<pack id>\` (unpackaged: under `%LOCALAPPDATA%\…\llm-pack\`).
   - **Free space first:** a download starts only with the file's size and 1 GB more free, else `disk` at once, not 14 GB
     in.
   - `scripts/notices/models/Apache-2.0.txt`, and the desktop notices' models part lists Gemma
     (`speechModels.mjs` reads both packs, or a sibling does).
   - `npm run desktop:fetch-models -- --llm` puts the file in `.speech-pack/` for debug builds (`--from <folder>` copies a
     verified one); `DESCRIBE_LLM_PACK_DIR` and `DESCRIBE_LLM_PACK_TEST_LIST` as the speech pack's switches.
4. **The worker (Rust, decisions 3, 5–9).** `src-tauri/src/llm/`:
   - `llama.rs`: the pinned `llama.h` functions through `libloading`, from the engine folder (`LoadLibraryExW` with the
     folder first, as `nemo.rs`), plus ggml's device functions (`ggml.dll` and `ggml-base.dll`, Phase 37's finding).
   - `protocol.rs`: one JSON line per message. In: `load { model, device, nCtx }`, `generate { id, segments, grammar?,
     lazyGrammar?, maxTokens, sampling }`, `cancel { id }`. Out: `loading`, `ready { card, placement }`, `prompt { done,
     total }`, `token { text }`, `done { id, stop: 'end' | 'length', usage, timings }`, `error { id, kind, detail }`.
   - `placement.rs` (decision 5), `prefix.rs` (the common prefix, decision 9), the segments' tokenising with special
     tokens on or off (decision 7), the samplers (the card's settings, then the grammar), stopping at the end of the
     turn, the abort flag, the too-long check before work.
   - `--llm-worker --template`: prints the file's chat template; `--llm-worker --probe`: loads the model, writes 16
     tokens, prints the placement and timings (for LM6, and for Task 6's fixtures).
   - `fake.rs`: `DESCRIBE_LLM_FAKE=<script.json>` makes a fake worker that streams scripted replies, tool calls, delays
     and failures (`gpu`, `memory`, `too-long`, a malformed call), so the UI can be checked over CDP without a card or the
     14 GB file. Release builds ignore it.
   - With the real file on the PC: the template saved (`fixtures/local-llm/chat-template.jinja`), placement on the RTX
     2070 SUPER and the UHD 770, and the context's memory (decision 6). Into local-llm.md.
5. **Rust's commands.** `llm_status` (missing, downloading, ready, damaged, unusable), `llm_download { downloadId,
   onProgress }`, `llm_download_cancel`, `llm_remove_model`, `llm_generate { requestId, request, onEvent }`,
   `llm_cancel { requestId }`.
   - Listed in `COMMANDS`, `build.rs` and the capability, as the others.
   - The worker's lifetime, the queue, the idle timer and the 5-second cancel (decision 3); the close guard and F5
     (decision 14); `llm_remove_model` ends the worker first.
   - The engine folder found as `engines()` finds the speech engines: `llm\` beside the exe; in a debug build
     `DESCRIBE_LLM_RUNTIME_DIR` or `src-tauri/llm-runtime/`.
6. **The page's provider (decisions 7–9, 13).** `src/providers/llm/local/`:
   - `bridge.ts`: the commands through `src/desktop/ipc.ts`, with zod schemas for every event, built when first used
     (rule 1).
   - `format.ts`: Gemma's turns as segments; `scripts/make-gemma-fixtures.mjs` and its goldens in
     `fixtures/local-llm/` (edit the script, not the goldens).
   - `grammar.ts`: JSON Schema to GBNF, and the lazy tool-call grammar.
   - `provider.ts` (`LlmProvider`), `agent.ts` (`AgentProvider` on `runAgentLoop`), `errors.ts` (the messages).
   - `src/providers/index.ts`: `getLlmProvider('local', …)` and `getAgentProvider('local', …)` in the desktop build only;
     `getLocalLlmBridge()`, with a test override as the others have.
   - `models.ts`: `LOCAL_MODEL` (id, label, context, reply limit, the chat's reading levels, `longChatTokens`),
     `LOCAL_THINKING_FOR`, and Gemma in `PROJECT_MODELS` when `__DESKTOP__`.
7. **Stores and UI (decisions 6, 10–14).**
   - `stores/localModel.ts`; `settings.ts`: `llmDevice`, the model lists' entries, Gemma's readiness; `agentLimits` per
     model.
   - `translation.ts`, `pipeline.ts`, `chat.ts`: no key for `local`; "not ready" instead of a fallback; "Loading Gemma…".
   - `ProjectModelSelect.vue`, `TranslateDialog.vue` (the third radio: its label and description are `__DESKTOP__ ? … : ''` constants, as Phase 37
     found for **Try on the processor**, so no text of it reaches the web build), `LocalModelSection.vue`, `SettingsView.vue`
     (the band; About's data flow says Gemma runs on the computer and is downloaded from Hugging Face, which About lists
     already).
   - `TranslateButton.vue`, `KeyDialog.vue` and the rest that take a provider: the compiler finds them once the type
     changes.
   - Over CDP with the fake worker (debug exe, a scratch WebView2 profile): LM2, LM5's Stop, LM10 and LM11.
8. **Packing and notices.**
   - `pack-desktop.mjs` checks the `llm\` engine as `checkEngine()` checks the speech engines and stages it; it stops,
     naming `npm run desktop:llm-runtime`, when it's missing. The MSIX's size before and after goes in desktop.md.
   - `make-notices.mjs`: llama.cpp (MIT) and its ggml, and anything its Vulkan build compiles in (the same checks Phase
     37's Task 6 made: Vulkan-Headers, SPIRV-Headers, and whatever this tag adds); Gemma in the models part.
   - `verify-single-file.mjs`: `TAURI_MARKERS` gains `llm_generate`, `llm_download`, `gemma-4-26B_q4_0-it.gguf` and
     `Download Gemma`.
   - The MSIX manifest and the CSP don't change.
9. **Docs.**
   - AGENTS.md: the Desktop row of the stack table (the `llm\` engine), the commands (`desktop:llm-runtime`,
     `desktop:fetch-models -- --llm`), **hard rule 2** (Rust also downloads the URLs in `src-tauri/llm-pack/pack.json`,
     under the same rules), and rule 4 if the layering changed.
   - `reference/local-llm.md` (new): the file, the engine and its pinned API, the template, placement, the context's
     memory, the debug switches, the numbers from LM3–LM8 and LM13. `reference/llm-providers.md`: a Gemma section.
     `reference/desktop.md`: the commands, the switches, the LM rows.
   - DECISIONS.md: **D64**, as built (what the tasks found, and anything changed from this file).
   - PRIVACY.md: with Gemma chosen, transcripts, summaries and chats stay on the computer; the download is from Hugging
     Face, as the speech models'.
   - USER_GUIDE.md: downloading Gemma, choosing it, what to expect of its speed, and the failures.
   - RELEASING.md: a new Gemma file means a new pack id and another 14 GB download for everyone.
   - TESTING.md: the opt-in tests and the LM rows. ROADMAP: §2's scope line, §5's layout, the table.

## The checklist (reference/desktop.md)

On the maintainer's PC with the development-signed app (LM1–LM12) and on the work laptop with the app from the Store
(LM1, LM2, LM13). The agent's rows over CDP with the fake worker where the real model isn't needed. Times are recorded,
and none is a gate.

| ID | Check |
|---|---|
| LM1 | Settings with a card: **Download Gemma (14.4 GB)**, its progress, Cancel and a second Download (resumed where the network honours Range), *ready*, **Remove**. Without a card: no band. On the work laptop, through the company network (as S1). |
| LM2 | Before the download, Gemma is greyed out in the Analyse header and Add to project, and the Translate dialog's **This computer** radio is too; after it, it can be chosen; after **Remove**, greyed again, still the saved choice, and **Summarise**, a chat question and **Translate** each say it isn't ready rather than using Claude or Gemini. |
| LM3 | **Translate to English** with Gemma: a 37-minute German and a French transcript. Every turn translated, reads sensibly beside Claude's; the time and Timings. |
| LM4 | **Add to project** with Gemma: translate and summarise a German session. The summary has its sections, and its quotes are found (or marked, as usual); the time. |
| LM5 | The chat with Gemma: three questions, one a follow-up, with searches and reads; then `/compact`. Quotes are checked; **Stop** during an answer stops within 2 s, and the next question works. Low and High effort both answer. |
| LM6 | Placement and memory: the RTX 2070 SUPER (expected: experts on the processor), the UHD 770, the laptop's Radeon 740M. For each: the placement, load time cold and warm, peak RAM in use, committed memory, the card's dedicated and shared memory, at a short prompt and near the full context. |
| LM7 | Prefix reuse: the second question of a chat reads far fewer prompt tokens than the first (cached tokens in the usage). |
| LM8 | A local transcription and a Gemma summary at once, on the same card: both finish, or the one that can't fit says `memory`. |
| LM9 | Network off (Wi-Fi off, cable out): LM3–LM5 work with Gemma. Resource Monitor shows no connection from DeScribe meanwhile. |
| LM10 | Closing the window during a Gemma request asks first; F5 cancels it; ten idle minutes end the worker (Task Manager), and the next request says "Loading Gemma…". |
| LM11 | The failures with the fake worker: not ready, `no-card`, `memory`, `too-long`, `gpu`, `bad_output`. Each message as drafted; screen reader: announced, buttons reachable. |
| LM12 | The MSIX: its size before and after, all three engines inside, the Windows App Certification Kit passes. |
| LM13 | **The work laptop** (the maintainer, the Store build): LM3, LM4 and one LM5 question on the Radeon 740M, plugged in and on battery; Settings' Timings for each. Measured, not a gate. |

## Acceptance criteria

- [ ] With the model downloaded and a card found, translation, a session summary, a chat question and `/compact` all
      work with Gemma, and nothing is sent anywhere (LM9).
- [ ] Gemma is the last entry in the project model list, and the Translate dialog's third radio; both are greyed out
      until it is ready. A saved project model of Gemma that isn't ready is never replaced by a cloud model.
- [ ] The download, Cancel and Remove work as the speech models' do, from a pinned, checked file.
- [ ] Placement chooses between the card alone and experts on the processor, and refuses what can't fit, before loading.
- [ ] Transcript text can't produce Gemma's control tokens.
- [ ] Every schema the app sends converts to a grammar, or the spec fails.
- [ ] Older readers' widening (Task 1) landed first; a transcript or summary made with Gemma opens in this build and in
      the HTML file.
- [ ] Claude and Gemini behave exactly as before; the HTML file is unchanged, and `verify:single-file` passes.
- [ ] New UI reviewed against D13, and for keyboard and screen-reader use.
- [ ] LM1–LM13 have results, or *not run* with a reason (LM13 doesn't gate the phase).
- [ ] The Definition of Done in AGENTS.md.

## Required tests

- **cargo:** the protocol round-trips; `placement` (fits on the card, experts on the processor, refuses; an integrated
  card; a card reporting no memory); the common prefix (none, partial, whole, a shorter prompt); segments with special
  tokens off keep a marker as text (with a fake tokenizer); the queue, cancel within 5 s and the end after it; the idle
  timer; `too-long` before work; the shared pack code for both packs (pinned URLs, a test pack's check, free space
  first); the engine folder found; `llm_remove_model` ends the worker; the command list matches `build.rs`. Opt-in
  (`--ignored`, with `DESCRIBE_LLM_PACK_DIR`): load the real file on a card and write 16 tokens; a grammar holds a reply
  to a tiny schema.
- **Vitest:** `format.ts` against the goldens; `grammar.ts` on every schema the app sends, and unsupported keywords
  throwing; the provider (a reply streamed into JSON and checked, `bad_output`, `aborted`, the reply cap, `too-long`);
  the agent adapter (text, a tool call, a malformed call resent once, thought text dropped, effort to thinking, usage
  with cached tokens, `resume`); the stores (no key for `local`, not ready without a fallback, `llmDevice` with a gone
  card, the chat's limits per model); `ProjectModelSelect` (the disabled entry and its label); `TranslateDialog` (the
  third radio, disabled with its description until ready, Gemma alone in the list, no key field or notice for it, a
  saved **This computer** that isn't ready opening on Claude); `LocalModelSection` (the band only with a card, **Run on** only with two);
  the schemas (Task 1); the export line.
- **E2E (web build):** the existing suite, unchanged; Gemma and **This computer** appear nowhere.
- **Desktop:** LM1–LM13.
- **No real API calls** unless the maintainer asks for them in the session (CLAUDE.md). Gemma isn't an API, but the LM
  rows that compare with Claude's translation use the maintainer's own runs.

## Out of scope

- Gemma on the processor, and a **Processor** choice for it.
- Other Gemma sizes (E4B, 31B), other quantisations, or a choice of them; another local model.
- Images and audio (the image projector).
- Gemma in the HTML file; any HTTP server.
- Installing the file from a folder the user already has (D50's follow-up, for both packs).
- Prompt changes for Gemma in `src/features/` beyond what the provider adds; tuning summaries for it (if LM4 reads
  poorly, a follow-up may turn thinking on for summaries with a lazy grammar after the thought block).
- The future AI audit (F1) on Gemma.

## Risks and unknowns

1. **Memory on the laptop.** 14.4 GB of weights, the KV cache and buffers, on 32 GB of RAM shared with the card, Teams
   and Word. Windows lets a card use at most half the RAM as shared memory (16 GB there), and ggml-vulkan may report an
   integrated card's memory as its small carve-out or as the shared heap. Placement's second option is the way out;
   LM6 and LM13 show which happens. Phase 37 saw committed memory double on a card, which the memory map limits.
2. **Speed on the 740M.** The estimate above says minutes per summary and longer for a translation. It ships whatever
   the speed, as D55 and D58 did, and LM13 measures it.
3. **Quality against Claude.** A 4-billion-active model translates and summarises less well, and may follow 30 tool
   calls less reliably. The quote check (D44), the summary's retry and the chat's budgets limit the harm; LM3–LM5 read
   it. Not measured beyond that.
4. **The engine's API moves.** On master, `llama_decode` is deprecated and `use_mmap` became `load_mode`. Pinning a tag
   and reading its header (Task 2) keeps the worker stable; a later update of llama.cpp is its own change.
5. **The tool-call syntax** isn't on the card. Decision 7's goldens from the file's own template settle it before the
   adapter is written.
6. **Prefix reuse with sliding windows** may need more memory (`swa_full`), or not be available in the pinned tag; the
   fallback is correct but reads every prompt in full.
7. **The download: 14.4 GB, and the company network ignores Range** (Phase 33's D5). An interruption there starts the
   file again. Installing from a file (*Out of scope*) is the follow-up if LM1 fails on the laptop.
8. **The driver's 2-second limit (TDR).** A long prompt batch on a weak card could take longer than Windows allows and
   reset the driver. Task 4 uses a smaller micro-batch on integrated cards if LM6 sees it; a reset ends only the
   worker.
9. **Languages.** Gemma names 35+ languages out of the box against DeScribe's 36; a recording in another may translate
   poorly. Nothing stops it.
10. **The Vulkan SDK.** If the pinned llama.cpp needs a newer SDK than 1.4.363.0, the maintainer installs it (winget),
    as for Phase 37.

## Sources (read 2026-11-28)

- Gemma 4: [google/gemma-4-26B-A4B](https://huggingface.co/google/gemma-4-26B-A4B),
  [google/gemma-4-26B-A4B-it](https://huggingface.co/google/gemma-4-26B-A4B-it),
  [google/gemma-4-26B-A4B-it-qat-q4_0-gguf](https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf/tree/main),
  the [Gemma 4 licence page](https://ai.google.dev/gemma/docs/gemma_4_license) (linked from the card, not yet read:
  Task 3).
- Other files: [ggml-org](https://huggingface.co/ggml-org/gemma-4-26B-A4B-it-GGUF/tree/main),
  [unsloth](https://huggingface.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF/tree/main),
  [bartowski](https://huggingface.co/bartowski/google_gemma-4-26B-A4B-it-GGUF/tree/main).
- llama.cpp: [`include/llama.h`](https://github.com/ggml-org/llama.cpp/blob/master/include/llama.h) and
  [`src/llama-arch.cpp`](https://github.com/ggml-org/llama.cpp/blob/master/src/llama-arch.cpp) on master,
  [`ggml/CMakeLists.txt`](https://github.com/ggml-org/llama.cpp/blob/master/ggml/CMakeLists.txt), the
  [release workflow](https://github.com/ggml-org/llama.cpp/blob/master/.github/workflows/release.yml), the
  [releases](https://github.com/ggml-org/llama.cpp/releases), and PRs
  [#21326](https://github.com/ggml-org/llama.cpp/pull/21326), [#21343](https://github.com/ggml-org/llama.cpp/pull/21343),
  [#21390](https://github.com/ggml-org/llama.cpp/pull/21390), [#21418](https://github.com/ggml-org/llama.cpp/pull/21418).
- Phase 37's research on the Radeon 740M, Vulkan on integrated cards and `GGML_VK_PREFER_HOST_MEMORY`.

## Handoff

*(What each task found and changed from this file, the texts as shipped and what was trimmed, LM1–LM13, and anything
the next release needs.)*

**Planning (2026-11-28):** written from the maintainer's request. Nothing has been built or run, and nothing was
downloaded. The model and engine facts above were read from the web pages listed under *Sources*. The same day the
maintainer chose the Translate dialog's layout from two mockups: the radios stay, with **This computer** as a third
(decision 11).
