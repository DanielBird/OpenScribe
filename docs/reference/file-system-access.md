# File System Access on `file://` and OneDrive — reference for DeScribe

*Written 2026-10-15 in Phase 10, from the runs in the [verification log](#verification-log): Edge and Chrome on the
maintainer's PC, with a personal OneDrive, plus Playwright. **[Go](#gono-go) for Phases 14–15.** To check a new
browser version, run the [checklist](#how-to-run-the-checklist) again.*

Official docs: [MDN `showDirectoryPicker`](https://developer.mozilla.org/docs/Web/API/Window/showDirectoryPicker) ·
[WICG File System Access](https://wicg.github.io/file-system-access/) ·
[Chrome: persistent permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api) ·
[Chrome: multiple readers and writers](https://developer.chrome.com/blog/new-dev-trial-for-multiple-readers-and-writers) ·
[Chromium's blocked folders](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc) ·
[Microsoft: OneDrive sync conflicts](https://learn.microsoft.com/en-us/troubleshoot/sharepoint/sync/troubleshoot-sync-issues)

## What DeScribe needs

From [PROJECTS.md](../PROJECTS.md) §5.2, in Edge and Chrome, from a page opened over `file://`:
- pick a folder inside OneDrive once, with read and write access;
- keep its handle in IndexedDB and, on later visits, get access back with at most one click;
- list `sessions/`, read each file's size and `lastModified`, read the files, and write files with
  `createWritable()`;
- cope with files that are only in the cloud (Files On-Demand), with being offline, and with OneDrive's conflict
  copies.

## Documented behaviour

What the documentation says. None of these sources mention `file://`; the [checklist](#checklist) checked each point
there.

| Topic | What the docs say | Checked by |
|---|---|---|
| Folders the picker refuses | Chromium refuses the home folder, Desktop, Documents and Downloads themselves, but allows their subfolders. It refuses everything under AppData, Program Files and Windows. The OneDrive folder is a subfolder of the home folder, so it should be allowed. With OneDrive's Known Folder Move, Documents and Desktop live inside OneDrive but are still refused themselves. | F2 |
| Permission on later visits | From Chrome 122 there's a three-way prompt: **Allow this time**, **Allow on every visit**, **Don't allow**. It appears when the page calls `requestPermission()` on a handle restored from IndexedDB on a later visit. Without "every visit", access lasts until the last tab of the origin closes, and a tab left in the background for a while can lose it. An immediate reload doesn't show the prompt: close all the tabs first. After three dismissals the plain prompt comes back. Installed apps (PWAs) keep access automatically. **On `file://` the three-way prompt doesn't appear** (F4, F5): it has two buttons, and access ends with the browser session. | F4, F5 |
| Storage shared by every local file | In Chromium, every page opened from disk shares one storage ([DECISIONS.md](../DECISIONS.md) D3), so any DeScribe file should see the stored handle. | F6 |
| Swap files | `createWritable()` writes to a swap file, `<name>.crswap`, in the same folder, and replaces the file on `close()`. `abort()` deletes it. From Chrome 121, `createWritable({ mode })` takes `'siloed'` (the default: each writer has its own swap file) or `'exclusive'` (a second writer fails while the first is open). | F3, F12 |
| OneDrive conflict copies | For a file that isn't an Office file, OneDrive keeps both versions. The online version keeps the name. The copy on this computer gets the device name appended, e.g. `Report-JOHNS-SURFACE.txt`. There are at most 5 conflict versions. **F10 found** that the device name goes before the last extension, `.json`: `x--3f9a1c2e.summary-Aristotle.json`. PROJECTS.md §5.2 had assumed `…-LAPTOP-123.summary.json`. | F10 |
| Files On-Demand | Nothing about File System Access. Reading a file that is only in the cloud should download it first. What happens offline isn't documented. **F8 and F9 found** that it downloads on read, and fails with `NotReadableError` offline. | F8, F9 |

## How to run the checklist

You need about an hour, Edge and Chrome on Windows, and a OneDrive folder that syncs. The probe
(`scripts/spikes/fsa-probe.html`) makes no network requests.
- Each button writes a line to **Results**. The log survives reloads and restarts.
- Edge and Chrome each keep their own log.
- **Read all** serves F7, F8, F9 and F11, so type a **Note** (e.g. "F8, online only, parallel 1") before or after
  each run.

**Where:** if you can, use a Demant-managed laptop and the work OneDrive (`OneDrive - Demant`), which is what the
team will use. Company browser policies can block folder access, and a personal computer wouldn't show that. If you
use another OneDrive, say which in the results.

**Once**, in PowerShell from the repository folder:

```powershell
Get-ChildItem env:OneDrive*       # OneDriveCommercial is the work OneDrive; it's missing if no work account is signed in
node scripts/spikes/make-probe-files.mjs "$env:OneDriveCommercial\Describe probe"
```

This writes 300 files of about 0.7 MB each (≈ 210 MB) to `Describe probe\sessions\`. The last line names the folder:
check it's inside OneDrive. The script refuses a path that starts at the root of the drive, which is what an empty
variable gives. Wait until OneDrive shows every file as synced.

**In Edge, then in Chrome.** Open `scripts/spikes/fsa-probe.html` in that browser (right-click → Open with).
1. **F1:** read the Environment block. Then open `edge://policy` (in Chrome, `chrome://policy`) and note any policy
   whose name contains `FileSystem`, e.g. `DefaultFileSystemWriteGuardSetting`, with its value.
2. **F2:** click **Pick folder**.
   - Try Documents, Desktop, Downloads and the OneDrive root, and note what the browser says for each.
   - Then pick `Describe probe`. Note the wording of each prompt (viewing, then editing).
3. **F13:** click **Clipboard**, then paste into Notepad.
4. **F14:** click **OPFS**.
5. **F3:** click **Write**.
   - Find the file in Explorer, and after a minute on OneDrive on the web.
   - Look for any `.crswap` file in either place.
6. **F12:** click **Overwrite twice quickly**.
7. **F7:**
   - Click **List**. Then click **Read all** with parallel 1, and again with parallel 8.
   - Click **Store handle**.
8. **F4:**
   - Reload the page (F5), then click **Load handle** and note the permission.
   - Leave the tab in the background for 10 minutes, come back, and click **List**.
   - Close **every** tab showing a local file (or close the browser), then open the probe again.
   - Click **Load handle**, then **Request permission**. Note the prompt's options and wording, and choose **Allow
     on every visit** if it's offered.
   - Click **OPFS** again.
9. **F6:**
   - Copy `fsa-probe.html` to the Desktop as `probe-copy.html` and open the copy.
   - Click **Load handle**, then **List**. If the permission is `prompt`, also click **Request permission**.
   - Go back to the original page.
10. **F8:**
    - In Explorer, right-click `Describe probe\sessions` → **Free up space**, and wait for the cloud icons.
    - In the probe, click **List** and note the fingerprint. Are the icons still clouds?
    - Click **Read all** (parallel 1). Note the time, and whether the icons changed.
    - Click **List** again and compare the fingerprint.
    - **Free up space** again, then **Read all** with parallel 8.
11. **F9:**
    - **Free up space** again, then turn on airplane mode, or unplug the network.
    - Click **List**, then **Read all**.
    - Reconnect.
12. **F11:**
    - Click **List**. In Explorer, rename one session file and delete another.
    - Click **Read all**.
    - Rename the file back, and restore the deleted one from the Recycle Bin.
13. Click **Copy results**, and save the text for this browser.

**After both browsers:**
14. **F5:** close and reopen each browser, open the probe, and click **Load handle**, then **List**. Then restart
    Windows and do it again. Copy the results again.
15. **F10:**
    - In `Describe probe`, create `conflict--3f9a1c2e.summary.json` with any text, and let it sync.
    - Pause OneDrive (OneDrive icon → ⚙ → **Pause syncing**). Change the file in Notepad.
    - On OneDrive on the web, upload a different file with the same name (**Replace**).
    - Resume syncing, and note the exact name of the copy OneDrive makes.

**Report:**
- Paste both browsers' results into a Claude session, with your notes on the prompts, Explorer and OneDrive on the
  web. For example: "Phase 10 Part B: here are the results".
- Never paste file paths you'd rather not have in the repository. The log shows only the page's file name and the
  folder's name.

## Checklist

Browsers: Edge 155.0.4283.45 (Chromium 155.0.8059.40), personal OneDrive · Chrome 155.0.8059.40, same PC and OneDrive · Playwright Chromium 156.0.8078.4 (Playwright 1.64.1, headless shell,
the e2e `chromium` project's defaults).

**A plain folder at first.** During the first runs, the OneDrive client wasn't running on the maintainer's PC, so
`…\OneDrive\Describe probe` was an ordinary folder at the OneDrive path:
- there was no `OneDrive.exe` process, and no sync root registered for the folder;
- the files had no cloud reparse point.

OneDrive was started later the same day, and every check that depends on it was run again. From then on, the folder, `sessions` and every file carried the cloud-files
reparse tag `0x9000601A` (`IO_REPARSE_TAG_CLOUD_6`), and the sync root was registered. Rows run after that say
*synced*.

| ID | Check, and what to record | Edge | Chrome | Playwright Chromium |
|---|---|---|---|---|
| F1 | Opened from `file://`: `isSecureContext` true, `showDirectoryPicker` present. Any `FileSystem` policies set (`edge://policy`, `chrome://policy`), and which OneDrive (work or personal). | **Pass.** Secure context, `showDirectoryPicker` present. Personal OneDrive. Policies: *not run*. This is a personal PC with no company policies; check on a Demant-managed laptop (see [Go/no-go](#gono-go)). | **Pass.** Secure context, `showDirectoryPicker` present. Policies: *not run*. This is a personal PC with no company policies; check on a Demant-managed laptop (see [Go/no-go](#gono-go)). | **Pass.** Secure context, `showDirectoryPicker` present. |
| F2 | Pick a subfolder of OneDrive (`Describe probe`). Also try the OneDrive root, Documents, Desktop and Downloads: which are refused, and with what message? Note the wording of the view and edit prompts. | **Partly.** `Describe probe` picked, with `readwrite` granted at once. The OneDrive root can be picked too. Documents, Desktop and Downloads: *not run*, because Chromium's source refuses them by design (see [Documented behaviour](#documented-behaviour)). The prompts' wording: *not run*; it only matters for the User Guide. | **Partly.** `Describe probe` picked, with `readwrite` granted at once. The refused folders and the prompts' wording: *not run*, as for Edge. | – (the picker can't be automated) |
| F3 | **Write:** the file shows in Explorer and on OneDrive on the web. Was a `.crswap` file seen (the log lists one before `close()`)? Did OneDrive sync it? | **Pass** (synced). 0.95 MB in 59 ms (79 ms before syncing). `<name>.crswap` was next to the file before `close()` and gone after it. There was no `.crswap` on OneDrive on the web, and none was left on disk. | **Pass** (synced). 0.95 MB in 189 ms (162 ms before syncing), with the same `.crswap` before `close()` only. There was none on OneDrive on the web or on disk. | – |
| F4 | After a reload, **Load handle**: what does `queryPermission` say? After 10 minutes in the background, does **List** still work? After closing every tab, what does **Request permission** offer? Is "Allow on every visit" there? | **Pass** (synced). After a reload, `queryPermission` was `granted`. After about 10 minutes in a background tab, **List** still worked. After every tab was closed and the probe reopened, it was `prompt`, and one **Request permission** click brought back `granted`. The prompt had **two buttons**, with no "Allow on every visit". | **Pass** (synced), the same as Edge: `granted` after a reload and after about 8 minutes in the background; `prompt` after reopening, and one click brought back `granted`. The prompt had two buttons, with no "Allow on every visit". | – |
| F5 | After "Allow on every visit": is permission still `granted`, with no prompt, after a browser restart and after a Windows restart? | **Not kept.** After a browser restart, and again after a Windows restart (both opening `fsa-copy.html`), `queryPermission` was `prompt`, and **List** failed with `NotAllowedError`: "The request is not allowed by the user agent or the platform in the current context." The prompt never offered "Allow on every visit" (two buttons only), so there was nothing to keep. | **Not kept.** The same as Edge, after both restarts: `queryPermission` was `prompt`, and **List** failed with `NotAllowedError`: "The request is not allowed by the user agent or the platform in the current context." The prompt never offered "Allow on every visit" (two buttons only), so there was nothing to keep. | – |
| F6 | From `Desktop\probe-copy.html`: is the stored handle there, and with which permission? Does **List** work? | **Pass** (synced). From `Desktop\fsa-copy.html`, the stored handle loaded with `granted` (the original page had been granted in the same browser session), and **List** worked. Every local page shares the handle and its permission. | **Pass,** the same as Edge. | – |
| F7 | 300 files, synced and on the device: **List** (listing and stat times), **Read all** at parallel 1 and 8 (time, MB). | **Synced:** listing 304 files took 27–31 ms, plus 41–44 ms for the stats. **Read all** read 209.92 MB in 791 ms at parallel 1 and 613 ms at parallel 8, with no errors. Before syncing it took 799 ms at parallel 1. OneDrive adds nothing measurable for files on the device. The fingerprint, `059586f1`, never changed. | **Synced:** listing took 24–25 ms, plus 43–44 ms for the stats. **Read all** took 788 ms at parallel 1 and 614 ms at parallel 8, with no errors. Before syncing: 811 and 630 ms. The fingerprint, `059586f1`, is the same as Edge's. A first List in Chrome, of `sessions` picked directly, took 1.31 s once and didn't recur. | – |
| F8 | Online only (**Free up space**): does **List** give sizes and dates without downloading (do the icons stay clouds)? Is the fingerprint the same as in F7? **Read all** at parallel 1 and 8: times. Are the files kept on the device afterwards, and does the fingerprint change? | **Pass** (synced). After **Free up space**, **List** took the usual 25 ms plus 42 ms of stats, so sizes and dates come without downloading. The fingerprint (`059586f1`) didn't change. **Read all** then downloaded the files: 55.3 s at parallel 1 (184 ms per file) and 61.6 s at parallel 8, so reading in parallel doesn't help. Afterwards the files stayed on the device (the next **Read all** took 0.8 s), and the fingerprint still didn't change. The Explorer icons weren't noted. | **Not run** as intended. **Read all** took 914 ms, so the files were still on the device. Not repeated: downloading is OneDrive's work, and F9 shows Chrome reading the same online-only files. **List** took **11.29 s** here (stats 49 ms), with the fingerprint unchanged, see the note under the table. | – |
| F9 | Online only and offline: **List**, then **Read all**. Which error (`name`, `message`)? | **`NotReadableError`** for every file: "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired." Despite the wording, it isn't a permission problem: **List** still worked offline, with the same sizes, dates and fingerprint. 300 failures took 9.6 s at parallel 8, about 0.25 s each. | **`NotReadableError`** for every file, with the same message as Edge. **List** worked offline (479 ms, the same fingerprint). 300 failures took 16.9 s at parallel 1, about 56 ms each. | – |
| F10 | A OneDrive conflict on `conflict--3f9a1c2e.summary.json`: the exact name of the conflict copy. Mark it *not run*, with Microsoft's documented pattern, if no conflict could be made. | **`conflict--3f9a1c2e.summary-Aristotle.json`** (synced). OneDrive was paused, the file changed in Notepad, and a different version uploaded on the web with **Replace**. When syncing resumed, the web version kept the name and the local version was renamed, with the device name inserted before `.json`. The name is `Aristotle`, as OneDrive shows it, while `%COMPUTERNAME%` is `ARISTOTLE`. | The same file: conflicts are OneDrive's, not the browser's. | – |
| F11 | A file renamed or deleted in Explorer after **List**: **Read all**'s error. | **`NotFoundError`** for both the renamed and the deleted file: "A requested file or directory could not be found at the time an operation was processed." The other 298 were read. | **`NotFoundError`** for both files, with the same message as Edge. The other 297 were read. | – |
| F12 | **Overwrite twice quickly:** does a write fail? Which write is in the file? Any stray file? | **Neither fails, no stray file,** synced or not. Synced: A ran 0–274 ms, B 112–185 ms. Before syncing: A 0–269 ms, B 116–174 ms. The file holds A: the last `close()` wins. | **Neither fails, no stray file.** Synced: A ran 0–449 ms, B 115–268 ms. Before syncing: A 0–576 ms, B 101–574 ms, with B ending just before A's `close()`. The file holds A both times. | – |
| F13 | **Clipboard** works from `file://` (paste to check). | **Pass.** `writeText` succeeded from a click, with no prompt, and the text pasted into Notepad. | **Pass,** the same as Edge. | **Denied without a grant:** `NotAllowedError: … Write permission denied`. It works with `context.grantPermissions(['clipboard-read', 'clipboard-write'])`, and `readText` then returns the text. The new headless mode (`channel: 'chromium'`) allows it without a grant. |
| F14 | **OPFS** works on `file://`, and its handle can be stored in IndexedDB. | **Fails,** as in Playwright: `getDirectory()` throws `SecurityError`. The app doesn't need OPFS; only the e2e harness would have used it. | **Fails** with the same `SecurityError`. | **Fails:** `navigator.storage.getDirectory()` throws `SecurityError` ("…certain files are unsafe for access…"), in both headless modes. It works only with the launch flag `--allow-file-access-from-files`, see [E2E harness](#e2e-harness). |

**Slow listings in Chrome.** Chrome listed `Describe probe` and `sessions` in 24–29 ms most of the time, as Edge always did. But twice it took about 11 s (11.29 s and 11.45 s). Both times were within a minute or two of the PC coming back online. Once it took 1.31 s (the first List of `sessions`), and offline it took 479 ms. The stats and the fingerprint were normal each time. The likely cause is that OneDrive was catching up after being offline, and Windows held the directory listing until it was done. Edge never listed during such a moment, so this may not be Chrome-specific.

## Facts

Measured with Edge 155.0.4283.45 and Chrome 155.0.8059.40 on Windows, with a personal OneDrive, on 2026-10-15. The
two browsers behaved the same unless a point says otherwise.

**Access**
- A page opened from `file://` is a secure context, and it has `showDirectoryPicker` (F1).
- A subfolder of OneDrive and the OneDrive root can both be picked. Picking one grants `readwrite` at once (F2).
- The handle stored in IndexedDB survives reloads, browser restarts and Windows restarts. Every local page can read
  it, including another DeScribe file (F4–F6).
- **Access lasts as long as a local page stays open in the browser** (F4–F6):
  - It survives reloads, and at least 10 minutes in a background tab.
  - Another local page opened in the meantime gets `granted` too.
- **Access ends when the browser closes** (F5):
  - On the next visit, `queryPermission` says `prompt`, and listing or reading throws `NotAllowedError`.
  - One click that calls `requestPermission` shows a two-button prompt. Allowing it gives `granted` again (F4).
  - **"Allow on every visit" isn't offered on `file://`.** So this happens once in every browser session.

**Reading**
- **Files on the device** (F7):
  - Listing 300 files takes about 25–30 ms, and reading their sizes and dates about 40–50 ms.
  - Reading all 300 (210 MB) takes about 0.8 s, or 0.6 s with 8 at a time.
  - OneDrive running adds nothing measurable.
- **Files that are only in the cloud** (F8):
  - Listing them and reading their sizes and dates is just as fast, and downloads nothing.
  - Reading them downloads them: about 55 s for 210 MB on this connection. Reading 8 at a time didn't help (62 s).
  - Afterwards they stay on the device.
- Size and `lastModified` don't change when OneDrive frees a file or downloads it again. The fingerprint was
  `059586f1` throughout, in both browsers (F8).
- **Offline,** listing still works, but reading a file that's only in the cloud throws `NotReadableError`. Its message
  blames permissions, wrongly (F9).
- A file renamed or deleted after the listing throws `NotFoundError` (F11).
- Twice, a listing in Chrome took about 11 s, both times within a minute or two of the PC coming back online (see the
  note under the checklist).

**Writing**
- `createWritable()` writes `<name>.crswap` next to the file, and replaces the file on `close()`. The swap file is gone
  afterwards, and OneDrive never synced one (F3).
- Two overlapping writes to one file both succeed with the default `'siloed'` mode. The last `close()` wins, and
  nothing is left behind (F12).

**OneDrive**
- **Conflict copies** (F10):
  - A conflict on a file that isn't an Office file keeps the online version under its own name.
  - The local version is renamed with `-<device name>` before the last extension:
    `conflict--3f9a1c2e.summary-Aristotle.json`.
  - The device name is as OneDrive shows it (`Aristotle`), not `%COMPUTERNAME%` (`ARISTOTLE`).
- Explorer's own copies add ` - Copy` before the extension (`….summary - Copy.json`).
- A file deleted while it's only in the cloud goes to OneDrive's online recycle bin, not to the Windows one.

**Other**
- `navigator.clipboard.writeText` works from a click on `file://` (F13).
- OPFS (`navigator.storage.getDirectory()`) throws `SecurityError` on `file://` in Edge, in Chrome and in Playwright
  (F14).

## Rules for Phase 14

1. **Permission.**
   - `init()` reads the stored handle and calls `queryPermission({ mode: 'readwrite' })`. On `granted`, it loads the
     project. On `prompt`, the status is `reconnect`.
   - Expect `reconnect` on every new browser session: `file://` has no lasting permission (F5).
   - **Reconnect "<name>"** calls `requestPermission({ mode: 'readwrite' })` straight from the click, before any
     `await`, because the browser requires the click.
   - A `NotAllowedError` from any folder operation means access has ended. Switch to `reconnect`.
   - `denied` was never seen. Treat it like `prompt`, and also offer **Open another project…**.
2. **Errors.** Map the browser's errors to a `FolderErrorKind` like this, and anything else to `io`:

   | Error `name` | Seen when | Kind | Message (a draft; trim it under D13) |
   |---|---|---|---|
   | `NotAllowedError` | access ended with the browser session (F5) | `permission` | "DeScribe no longer has access to the project folder. Reconnect it." |
   | `NotReadableError` | a file that's only in the cloud, read offline (F9) | `offline` if `navigator.onLine` is false, otherwise `io` | `offline`: "This file is only in OneDrive and the computer is offline. Connect, or set the folder to Always keep on this device." `io`: "DeScribe couldn't read this file. If it's only in OneDrive, check the connection and try again." |
   | `NotFoundError` | renamed or deleted after the listing (F11) | `not_found` | During a load, skip the file and list it under "couldn't be read". The next refresh won't list it. |
   | `AbortError` | the picker was dismissed (MDN) | `cancelled` | None. |

   **Never offer Reconnect for `NotReadableError`.** Its message mentions permissions, but the permission is still
   `granted` (F9).

   **Nor for a folder just picked.** A `permission` error from **Open project…** or **New project…** (the picker, or
   creating `describe-project.json`) means access was never granted: a declined prompt, or a company policy that
   blocks folder access. The store shows `PROJECT_MESSAGES.accessRefused` instead (added 2026-10-30, after the
   "no longer has access" message appeared on a first run on a work computer).
3. **Names.** Only names ending in `.json` are session-file candidates, so `*.crswap` swap files and stray files
   such as a `.json.txt` are ignored. A swap file only exists during a write, though a crash could leave one behind.
4. **Conflict copies.** This replaces the pattern in PROJECTS.md §5.2. OneDrive puts the device name before `.json`,
   e.g. `P07-Hamburg-home-visit--3f9a1c2e.summary-LAPTOP-123.json`.
   - Base names have no dots (`sessionBaseName`), so `classifySessionFile` reads a name as
     `<base>.<kind><extra>.json`, where `<kind>` is `transcript` or `summary`.
   - A non-empty `<extra>` marks a copy: `-LAPTOP-123` from OneDrive, ` - Copy` from Explorer, or anything else.
     Don't depend on its exact format. OneDrive keeps up to 5 conflict versions, and only the first was seen.
   - Copies are still read, and the session `id` inside decides, as §5.2 says.
5. **The text cache key holds.** Size and `lastModified` survive "Free up space" and a download (F8). The cache key
   (file name, `lastModified`, size; DECISIONS.md T12) works as planned.
6. **First load.**
   - Read transcripts **one at a time**, with the planned progress text. Eight at a time was only about 20% faster
     for files on the device, and slower for downloads.
   - The first time a computer opens a project whose files are only in the cloud, reading 300 sessions takes about a
     minute on a connection like this one. After that, the text cache serves them.
7. **Refresh.** A listing can take about 11 s while OneDrive catches up after being offline. `refresh()` runs in the
   background, never blocks the UI, and is skipped while another runs, as Phase 14 plans.
8. **Writes.** Use `createWritable()` with its default mode.
   - Overlapping writes don't fail, and the last `close()` wins (F12). So what protects a colleague's edit is the
     change check before writing (PROJECTS.md §5.2). `'exclusive'` would add nothing to it.
9. **Help.** For offline work, the User Guide says to right-click the project folder and choose **Always keep on this
   device**.

## E2E harness

**Decision: an in-memory handle, not OPFS.** This is decided by the Playwright results, so the Edge and Chrome
results can't change it.
- OPFS throws `SecurityError` on `file://` in Playwright's Chromium (F14).
- The flag that allows it, `--allow-file-access-from-files`, also changes `window.origin` from `null` to `file://`.
  The e2e tests would then no longer run under the origin colleagues have. Requests to the APIs carry
  `Origin: null` from `file://` ([elevenlabs-stt.md](elevenlabs-stt.md#cors-verified-2026-10-13)).

**Both options were tried** (2026-10-15), with the probe's own buttons, against an init script that replaces
`showDirectoryPicker`:
- **A, OPFS with the flag:** passed every step.
- **B, an in-memory handle with no flag:** passed the same steps.

The steps were: Pick folder, List, Read all, Write, Overwrite twice quickly, Store handle, a reload, Load handle,
List and Read all. Then the permission was switched to `prompt`: Load handle showed `prompt`, and Request permission
granted it. Neither option made a request or logged a console error.

What an in-memory `useProjectFolder` needs (B):
- **The handles:**
  - `FakeDirectoryHandle` has `kind`, `name`, `entries()`, `getFileHandle(name, { create })`,
    `getDirectoryHandle(name, { create })`, `queryPermission()` and `requestPermission()`.
  - `FakeFileHandle` has `getFile()`, which returns a real `File` with `lastModified`, and `createWritable()`,
    whose `write` and `close` replace the text.
  - A missing name throws `DOMException(…, 'NotFoundError')`.
- **Surviving a reload:**
  - Init scripts run again on every navigation, so the files live in `sessionStorage` (as JSON, written on each
    `close()`) and are rebuilt from there, or from the seed the first time.
  - `sessionStorage` holds only a few MB, so keep seed files small.
- **Surviving IndexedDB:**
  - Storing a class instance doesn't fail. The structured clone keeps its own fields (`kind`, `name`, an id) and
    drops its methods.
  - The harness gives each handle a path id and revives it when it's read:

    ```js
    const resultOf = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result').get;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      const req = get.apply(this, args);
      Object.defineProperty(req, 'result', { get: () => revive(resultOf.call(req)) });
      return req;
    };
    // revive(v): a value, or a property of it (e.g. { handle, projectName }), with a __fakePath
    // becomes the live handle with that path.
    ```

- **`permission: 'prompt'`:** the fake handles read a switch, e.g. `window.__fakePermission`, that the test sets
  with another init script before a reload.
- **Clipboard:** grant `clipboard-read` and `clipboard-write` in the context (F13), as Phase 14 planned.

**As built in Phase 14** (`tests/e2e/projectFolder.ts`): the in-memory handles and the IndexedDB revive above, with
one change. **The files live in the spec's Node process, not in `sessionStorage`.**
- The page reads them through `page.exposeFunction` bindings the first time a handle is used, and keeps them as real
  `File`s. Each `close()` of a writable sends the new text back.
- Why: `sessionStorage` holds only a few MB, and the 300-hour perf project is 188 MB. Node also makes `files()`
  (what the app wrote) and a colleague's change (`put()`) plain function calls, and the files survive reloads without
  a copy in the page.
- `permission` and the folder the next picker returns are kept in Node too, so a reload keeps them. Picking a folder
  grants access, as the real picker does (F2).
- Handle methods are on the prototype, not fields: a function in an own field makes the structured clone into
  IndexedDB throw `DataCloneError`.
- `holdReads(prefix)` holds reading a file's text, not its size and date, like a cloud-only file (F8).

## Go/no-go

**Go for Phases 14 and 15** (2026-10-15). F1–F4 pass in Edge 155 and in Chrome 155. A page opened from `file://`
can:
- pick a OneDrive folder;
- read and write it;
- keep its handle;
- get access back with one click.

PROJECTS.md §9 Q4 (what if the spike fails) is therefore not needed.

Phase 14 must build these mitigations ([Rules](#rules-for-phase-14)):
- **Reconnect** once per browser session, because `file://` never offers "Allow on every visit";
- an offline message for `NotReadableError`, never shown as a permission problem;
- the conflict-copy rule, with the device name before `.json`;
- a refresh that doesn't block the UI while OneDrive catches up;
- the in-memory e2e harness.

**Open before Phase 14 ships.** These runs used a personal OneDrive on a personal PC.
- Run F1–F4 once on a Demant-managed laptop with `OneDrive - Demant`.
- Check `edge://policy` (and `chrome://policy`) there for policies with `FileSystem` in their name.
- A company policy that blocks folder access would make this a no-go on those laptops.
- If only OneDrive fails there, the fallback is a local folder ([PROJECTS.md](../PROJECTS.md) §9 Q4 (d)). A policy
  that blocks the browser's folder access blocks local folders too.
- The natural place is Phase 14's manual TESTING.md row: "open a real OneDrive project in Edge and in Chrome".

## Verification log

| Date | Where | What | Result |
|---|---|---|---|
| 2026-10-15 | Playwright Chromium 156.0.8078.4, headless shell | F1, F13, F14 | As in the checklist. No network requests, no console errors or CSP violations. |
| 2026-10-15 | Playwright Chromium 156.0.8078.4, new headless (`channel: 'chromium'`) | F13, F14 | F13 works without a grant. F14 fails with the same `SecurityError`. |
| 2026-10-15 | Playwright Chromium 156.0.8078.4, `--allow-file-access-from-files` | OPFS, harness A | OPFS works, and `window.origin` becomes `file://` (otherwise `null`). In OPFS, `createWritable()` showed `<name>.crswap` in the folder before `close()`, and only the file after it. **Overwrite twice quickly:** A held its writer open 0–236 ms, B ran 105–117 ms. Both succeeded and the file held A: the last `close()` wins, with no error and no stray file. This is OPFS, not a OneDrive folder; F3 and F12 check the real disk. |
| 2026-10-15 | Playwright Chromium 156.0.8078.4, headless shell | Harness B (in-memory) | Passed, see [E2E harness](#e2e-harness). |
| 2026-10-15 | Edge 155.0.4283.45 (Chromium 155.0.8059.40), the maintainer's PC, personal OneDrive (`…\OneDrive\Describe probe`) | F1, F2, F3, F7, F12, F13, F14 (first pass) | As in the checklist. Pick, store, load and request all returned `granted` within the first visit, so they don't yet test F4. |
| 2026-10-15 | Chrome 155.0.8059.40, same PC and OneDrive | F1, F2, F3, F7 (List only), F12, F13, F14 (first pass) | As in the checklist. `sessions` was picked instead of `Describe probe`, so Read all found nothing, and the two write tests left `probe-*.json` files in `sessions\` (to be removed before F7/F8). |
| 2026-10-15 | Chrome 155.0.8059.40 | F2 (`Describe probe`), F7 | After the two stray files were removed: as in the checklist. |
| 2026-10-15 | Edge and Chrome, as above | F4 | After a reload, `queryPermission` was `granted`. After about 10 minutes in a background tab, **List** still worked. After the browser was closed and reopened, **Request permission** showed a prompt, and granting it restored access. |
| 2026-10-15 | The maintainer's PC | Is the folder synced? | **No.** No `OneDrive.exe` process, and no sync root registered for `…\OneDrive`. The session files were plain files (`fsutil reparsepoint query`: "not a reparse point"). The personal account is configured but the client wasn't running. |
| 2026-10-15 | The maintainer's PC, after starting OneDrive | Is the folder synced? | **Yes.** `OneDrive.exe` was running, and a sync root was registered for `…\OneDrive` (Personal). All 304 items in `Describe probe` (2 folders, 302 files) carried reparse tag `0x9000601A`, the cloud-files tag. `attrib` showed no pinned (P) or online-only (U) flag, so the files were on the device in the default state. |
| 2026-10-15 | Edge 155.0.4283.45, synced | F2 (OneDrive root), F3, F4, F6, F7, F12, F13, F14 | As in the checklist. |
| 2026-10-15 | Chrome 155.0.8059.40, synced | F2, F3, F4, F6, F7, F12, F14 | As in the checklist. |
| 2026-10-15 | Edge 155.0.4283.45, synced | F8, F9, F11 | F8 and F11 as in the checklist. F9 needs a rerun: the read downloaded every file, so the PC was still online. |
| 2026-10-15 | Edge 155.0.4283.45, synced, airplane mode | F9 (rerun) | As in the checklist: `NotReadableError` for every online-only file, while **List** still worked. |
| 2026-10-15 | Chrome 155.0.8059.40, synced | F8, F9, F11 | F9 and F11 as in the checklist. F8's read found the files on the device, so it wasn't a download test. Two listings took about 11 s, see the note under the checklist. Afterwards `sessions` had 299 files: `P001…` had been deleted while it was online-only, so it went to OneDrive's online recycle bin, not Windows'. |
| 2026-10-15 | Edge and Chrome, synced | F5 | After a browser restart (20:45) and a Windows restart (20:55), both reported `prompt`, and **List** failed with `NotAllowedError`. |
| 2026-10-15 | Edge and Chrome | F4, F5 (the prompt) | The permission prompt after reopening had two buttons. "Allow on every visit" was never offered on `file://`. |
| 2026-10-15 | The maintainer's PC, synced | F10 | `conflict--3f9a1c2e.summary-Aristotle.json`, as in the checklist. Next to it were `conflict--3f9a1c2e.summary - Copy.json` (Explorer's own copy, made while preparing the test) and a `.json.txt` (made with file extensions hidden). |
| 2026-10-30 | Edge, the maintainer's work computer (company-managed) | F1's policies | **`DefaultFileSystemWriteGuardSetting` = 2** (BlockFileSystemWrite). **New project…** failed on the first run with the `permission` message. The exception IT can add is `FileSystemWriteAskForUrls`. The only `file:` wildcard Chromium accepts is `file:///*`, and a path-specific pattern probably won't match, because the permission check uses the page's origin. *Not yet tested with an exception.* |
| – | Edge and Chrome | Not run | F1's policies (a personal PC), F2's refused folders (by design in Chromium's source), the prompts' wording (only for the User Guide), and Chrome's F8 download (OneDrive's work; Edge measured it). |
