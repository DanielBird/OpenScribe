# Changelog

All notable changes to DeScribe are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). How to make a release: [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/DanielBird/Describe/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/DanielBird/Describe/releases/tag/v1.0.0
