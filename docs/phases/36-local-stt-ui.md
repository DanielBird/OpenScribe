# Phase 36 — Transcribe on this computer: the choice, progress and About

**Goal:** a colleague with the desktop app and the speech models downloaded chooses on Setup whether a recording is
transcribed by ElevenLabs or on their computer, and sees honest progress while it runs. About says where the
recording goes in each case, that the models are downloaded from Hugging Face, and credits the NVIDIA models under
their licences. Without the models, and in the HTML file, nothing changes.

**Status of the plan:** drafted on 2026-11-14 (DECISIONS.md **D50**). Phase 33 ran on 2026-11-15 (**D51**) and chose
the models named below. Its findings, below, override the text where they differ. **On 2026-11-16 the maintainer
decided local transcription ships whatever the work laptop's speed (D55):** the laptop run below is a measurement,
not a gate, and the phase doesn't wait for it. All UI text here is a draft (D13).

## Phase 33's findings (2026-11-15; DECISIONS.md D51)

They override the text below where they differ ([reference/local-stt.md](../reference/local-stt.md)).

- **The estimate for Task 1's checkpoint**, from the *Laptop* profile:
  - an hour in **334 s (5.6 min)**, three hours in 998 s (16.6 min);
  - *Throttled* (battery, heat): an hour in 567 s (9.5 min).

  Use the same recordings, copied to the laptop:
  - `scripts/spikes/local-stt/out/test-set/test_audio.1h.m4a` and `.3h.m4a` (the maintainer's recording joined to
    itself);
  - the Andrew recording (34.5 min), whose ElevenLabs transcript is the accuracy reference.

  Speed was the same at every length (10.6–10.8×), so **a time-left estimate after the first minute can be trusted**
  (decision 6 may change).
- **Limits on Setup:**
  - Parakeet's 25 European languages (English tested; German and French are first checked in L4).
  - **No Number of speakers with This computer:** the engine ignores it. Hide it, as decision 4 does for options that
    don't apply, rather than allowing 1 to 8.
  - No length limit up to three hours, so Task 3's "Phase 33's length limit" doesn't arise.
  - **Ogg Opus can't be read** locally. The file check names it and offers ElevenLabs.
- **"Slower"** on Setup: at the estimate, an hour takes about 5–6 minutes on the laptop. Word it after the checkpoint.
- **The transcript is verbatim** ("um", repeated words, no digits). Phase 34 adds the maintainer's clean-up; if it
  becomes a choice, it belongs here.
- **About:** the two models, NVIDIA's own files from Hugging Face. No copy hosted by Dtype.

**Depends on:** Phases 34 and 35 (built). Not on the laptop: Phase 35's laptop rows and this phase's Task 1 can run
whenever the maintainer next has the Store build on it (D55). Task 1 needs Phase 35's S1 to have worked there
first, since it transcribes with downloaded models.

**Read first:**
- [DECISIONS.md](../DECISIONS.md) D3, D5, D6, D13, D27, D36, D37, D41, D50 and the entries of Phases 33–35;
- [reference/local-stt.md](../reference/local-stt.md);
- `SetupView.vue`, `GlossaryView.vue`, `JobStatus.vue`, `TranscriptHeader.vue`, `SettingsView.vue` and
  `stores/settings.ts`;
- [PRIVACY.md](../PRIVACY.md) and [USER_GUIDE.md](../USER_GUIDE.md).

## Decided in this file (the maintainer can change them)

1. **One choice, in the user's terms.** Setup asks where to transcribe: **ElevenLabs** or **This computer**. The
   models' names appear only in About and on the transcript's details. Nothing in the flow mentions two models.
2. **The choice appears only when it is a choice:** in the desktop app with the models downloaded and ready.
   Otherwise Setup looks as it does today. Models that are missing or unusable are Settings' business (Phase 35),
   not Setup's.
3. **ElevenLabs stays the default** until the user chooses otherwise; the choice is remembered. If the remembered
   choice is This computer and the models have gone, Setup falls back to ElevenLabs without a message (Settings says why).
4. **Options that don't apply are hidden, not disabled:** with This computer, no key is asked for and Zero retention
   isn't shown (nothing is sent). Language and Number of speakers show the local limits.
5. **The glossary step stays,** because translation uses the terms. With This computer it says once that the terms
   aren't used for transcribing.
6. **Progress is real:** seconds of audio done out of the total, as a progress bar, with the elapsed time. No
   estimate of the time left unless Phase 33's numbers show it can be trusted.
7. **About's credit comes from the build:** the names, licences and links from `pack.json`, and the full texts from
   the notices Phase 35 generates. It is the same whether or not the models are downloaded, and it can't disagree
   with what the app would download.
8. **This phase holds the first real measurement, but doesn't wait for it** (D55). The work laptop can't run a
   benchmark, so Phase 33's numbers come from an emulation on the maintainer's PC. The laptop's first local run comes
   from this phase's build, installed from the Store, which the maintainer confirmed may transcribe real recordings
   there (2026-11-14). It runs when the maintainer can, before or after the rest of the phase. Its result changes
   only what the texts say about speed; a slow laptop is the maintainer's call, not a stop.

## Tasks

1. **The laptop run: a measurement, whenever the maintainer can** (D55; no longer a gate). Any build of this phase
   with the choice on Setup and the last run's timings in Settings (Tasks 3, 4 and 7) will do, submitted to the
   hidden listing. The maintainer, on the work laptop, with the models downloaded in Settings and the laptop plugged
   in:
   - transcribes the same one-hour recording Phase 33 used, and reads off the timings; then the three-hour one;
   - once more on battery, and once during ordinary work (a Teams call, Edge open);
   - notes how the laptop behaves meanwhile: fans, heat, whether other apps stay usable, whether it tries to sleep.

   Write the numbers beside Phase 33's estimates in reference/local-stt.md, with how far off the emulation was, and
   the corrected calibration: later work on the engine needs it.
   - **What the numbers change:** only what the texts say about speed (Task 3's "Slower", the User Guide), which
     must never promise more than the laptop showed. Until the run, they say only "Slower", or give Phase 33's
     estimate as an estimate.
   - **Past the floor** (more than 15 minutes for an hour, or over 4 GB): tell the maintainer, with the changes Phase
     33 listed for this case and what each costs. The maintainer decides whether to try them; the phase doesn't stop.
     Don't tune by guesswork on the PC: correct the emulation's calibration from the real numbers first.
   - **If the download fails on the laptop** (Phase 35's S1), this run can't happen: take it to the maintainer, with
     installing the models from files as the follow-up.
2. **The settings store:** `transcriptionEngine` gets its public setter and the rules of decisions 2 and 3. It holds
   the models' status from the bridge (asked on Setup's opening, and updated by Phase 35's download and removal),
   behind `__DESKTOP__`.
   `languages`, the speaker limit, the file check and "is a key missing" come from the chosen provider, so they
   change with the choice. A saved language the chosen provider doesn't offer falls back to Auto-detect, as D37 does
   today.
3. **Setup:** above Options, when decision 2 holds, a radio group (real `<input type="radio">`s in a `<fieldset>`):

   > **Transcribe with**
   > ◉ ElevenLabs  ○ This computer
   > *(with This computer chosen:)* Slower. The recording stays on this computer.

   - With This computer: the API key section, Zero retention and Number of speakers aren't rendered (the engine
     takes no number of speakers: Phase 33); Language lists Auto-detect and the pack's languages.
   - The collapsed Options summary and **Next** behave as today. The file check uses the local limits (Phase 33's
     length limit, if it set one) with a message that offers ElevenLabs for a longer recording.
4. **Glossary:** with This computer, one line above the list: "Used when you translate. Transcribing on this computer
   doesn't use terms." Nothing else changes; **Run** starts the local job.
5. **Output while it runs** (`JobStatus.vue`): **Preparing…**, then **Transcribing** with `12:30 of 58:10`, a
   `<progress>` bar and the elapsed timer. The hint under it, once: "Keep DeScribe open. You can use other apps."
   Announce the phase changes through the existing `aria-live` region, not every tick. Cancel and Try again as today.
   Local errors use Phase 34's messages, with **Technical details** (D41); the "models missing" one links to Settings.
6. **The transcript's details** (`TranscriptHeader.vue`, the `.docx` header block): the engine reads "Transcribed on
   this computer (NVIDIA Parakeet, Nemotron Diarization)" for a local transcript, built from the pack id through one
   small table of known packs; an unknown pack id is shown as it is. Glossary and zero-retention entries don't
   appear, as they already don't when they don't apply. Both builds, since the HTML file opens local transcripts too.
7. **Settings:** Phase 35 built the section. This phase adds one line to its *installed* state, after a local run:

   > Last recording: 1:02:10 of audio in 14:32.

   It comes from Phase 34's timings. It tells a colleague what to expect of their own computer, and it is how
   the maintainer reads the work laptop's speed (Task 1). The stage times, threads and peak memory sit behind a
   `<details>` under it, for the laptop run; the maintainer decides whether that disclosure ships or goes. **Clear saved data** clears the line and resets the choice to ElevenLabs. It leaves the models
   (Phase 35).
8. **About** (`SettingsView.vue`, under `__DESKTOP__`):
   - **Transcribe:** "Your recording and glossary are sent to ElevenLabs for transcription, or, if you choose **This
     computer** on Setup, the recording is transcribed here and isn't sent anywhere." The sentence on translation
     stays.
   - **Getting API keys:** the ElevenLabs item says it's needed only for transcribing with ElevenLabs.
   - **A new part, Speech models:** "Transcribing on this computer uses NVIDIA Parakeet TDT 0.6B v3 (CC BY 4.0) and
     NVIDIA Nemotron 3 Diarization (OpenMDW 1.1), © NVIDIA Corporation. DeScribe downloads them from Hugging Face
     when you click **Download speech models**, and sends nothing about you or your recordings. DeScribe is not
     affiliated with or endorsed by NVIDIA." Each model's name links to its card and each licence to its text,
     all from `pack.json`. This is the data-flow text hard rule 2 asks for, for the fourth host.
   - **Licences:** the Speech models part of `THIRD-PARTY-NOTICES-DESKTOP.txt` (Phase 35) is already shown there,
     with both licence texts, beside the runtime's own notices (Phase 34). Check that it reads well.
   - **Privacy and terms:** Hugging Face is added, with its privacy policy and terms, as the host of the download.
     NVIDIA receives nothing, so it isn't listed.
   - The web build's About doesn't change.
9. **PRIVACY.md** (new date at the top):
   - in short and in the table, recordings go to ElevenLabs **or are transcribed on your computer**;
   - the temporary copy during a local run, and its deletion;
   - **a fourth service, Hugging Face:** the app downloads the speech models from it when you ask. It receives
     the request and your computer's IP address, as any website does, and none of your recordings, transcripts,
     keys or settings. Link its privacy policy. "DeScribe connects only to these three services" becomes four,
     and the Security section's sentence on blocked connections is reworded to match;
   - the models are kept in the app's own storage, removed by **Remove** or by uninstalling, and make no
     connections themselves;
   - the AI section names NVIDIA's models as running locally.

   The Store's privacy URL shows the same page, so tell the maintainer to publish it before this build goes to
   colleagues.
10. **USER_GUIDE.md and CHANGELOG.md:** downloading the speech models, and what to do if the network blocks it;
    choosing where to transcribe; what's different locally (slower, 25 languages, up to 8 speakers, no glossary for
    transcription, nothing sent); removing the models.
11. **The Store listing of the app** (the maintainer): say that it can transcribe on the computer, and that this
    needs a download of about a gigabyte from Hugging Face (Phase 35 drafted the wording). Record it in
    reference/desktop.md.
12. **Docs:** ROADMAP (§2 scope, §3's workflow sketch if it should show the choice, the table); DECISIONS, if the UI
    departs from D5 or D27; TESTING.md and reference/desktop.md for the rows below; `future.md` F2, which this
    partly delivers.

## The checklist (reference/desktop.md)

On the maintainer's PC with the development-signed app, and on the work laptop with the app from the Store. Nothing
but the Store's build runs on the laptop. L9 is the laptop's alone, and L10 the PC's (it needs a
debug build).

| ID | Check |
|---|---|
| L1 | Before the models are downloaded: Setup has no choice, and Settings offers **Download speech models**. |
| L2 | With the models downloaded: Setup offers the choice; ElevenLabs is chosen the first time; the choice survives a restart. |
| L3 | This computer with no ElevenLabs key saved: Setup doesn't ask for one, and the run works with the network off. |
| L4 | An English, a German and a French recording, each locally: language, speakers, playback from a turn, rename, edit, translate, **Download .docx**, **Add to project**. |
| L5 | Progress moves and reads sensibly with a screen reader; Cancel; Try again. |
| L6 | The models removed after choosing This computer: Setup falls back to ElevenLabs; Settings offers the download again. |
| L7 | A local transcript added to a project opens in the HTML file of the same release, on Output and in Analyse, and names its engine. |
| L8 | About shows the Speech models part, says the models come from Hugging Face, and lists Hugging Face under Privacy and terms. Licences has both models' licence texts. The same before and after the download. |
| L9 | **The work laptop's real numbers** (Task 1): Phase 33's one-hour and three-hour recordings plugged in, the one-hour one on battery and during ordinary work. Settings' timings for each, and how the laptop behaves; it doesn't sleep mid-run. Recorded beside the emulated estimates. |
| L10 | During a local run, a debug build makes no request at all: none from the page, and none from Rust (a capture of the app's connections). |

## Acceptance criteria

- [ ] With the models downloaded, a colleague can transcribe a recording on Setup → Glossary → Output without an ElevenLabs
      key, having chosen only **This computer**.
- [ ] Without the models, and in the web build, Setup, Glossary and Output are unchanged (the existing e2e suite passes
      untouched).
- [ ] Options that don't apply locally aren't shown, and the limits shown are the pack's.
- [ ] Settings shows the last local run's line, and **Clear saved data** clears it.
- [ ] About credits each model with its name, its licence and a link, shows both licence texts under Licences, says
      where the recording goes in each case and that the models come from Hugging Face. PRIVACY.md matches it and
      is published.
- [ ] A local transcript's details and export name the engine, in both builds.
- [ ] New UI reviewed against D13, and for keyboard and screen-reader use (the radio group, the progress bar, the
      status in Settings).
- [ ] The laptop run (Task 1) has its numbers in reference/local-stt.md beside Phase 33's estimates, with the
      corrected calibration, or *not run* with the reason (D55: it doesn't gate the phase). The texts about speed
      promise no more than what was measured.
- [ ] L1–L10 have results on the maintainer's PC, and on the work laptop from the Store, or *not run* with a reason.
- [ ] The Definition of Done in AGENTS.md.

## Required tests

- **Vitest:** the settings store (the choice appears only on desktop with the models ready; the fallback; languages and
  limits following the choice; a saved language the pack lacks); `SetupView` (the group, the hidden key and Zero
  retention, the limits) with `vi.stubGlobal('__DESKTOP__', true)` and a fake bridge, and unchanged without;
  `GlossaryView`'s line; `JobStatus` for the local phases; `TranscriptHeader` and the `.docx` model for a local
  transcript and for an unknown pack; `SettingsView` for the last run's line (absent before a run, cleared with the
  saved data) and About's desktop text.
- **E2E (web build):** the existing suite unchanged; the Phase 34 spec that opens a local transcript also checks the
  engine's name in the header and the export; axe on the changed views.
- **Desktop:** L1–L10. The agent's rows over CDP with Phase 34's fake engine and a fake pack folder.
- **No real API calls** unless the maintainer asks for them in the session (CLAUDE.md).

## Out of scope

- A choice between models or packs, or any setting for threads, precision or the GPU.
- Estimating the time left; running in the background with the window closed; a queue of recordings.
- Local transcription from the pipeline's **Add to project** for several files at once.
- Making the listing public: the release that does it is planned separately.

## Handoff

*(The texts as shipped and what was trimmed, L1–L10, and anything the next release needs.)*

**Phase 33 (2026-11-15):** updated this file with *Phase 33's findings* above, which
override the tasks where they differ (DECISIONS.md D51). Nothing in this phase has been built.
