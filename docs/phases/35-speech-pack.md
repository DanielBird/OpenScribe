# Phase 35 — The speech pack: downloading the models

**Goal:** a colleague clicks **Download** in Settings, and the desktop app fetches the two model files from Hugging
Face, checks them and keeps them in its own folder. The download shows progress, survives an interruption, can be
cancelled, and the models can be removed again. A build with this goes through the hidden Store listing, and the
download is proved on the work laptop's network.

**Status of the plan:** rewritten on 2026-11-14, after the maintainer chose a download made by the app over an
optional package in the Store (DECISIONS.md **D50**). Phase 33 ran on 2026-11-15 (**D51**): its findings, below
(where each file is hosted, the HTTP stack, the folder, the work laptop's network), override the text where they
differ.

## Phase 33's findings (2026-11-15; DECISIONS.md D51)

They override the text below where they differ. Facts in [reference/local-stt.md](../reference/local-stt.md),
*Downloading the models*; `scripts/spikes/local-stt/harness/src/bin/hf-fetch.rs` and `test-server.mjs` are working
starts for Tasks 1, 2 and the tests.

- **Hosting:** NVIDIA's own repositories, unchanged, ungated (D1). **No copy hosted by Dtype (D2):** decision 7's
  last sentence and Task 6's last item don't apply.
- **The size:** 821 MB for the two files, not 1.1 GB. Every text takes it from `pack.json`.
- **The HTTP stack:** WinHTTP with `WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY` (Windows' proxy, PAC included) and
  Windows' certificate store. Follow redirects in the code, HTTPS only, logging only each hop's host.
- **Don't turn on revocation checks** (`WINHTTP_ENABLE_SSL_REVOCATION`). The work laptop's network inspects the
  delivery host `us.aws.cdn.hf.co` with **Cisco Umbrella**, whose certificate's revocation status can't be checked
  there, and Windows' curl failed hard on exactly that (`CRYPT_E_NO_REVOCATION_CHECK`). The pinned SHA-256 is the
  guarantee. Never use a bundled root list: the inspecting CA is only in Windows' store.
- **Resuming doesn't work on the company network:** a Range request came back `200` with the whole file. Decision 3
  holds ("if the server won't resume, it starts that file again"), so plan S2 and S3 with that in mind.
- **Speed on the work laptop:** 714 MB in 30.3 s (23.6 MB/s), with best-effort revocation. Expect under a minute
  for both files.
- **Task 2's failure kinds, from D9:**
  - `blocked`: 403, 451, an untrusted certificate (WinHTTP 12175), an HTML page with 200 (its `Content-Type`), or a
    body of the wrong size;
  - `offline`: no name (12007), no connection (12029) or a timeout (12002);
  - `busy`: 429, with `Retry-After` and `RateLimit` headers;
  - `mismatch`: the hash;
  - a cut connection ends the body early under WinHTTP, so it's caught by size. Keep the `.part` file for the next
    attempt;
  - an unknown revocation status is **not** a failure.
- **The User-Agent:** Hugging Face asks for nothing (D3). Use `DeScribe/<version>`, with no user details.
  Anonymous downloads get 3,000 resolver requests per 5 minutes per IP, which a company's whole office stays far
  below.
- **The folder:** the package's **LocalCache** (D7). It was kept across an update (1.0 → 2.0) and removed on
  uninstall, and files there memory-map. The unpackaged path stays as decision 4 says.
- **Task 7, the Store text:** Store Policies 7.20, quoted in the reference doc's D4.
  - 10.2.2: no dynamic code. The models are data and the engine ships in the app.
  - 10.1.1: describe the important limitations.
  - 10.2.4: disclose a dependency at the start of the description. Say early that local transcription downloads
    about 0.8 GB of NVIDIA speech models from Hugging Face on request.

**Depends on:** Phases 33 and 34. It uses Phase 34's bridge, commands, `pack.json` and `pack.rs`.

**Read first:**
- [DECISIONS.md](../DECISIONS.md) D13, D27, D35, D36, D41, T16, T17, D50 and the entries of Phases 33 and 34;
- [reference/local-stt.md](../reference/local-stt.md): the D rows, and each model file's URL, size and hash;
- [reference/desktop.md](../reference/desktop.md): *The window and the web view*, *The CSP*, *The Store*;
- `SettingsView.vue`, `scripts/make-notices.mjs` and `scripts/verify-single-file.mjs`;
- each model's card and licence, and Hugging Face's terms, read again on the day.

## What changes in the rules

Hard rule 2 allows three hosts, enforced by the web view's CSP. This phase adds a fourth that the CSP never sees,
because Rust makes the requests. Update AGENTS.md's rule 2 with the code, and record it in DECISIONS:

- **The web view's hosts don't change.** `API_HOSTS`, `connect-src` and `ALLOWED_HOSTS` stay the same three, and
  `verify:single-file` still fails when they disagree. The page never talks to Hugging Face.
- **Rust downloads only the URLs compiled into it** from `pack.json`: each one HTTPS, on the host Phase 33 chose
  (`huggingface.co`), pinned to a commit. Nothing the page sends, and nothing a server answers, can add or change a
  URL. A test fails the build otherwise (Phase 34).
- **Redirects are followed, over HTTPS only,** because Hugging Face hands files to delivery hosts whose names
  change. The file's size and SHA-256 decide whether it is accepted, not the host it came from.
- **Only when the user asks.** No download starts by itself: not at launch, not after an update, not as a retry.
- **Nothing about the user is sent:** no key, no token, no recording, no identifier. The request carries the
  app's name and version as its user agent (or what Phase 33's D3 found Hugging Face expects), and Hugging Face
  sees the computer's IP address, as any website does.
- The data-flow text in Settings' About, and PRIVACY.md, say so (Phase 36 writes both; this phase must not ship to
  colleagues without them).

## Decided in this file (Phase 33 or the maintainer can change them)

1. **One download, however many files.** The user sees "speech models" and one size, one progress bar and one
   result. The files are fetched one after the other.
2. **A file is used only after it matches.** Each file is written under a temporary name, checked for size and
   SHA-256, and only then given its real name. A wrong file is deleted and reported; it is never loaded.
3. **An interrupted download carries on.** The part already on disk is kept, and the next attempt asks for the rest
   with a range request. If the server won't resume, it starts that file again.
4. **The models live in the app's own folder** and go when the app is uninstalled: the package's cache or state
   folder as Phase 33's D7 found (T17), and `%LOCALAPPDATA%\io.github.danielbird.describe\speech-pack` for the
   unpackaged app. **Remove** in Settings deletes them. **Clear saved data** doesn't: they aren't the user's data,
   and fetching a gigabyte again is costly.
5. **A new app version may need new models.** If the files on disk aren't the ones this build lists, the status is
   *outdated*: the old files keep working only with the old app, so Settings offers the download again and deletes
   the old files once the new ones are verified.
6. **The Settings section is built here,** not in Phase 36, so this phase ends in something the maintainer can try
   on the work laptop. Phase 36 adds the choice on Setup and the rest.
7. **The licences ship with the app.** Whoever hosts the files, Settings shows each model's credit and licence text
   from the build (Task 6). If Dtype hosts a copy of a model (Phase 33's D2), that repository carries the licence
   and notices too.

## Tasks

1. **Rust: the downloader** (`src-tauri/src/stt/download.rs`), with the HTTP stack Phase 33 chose (to be tried
   first: Windows' own, through the `windows` crate, which uses Windows' certificate store and proxy settings):
   - check the free disk space first (the total size plus a margin), and say how much is needed if there isn't
     enough;
   - fetch each file as decisions 2 and 3 say, streaming to disk, never holding a file in memory;
   - report progress as bytes of the whole download, a few times a second at most;
   - stop at once on cancel, keeping the partial file for next time;
   - keep Windows awake while it runs, as a transcription does (Phase 34);
   - no automatic retries beyond what one attempt needs for a redirect. A failure ends the attempt with its kind.
2. **Rust: failures the user can act on.** Map what happens to a kind, with the technical detail kept for D41's
   disclosure (the URL's host and the status, never a full redirected URL with its signature):

   | Kind | When | Draft message |
   |---|---|---|
   | `blocked` | A refusal (401, 403, 407), a certificate that isn't trusted, or a "file" that is a web page (the wrong size or hash on a small HTML answer) | "Your network didn't allow the download from huggingface.co. Try another network, or ask IT to allow it." |
   | `offline` | No connection, DNS failure, timeout | "Couldn't reach huggingface.co. Check your connection and try again." |
   | `busy` | 429 or 503 | "Hugging Face is busy. Try again in a few minutes." |
   | `disk` | Not enough space, or a write fails | "Not enough disk space: the speech models need 0.8 GB." |
   | `mismatch` | A complete file with the wrong size or hash | "The download didn't arrive intact. Try again." |
   | `gone` | 404 or 410 | "This version of DeScribe can't download its speech models any more. Update DeScribe." |

3. **Rust: the folder and the status.** `pack.rs` gets the app's own folder as its source (decision 4), and
   `LocalSttStatus` gains `downloading` with the bytes received and the total. Removing deletes the files and the
   receipt. A download or a removal is refused while a transcription runs, and a transcription while a download
   runs. Partial files older than this build's list are deleted at start.
4. **The commands and the bridge:** start the download (progress on a channel), cancel it, remove the models. They
   take no arguments that name a URL, a host or a path. Add them to the capability, and to `bridge.ts` with schemas
   for what comes back.
5. **Settings, desktop only** (`SettingsView.vue`): a section after the keys. The texts are drafts (D13).

   > **Transcribe on this computer**
   > *(missing)* Transcribes without ElevenLabs, using speech models from NVIDIA.
   > [Download speech models] 0.8 GB from huggingface.co
   > *(downloading)* a progress bar, "340 MB of 0.8 GB", [Cancel]
   > *(ready)* Speech models are installed. [Remove]
   > *(outdated)* This version of DeScribe needs newer speech models. [Download speech models] 0.8 GB
   > *(damaged)* The speech models are damaged. [Download again]
   > *(the CPU can't run it)* This computer can't run the speech models.

   - A real `<button>` for each action, a `<progress>` with a label, and the state changes announced through
     `aria-live` (not every tick). **Remove** asks first, through `ConfirmDialog`.
   - A failed download shows its message in the section, with **Technical details** (D41) and the button again.
   - The size comes from `pack.json`, so it is never typed by hand.
   - The download keeps running when the user leaves Settings, and the section shows it on return. Closing the app
     asks first, as during a transcription (Phase 34).
   - The web build has no such section, and its bundle has none of this code (`__DESKTOP__`).
6. **The licences** (D36):
   - `scripts/notices/models/` (committed): the full text of each licence the chosen models carry (CC-BY-4.0,
     OpenMDW-1.1, or others), copied from the source on the day with its URL and date at the top.
   - `npm run notices` adds a **Speech models** part to `THIRD-PARTY-NOTICES-DESKTOP.txt`, generated from
     `pack.json`: per model its name, copyright line and card, its licence's name, URL and full text, whether the
     file is the publisher's own or was changed and how, and "DeScribe is not affiliated with, sponsored by or
     endorsed by NVIDIA." `-- --check` fails when `pack.json` and the notices disagree, so `release` and
     `desktop:pack` can't ship a model without its licence.
   - If Dtype hosts a copy (D2): its repository's README carries the same credit and the licence files, and says
     what was changed. The maintainer confirms the licence reading before the repository is made public.
7. **The Store** (the maintainer, with the agent's help): submit a build with this phase against the hidden
   listing. In the listing and the certification notes, say that the app can download about a gigabyte of speech
   models from Hugging Face when the user asks, and that they are data, not code (Phase 33's D4 has the policy
   text). Record the wording in reference/desktop.md.
8. **The checklist,** in reference/local-stt.md. On the maintainer's PC with the development-signed app, and on the
   work laptop with the app from the Store. Nothing but the Store's build runs on the laptop.

   | ID | Check |
   |---|---|
   | S1 | A fresh install: Settings says the models are missing, with the size. **Download** runs to *installed*. Record the time and the speed. **On the work laptop this is the proof that the download works on its network.** |
   | S2 | During a download: leave Settings and come back; the progress is still there. **Cancel**, then **Download** again: it carries on from where it stopped. |
   | S3 | Interruptions, on the maintainer's PC: the network cable out mid-download, the PC put to sleep, the app closed (it asks first), then resumed each time. No partial file is ever loaded. |
   | S4 | Failures, on the maintainer's PC, each with its own message: the host blocked in the `hosts` file or by a firewall rule, a full disk (a small virtual disk), a model file altered on disk, a URL that answers 404 (a debug build with a test list). |
   | S5 | **Remove:** the files are gone and the disk space is back; Setup offers no choice (Phase 36); ElevenLabs still works. |
   | S6 | Restart the app: *installed* at once, without hashing a gigabyte again. |
   | S7 | Update the app to a build with the same list: still installed. To a build with a different list: *outdated*, and the old files go once the new ones are in. |
   | S8 | Uninstall the app: the models' folder is gone (record where it was). |
   | S9 | A debug build's Network panel and a capture of the app's connections during a download: only `huggingface.co` and the hosts it redirects to, and the three API hosts as before. Nothing at launch. |
   | S10 | The Windows App Certification Kit on the build. |

9. **Docs:** AGENTS.md (hard rule 2, the Commands table, the generated-files note); DECISIONS (the fourth host, the
   folder, and anything Phase 33 left open); reference/desktop.md (commands, capability, where the models live,
   the Store wording); reference/local-stt.md (the downloader as built, S1–S10); RELEASING.md (changing
   `pack.json`: the hashes, the notices, and that colleagues download again); `.gitignore`.

## Contracts introduced

```ts
// providers/transcription/local/bridge.ts, added to Phase 34's
export type LocalSttStatus =
  | /* Phase 34's states */
  | { state: 'downloading'; pack: SpeechPackInfo; receivedBytes: number; totalBytes: number };

export type DownloadFailure = 'blocked' | 'offline' | 'busy' | 'disk' | 'mismatch' | 'gone';

export interface LocalSttBridge {
  // status, transcribe: Phase 34
  download(opts: { signal: AbortSignal; onProgress: (received: number, total: number) => void }): Promise<void>;
  removeModels(): Promise<void>;
}
```

- Files: `src-tauri/src/stt/download.rs`, `scripts/notices/models/`, the Settings section.
- On disk: `<the app's folder>/speech-pack/<pack id>/` with the model files, `*.part` files while downloading, and
  the receipt.
- AGENTS.md hard rule 2, reworded: the web view's three hosts, and Rust's downloads of the URLs in `pack.json`.

## Acceptance criteria

- [ ] From a fresh install, **Download** in Settings ends with the models installed and verified, and a recording
      can then be transcribed locally with Phase 34's developer switch.
- [ ] The download resumes after a cancel, a dropped network and a restart of the app, and a file that doesn't
      match is never loaded.
- [ ] Each failure in Task 2's table shows its own message, and none leaves the section stuck.
- [ ] **Remove** frees the space. Uninstalling removes the models.
- [ ] The app connects to Hugging Face only after **Download** is clicked, only for the URLs in `pack.json`, and
      sends nothing about the user. The web view's CSP and its three hosts are unchanged, and
      `verify:single-file` passes.
- [ ] `npm run notices -- --check` fails when a model in `pack.json` has no licence text.
- [ ] S1–S10 have results on the maintainer's PC. **On the work laptop, from the Store: S1, S2, S5, S6 and S8,** or
      *not run* with the reason. If S1 fails there, take it to the maintainer (D55: it no longer stops Phase 36).
- [ ] The maintainer has confirmed the licence reading, and the listing says what is downloaded.
- [ ] New UI reviewed against D13 and for keyboard and screen-reader use.
- [ ] The Definition of Done in AGENTS.md, and `cargo test`.

## Required tests

- **Rust (`cargo test`), against a local test server** (no real downloads in tests): a whole file; a redirect; a
  resume with a range, and a server that ignores the range; a wrong size; a wrong hash; a web page where the file
  should be; each status in Task 2's table; cancel mid-file; not enough disk space; a redirect to plain HTTP
  refused; the outdated and damaged states; removal.
- **Vitest:** the bridge's schemas; `SettingsView` for every state, the progress, each failure message, the
  confirmation before **Remove**, and nothing rendered when `__DESKTOP__` is false; the notices script on a sample
  `pack.json`, with and without a licence file.
- **E2E (web build):** the existing suite unchanged.
- **By hand:** S1–S10. The agent's rows over CDP against a local test server standing in for Hugging Face, in a
  debug build with a test list.
- **Real downloads** happen only in S1 and S2, by the maintainer.

## Out of scope

- The choice on Setup, progress of a transcription, About's wording and PRIVACY.md: Phase 36.
- Installing the models from files the user already has (copied by IT, or from a colleague). It would help where
  Hugging Face is blocked, and the hash check already makes it safe. Record it as a follow-up if S1 fails anywhere.
- A mirror to fall back on, a choice of models, or models per language.
- Downloading in the background with the app closed, or updating the models without an app update.
- An optional package in the Microsoft Store (D50: not chosen).

## Handoff

*(Where the files are hosted and kept, the HTTP stack as built, S1–S10 on both machines, the Store wording, and
what Phase 36 needs.)*

**Phase 33 (2026-11-15):** updated this file with *Phase 33's findings* above, which
override the tasks where they differ (DECISIONS.md D51). Nothing in this phase has been built.

**Phase 35 (2026-11-16).** Built on `phase-35-speech-pack`. DECISIONS D54. The downloader as built and the S table are
in reference/local-stt.md (*The download as built*); the commands, folders and switches in reference/desktop.md.
- **As built:**
  - The models live in the package's `LocalCache\speech-pack\<pack id>\` (unpackaged:
    `%LOCALAPPDATA%\io.github.danielbird.describe\speech-pack\`).
  - WinHTTP, as Phase 33 chose. One finding: a synchronous `WinHttpReadData` fills its whole buffer before it
    returns, so the reader asks `WinHttpQueryDataAvailable` first (otherwise progress moved a megabyte at a time).
  - Commands `stt_download`, `stt_download_cancel`, `stt_remove_models`; `stt_status` gains `downloading`.
  - Settings' band **Transcribe on this computer**, after API keys, with Task 5's texts as drafted, except that
    "0.8 GB from huggingface.co" sits beside every download button (**Download again** included), and Cancel
    and Remove announce their end only to screen readers (D13).
- **Different from this file:**
  - **A partly downloaded pack is *missing*, not *damaged*** (Phase 34's check called a missing file damaged). So
    after Cancel the band offers the download again.
  - **F5 cancels a download,** as it cancels a run.
  - **Task 2's kinds, mapped:** 500, 502 and 504 count as `busy` with 429 and 503; any other 4xx as `blocked`; a
    redirect to plain HTTP and more than ten redirects as `blocked`; a body that ends short as `offline`; a body
    longer than listed as `blocked`.
  - **The release check:** `release.mjs` runs `notices --check --web`, which now also checks the desktop file's
    Speech models part, without cargo.
- **The licences:** CC BY 4.0 from Creative Commons' plain text, OpenMDW-1.1 from its GitHub repository at a pinned
  commit (its page is HTML), both retrieved 2026-11-15. **The maintainer still has to confirm the reading**
  (reference/local-stt.md, *The licences*).
- **Checks:** `cargo test` (69), Vitest, lint, typecheck, build and `verify:single-file` pass. The agent's S rows ran
  on the debug exe against `scripts/speech-pack-test-server.mjs`, with no real download.
- **Open, for the maintainer:**
  - S1 and S2 with Hugging Face; S3, S4's blocked host, firewall and full disk, S5's disk space, S7, S8, S9's capture
    and S10, on the PC with the development-signed app.
  - The Store: submit a build with this phase to the hidden listing, with the description and certification-note
    wording drafted in reference/desktop.md (*The Store*), and record what Partner Center took.
  - **On the work laptop, from the Store: S1, S2, S5, S6 and S8.** If S1 fails there, take it to the maintainer,
    with installing the models from files as the follow-up. It no longer stops Phase 36 (D55, 2026-11-16).
  - Before colleagues get this: About's data-flow text and PRIVACY.md must say the app downloads from Hugging Face
    (Phase 36 writes both).
- **For Phase 36:**
  - The models' status is in `useSpeechPackStore().status` (not the settings store, as Phase 36's Task 2 says).
    `refresh()` asks Rust; download and remove update it.
  - Settings' band is `src/ui/components/SpeechPackSection.vue`; the last run's line (Phase 36, Task 7) goes in its
    *ready* state.
  - The "models missing" error in `local/errors.ts` can now point at the band.
