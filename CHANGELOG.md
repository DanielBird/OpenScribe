# Changelog

All notable changes to DeScribe are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). How to make a release: [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Added

- **English that is out of date:** after a turn is edited, the English view marks it "Changed since translation",
  **Translate** becomes **Update English…**, which translates only the changed turns, and the export dialog says how
  many turns of the English are out of date. Summaries, the project chat and search use only English that is up to
  date, so **Summarise**, **Regenerate** and **Add to project** translate the changed turns first.
- **Technical details** under an error from ElevenLabs, Claude or Gemini: the version, the HTTP status and the
  service's own reason or request id, to paste into a problem report.

### Changed

- **Quotes with words left out** are verified only when each part has at least three words and no negation such as
  "not" is left out. Otherwise the card says **Left-out words may change the meaning** and has no **Copy**. Quotes
  are checked whenever they're shown, so some in older summaries and saved chats are now marked: **Regenerate** a
  summary to replace its quotes.
- **Project chat:** each question reads at most about 30 session summaries, besides about 20 hours of transcript.
- **Project chat:** after each step, the agent sees how many tool calls and how much reading it has left, so it can
  save its last steps for the evidence it needs.
- **Project chat:** a follow-up question costs about the same as the first. It goes on from the earlier questions and
  answers, as a reopened chat does, so the agent reads passages again when it needs them instead of sending back
  everything it read for earlier questions.
- **Run** and **Clear saved data** warn when the last transcript's latest changes aren't saved in its project yet,
  for example before **Reconnect**.
- Saving a project's brief, a transcript or a chat keeps what a newer version of DeScribe added to the file.

### Fixed

- A summary made while the brief changed is shown as out of date, with **Regenerate**. It counted as up to date.
- A translation that ran while a colleague changed the transcript was saved onto their version. The step now stops,
  and **Resume** translates the turns that changed.
- A translation no longer stops for good when the model returns nothing for a turn. That turn keeps its original
  text.
- **Try again** and **Start again** after a transcription fails or is cancelled use the ElevenLabs key now in
  Settings. They sent the key the run started with.
- When a summary is sent again because many of its quotes weren't found, the reply with the smaller share of them is
  kept. It kept the one with fewer, even when that reply had far fewer quotes.
- **Stop** in the project chat, while Claude or Gemini was being asked again after a reply it couldn't use, saved the
  start of the answer twice. The cost now also counts Claude's first attempt.
- Selecting the open chat in the **Chats** tab again shows what a colleague added to it since. It did nothing.
- A fault in DeScribe or Google's library while talking to Gemini says "Something went wrong while talking to
  Gemini". It said "Couldn't reach Gemini" and blamed the internet connection.
- A transcript that ElevenLabs returns without a language takes the one chosen on Setup. With Auto-detect, the
  language is left out: the Word file is named `… - transcript.docx` and has no Language line, and Output says
  **Original** rather than **Original ()**. The file was named `… - transcript ().docx`.

## [1.1.0] - 2026-11-01

### Added

- **More languages:** Setup's **Language** list has the 36 languages ElevenLabs transcribes most accurately, from
  Belarusian to Vietnamese. Other languages still work with Auto-detect. Every language is named in full (Spanish,
  not SPA) in the transcript, the Word file's name, the session list and the translation, and Chinese, Japanese and
  Thai originals can be searched word by word.
- **Licences:** the source is under the MIT License ([LICENSE](LICENSE)). **Settings → About → Licences** shows
  it, and the licences of the open-source software DeScribe includes.
- **Windows desktop app:** DeScribe also builds as a Windows app, the same app in its own window, packed as MSIX for
  the Microsoft Store. It calls the same three APIs, opens links in the default browser, and skips the folder-access
  prompts that Edge and Chrome show for a project folder (**Reconnect** is still needed after a restart). Its saved
  data (keys, glossary, settings, the last transcript) is its own, not shared with the HTML file, and uninstalling
  removes it. The HTML file is unchanged.
- **Compact a chat:** type `/compact` in the chat to have the model summarise it and carry on from the summary,
  optionally with what to keep (`/compact keep the quotes about charging`). The long-chat notice suggests it.
- **Chat history:** chats in Analyse mode are saved in the project folder (`chats/`) after each answer. A **Chats**
  tab next to **Sessions** lists them, yours and colleagues', the last one added to first; select one to read it and
  ask more. Asking in a colleague's chat saves a copy as yours. **Settings → Chats → Your name** sets the name on your
  chats (a made-up one until then).
- **Gemini for projects:** Analyse mode's **Model**, also shown in the **Add to project** dialog, offers Gemini 3.8
  Flash and Gemini 4 Argon as well as Claude. With a Gemini
  model, **Add to project**, **Summarise**, **Regenerate** and **Summarise all** translate and summarise with Gemini
  and ask for the Gemini key; summary files and translations record the provider. The chat works with Gemini too:
  the same searches, checked quotes and cost line.
- **Project chat:** in Analyse mode, ask Claude or Gemini about the whole project. It searches and reads the transcripts and
  summaries, then answers in English; what it searched and read, and the approximate cost, are under each answer.
  Quotes are checked against the transcript and copied with their citation (**Copy**); a quote
  that isn't found is marked and can't be copied. **Stop** ends an answer, and **New chat** starts afresh. **Chat |
  Search**, under the question box, switches the pane to the keyword search and back.
- **Add to project and session summaries:** **Add to project…** on the Output step saves the transcript in the
  project folder, translates it to English with Claude if it's German or French, and writes its summary, with the
  progress, **Cancel** and **Resume** in the actions row, then **Open summary** to read it in Analyse mode. A
  transcript in a project saves its changes back to the
  folder, and stops with **Reload** / **Keep mine** if a colleague changed it meanwhile; after a browser restart it
  asks for **Reconnect** first; if its files are deleted from the folder, **Add to project…** is offered again. In
  Analyse mode, each session shows its summary status, and selecting one shows its
  summary: synopsis, overview, respondents, research questions and themes. Each finding and theme has up to two
  supporting quotes, checked against the transcript and copied with their citation (**Copy**). **Regenerate** renews an
  out-of-date summary, **Summarise all** makes every missing one, and **Open transcript** opens the session on Output.
- **Projects:** **Analyse** on Home opens a team's shared project folder (for example in OneDrive): **New
  project…**, **Open project…**, and one **Reconnect** click per browser session. A **Brief** (name, research
  questions, context, respondent details), the **Model** for project work (Sonnet 5.5 or Opus 5.5), every session in
  the folder (newest first, picked up from colleagues when the window gets focus), and **Search transcripts** (in the
  chat pane) with **Copy** with citation; click a hit to read its whole turn, and **Show all** for every hit in a
  session. Each computer reads a transcript once and keeps its text for the next visit.
- **Home page:** DeScribe opens on Home, with **Transcribe** (Setup → Glossary → Output, as before) and **Analyse**. **Home**, at the start of the top row, returns to it. A transcription or
  translation keeps running meanwhile, and Home shows it.
- **Edit text** on the Output step: correct each turn's text in place (misheard words and names). Edits are saved
  as you type and used by the Word export. Speakers, timestamps and turns don't change, and an existing English
  translation is not updated.

### Changed

- **The name is now DeScribe**, in the app, the Word file's properties and the release file
  (`DeScribe-v<version>.html`). Saved data and project folders from earlier versions still work.
- The top row, Home, Settings and Analyse use the window's full width; in Analyse the sessions sit at the left, with
  the chat or summary centred beside them. The Transcribe steps keep their centred 80rem column (it was 60rem).
- On Output, the actions run **Edit text**, **Download .docx**, then **Add to project…**, which is now the main
  (blue) button.
- **Clear saved data** also forgets the project folder and its text cache. The folder's files are never touched.
- Gemini requests stream, as Claude's do, with an explicit thinking level. This includes translation on Output. A
  used-up Gemini quota or prepaid credit says so, and stops **Summarise all**, as a Gemini rate limit does.

## [1.0.0] - 2026-10-14

The first release: one HTML file that colleagues open in Edge or Chrome.

### Added

- **Transcription** of audio and video files with ElevenLabs Speech-to-Text (`scribe_v2`), with speaker labels and
  timestamps. Language: auto-detect, English, German or French. Optional number of speakers (1–32), and zero
  retention for ElevenLabs Enterprise plans. Recordings up to 3 GB and 10 hours.
- **Glossary** of project terms, sent to ElevenLabs as key terms. It is saved in the browser and can be copied to
  share it.
- **Output:** the transcript by speaker turn with timestamps, speakers that can be renamed, and an autosave of the
  latest transcript that Setup offers to reopen.
- **Word export** (`.docx`) of the original or the English translation.
- **Translation to English** with Claude or Gemini, on demand, with progress, Cancel and Resume.
- **Playback:** click a turn to listen from there, Follow playback, Space to play or pause, and attach the
  recording again after a reload.
- **About** (footer): where data goes, where API keys are kept, **Forget all keys**, **Clear saved data**, and the
  providers' privacy and terms pages.
- A Content Security Policy that lets the page talk only to the three API hosts.

### Known limitations

- A recording of 60 minutes or more hasn't been run against the live API yet (check V4). The request has no
  client time-out.
- Translation quality and cost haven't been measured on a real 30-minute transcript yet (check L3).
- Chrome plays some MP4 videos (AC-3 audio) with no sound and no error. Edge plays them. Converting to MP3 helps.
- WMA, WMV, AVI and AIFF recordings can be transcribed but not played in the browser.
- Only the latest transcript is kept. Two open tabs share it, and the last one to save wins.
- On a slow laptop, renaming a speaker in a 3-hour transcript takes about 0.1–0.2 s per keystroke.
- Firefox is not supported.

[Unreleased]: https://github.com/DanielBird/Describe/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/DanielBird/Describe/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/DanielBird/Describe/releases/tag/v1.0.0
