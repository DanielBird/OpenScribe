# DeScribe: User Guide

DeScribe turns a recorded interview or meeting (English, German or French) into a transcript with speaker names
and timestamps. You can listen from any point, correct the text, translate the transcript to English, and download
it as a Word file.

DeScribe is one HTML file. It runs in your browser, with nothing to install. It uses your own API keys to send the
recording to ElevenLabs, which does the transcription.

## 1. Get the file

1. Download `DeScribe-v<version>.html` from the team's SharePoint folder.
2. Double-click it. If it opens in another program, right-click it and choose **Open with → Microsoft Edge** (or
   Google Chrome).

Use Edge or Chrome. Firefox isn't supported.

## 2. Get your API keys

### ElevenLabs (required)

Your keys are on **Settings**: the link at the bottom of every page.

1. Sign in at [elevenlabs.io](https://elevenlabs.io) and open **API keys**. The link is on Settings.
2. Create a key and **restrict it to Speech-to-Text**. A restricted key can't be used for anything else if it leaks.
3. Consider setting a credit limit on the key, so a mistake can't use up your account's credits.
4. Paste the key into **ElevenLabs API key** on Settings. **Verify key** checks it without transcribing
   anything. Until it's there, Setup shows **Open Settings**.

ElevenLabs bills per hour of audio. A glossary adds about 20% to the cost.

### Claude or Gemini (optional, for translation and projects)

You need one of these only if you want English translations, or work with projects. Add the key on Settings, or
when you first translate. A project uses the key of the model chosen in Analyse mode, and asks
for it when it's missing.

- **Claude:** create a key in the Claude Console ([console.anthropic.com](https://console.anthropic.com)). Spending
  limits are set in the Console.
- **Gemini:** create a key in Google AI Studio ([aistudio.google.com](https://aistudio.google.com)).

### Remember keys on this computer

This checkbox is under the keys on Settings, and applies to all your keys.

- **Ticked:** the keys are saved in this browser until you forget them.
- **Unticked:** the keys are kept only until you close the tab.

Any web page you open from a file on this computer can read remembered keys, so **leave it unticked on shared
computers**. To remove one key, clear its box. To remove all keys, choose **Forget all keys** on Settings.

## 3. Transcribe a recording

DeScribe opens on **Home**. Click **Transcribe**. (**Analyse** is for a team's shared folder of sessions: see
[Projects](#8-projects).) **Home**, at the start of the row at the top, takes you back. A running transcription or
translation carries on, and **Transcribe** returns you to where you were. The browser's Back and Forward buttons also
move between pages.

**Setup**
1. Add your ElevenLabs key on Settings, if you haven't yet.
2. Choose the recording, or drop it on the page. Audio and video files work, up to 3 GB and 10 hours.
3. Options:
   - **Language:** pick it if you know it. Auto-detect works for most recordings.
   - **Number of speakers:** set it if you know it (for example 2 for an interview). It improves speaker separation.
   - **Zero retention:** see [Privacy](#9-privacy).
4. Click **Next**.

**Glossary:** add project terms (optional; see the tips below). Then click **Run**.

**Output**
- The page shows the upload, then the transcription time. Long recordings take several minutes. **Keep the tab
  open** until the transcript appears.
- Rename speakers under **Speakers**, for example "Speaker 1" → "Interviewer". The names are used everywhere,
  including the Word file.
- **Download .docx** saves a Word file. If there is a translation, you choose Original or English.

DeScribe keeps your **latest** transcript in the browser. After a reload, Setup offers it under **Last transcript**:
click **Open**. A new run replaces it, and DeScribe asks first.

## 4. Correct the text

To fix misheard words and names, click **Edit text** above the transcript. The text of each turn becomes a box.
- Type your changes. They are saved as you type.
- **Enter** finishes a turn. **Escape** undoes your changes to the turn you are in.
- Click **Done** when you have finished.

Speakers, timestamps and turns stay as they are. While you edit, clicking the text places the cursor; click the
timestamp to listen.

The Word file uses the corrected text. An English translation is not updated: translate again if you need the
corrections in English.

## 5. Glossary tips

The glossary helps ElevenLabs spell names and terms correctly. Add words that are spoken in the recording and are
easy to get wrong:
- product and project names (`Oticon Intent`, `MoreSound`)
- people's names and places
- acronyms and jargon (`BTE`, `RIC`, `audiogram`)

Paste one term per line, or separate them with commas.

ElevenLabs only accepts terms that are under 50 characters, have at most 5 words, and don't contain
`< > { } [ ] \`. Terms that break these rules are marked **skipped** and aren't sent.

The glossary is saved in this browser. To share it, use **Copy list**, and your colleague pastes it.

## 6. Translate to English

Use **Translate to English** on the Output step when the recording is in German or French and you need an English
version. The button doesn't appear for English recordings.

1. Choose Claude or Gemini, and the model. The default is fine.
2. Click **Translate**. You can keep reading and renaming speakers while it runs.
3. When it's done, switch between **Original** and **English** above the transcript.

**What is sent:** the transcript text, the speaker names and your glossary go to the provider you pick. The audio is
never sent.

If something fails part-way, **Resume** continues where it stopped.

## 7. Listen along

- Click a timestamp, or the text of a turn, to play the recording from there. The turn being played is highlighted.
- **Follow playback** scrolls the transcript with the recording.
- **Space** plays and pauses, unless you are typing.

The recording isn't saved. After a reload, attach it again in the player at the bottom of the Output step.

## 8. Projects

A project is a folder that the team shares, for example in OneDrive, with every session's transcript and summary in
it. In Analyse mode you can see all the sessions, read their summaries and search them together.

**Open or create a project.** On Home, click **Analyse**.
- **Open project…**: choose the project folder, the one with `describe-project.json` in it.
- **New project…**: choose an empty folder inside your OneDrive (or a SharePoint library you sync), so the team gets
  it too. DeScribe writes `describe-project.json` there and opens the **Brief**.
- The browser doesn't let you choose Documents, Desktop or Downloads themselves. Use a folder inside them.

**Reconnect.** DeScribe remembers the project, and Home shows its name. Each time you start the browser again,
click **Reconnect "…"** once and allow access when the browser asks.

**Brief** (at the top): the project's name, the context (objectives, discussion guide), the research questions
(one per line) and the respondent details to look for (one per line, for example Age or Country). Summaries will
use it. If a colleague changed the brief while you were editing it, DeScribe says so: **Reload** shows their version.

**Model** (at the top): the model for project work. Claude: **Sonnet 5.5** or **Opus 5.5**, which costs about twice
as much. Gemini: **Gemini 3.8 Flash** or **Gemini 4 Argon**, which costs about 2.7 times as much. Translations and
summaries for the project, and the chat, go to that model's provider, with its key. The choice is saved on this
computer, and the **Add to project** dialog shows and changes the same one.

**Sessions** are listed newest recording first, with their language, length, date and summary: ✓ summarised,
◐ summarising, ⟳ out of date, **!** failed, nothing yet when there's no summary.
- The first time you open a project on a computer, DeScribe reads every transcript once, which can take a minute if
  the files are only in OneDrive. After that it opens quickly.
- A colleague's new session appears when you come back to the DeScribe window, once OneDrive has synced it.
- Files that couldn't be read, and copies OneDrive made after a conflict, are listed under the sessions.

**Search:** under the chat's question box, switch **Chat** to **Search**. The box then searches every session, in
English and in the original language, and the hits show where the chat was. Click a hit to read its whole turn, and
click it again to close it. A session shows its first 4 hits: **Show all** shows the rest. **Chat** switches back;
your search is kept.

| Type | To find turns with |
|---|---|
| `charger night` | both words |
| `"charger by the bed"` | the exact phrase |
| `charg*` | words that start with *charg* |
| `night OR evening` | either word |
| `charger -phone` | *charger* but not *phone* |

Each hit has **Copy**, which copies the whole turn (in English, if it was translated) with the speaker, the time and
the recording's name. **Esc** clears the box.

**Working offline:** in File Explorer, right-click the project folder and choose **Always keep on this device**.

### Add a session to a project

On the Output step, click **Add to project…**. The dialog names the project, or lets you open, create or reconnect
one, shows the project's **Model** (change it there if you like), and asks for that model's key (Claude or Gemini) if
it's missing. Click **Add**. DeScribe then,
in the actions row:
1. saves the transcript in the project folder (the recording itself stays on your computer);
2. translates it to English with the project's model, if it's in German or French and has no English yet;
3. writes its summary.

You can keep reading and renaming speakers meanwhile. If a step fails, the session stays in the project and
**Resume** carries on from that step; **Cancel** stops, and what was saved stays saved.

From then on the header says **In <project>**, and every change you make on the Output step is saved to the project
too. Once its summary is written, **Open summary** takes the place of **Add to project…**: it shows the summary in
Analyse mode, where the chat is. If a colleague changed the same transcript meanwhile, saving stops and DeScribe asks: **Reload** shows their
version, **Keep mine** saves yours over it. After you restart the browser, a change asks you to **Reconnect** first.
If the session's files are deleted from the project folder, Output offers **Add to project…** again once you come
back to the DeScribe window.

### Read a summary

In Analyse mode, click a session (or move with the arrow keys and press Enter). The summary shows a short synopsis,
an overview, the respondents and their details, what the session says about each research question, and the themes.
Each finding and theme has up to two quotes that support it.
- Each quote shows the transcript's own words. **Copy** copies it with its citation, for example `"…" — Anna,
  00:41:12, P07 – home visit, Hamburg (translated from German)`.
- A quote that no longer matches the transcript (because the text was edited) is marked **Not found** and can't be
  copied.
- **Open transcript** opens the session on the Output step, linked to the project. Attach the recording to listen.
- Summaries are written in English and can't be edited. To change one, correct the transcript, the speaker names or
  the brief, then make it again.

### When a summary is out of date

A summary is out of date (⟳) when its transcript or the project's brief has changed since it was made. It's still
shown, with **Regenerate**. **Summarise all (N)** at the foot of the list makes every missing, out-of-date or failed
summary, one session at a time; it asks first, with the number of sessions and hours. A missing or wrong key, or
an exhausted quota, stops it, and so does a rate limit with a Gemini model; any other failure is marked on that
session and the rest carry on.

### Ask about a project

With no session selected, the right-hand side of Analyse mode is a chat. Type a question about the project and press
**Enter** (**Shift+Enter** starts a new line). The model looks for the answer the way you would: it searches the
transcripts with several words and spellings, in English and in the original language, reads the passages around
what it finds, and uses the summaries for an overview. Then it answers in English.
- **What it did:** under each answer, a line like *6 searches · 5 reads · ≈ $0.40* opens to every search and read.
- **Quotes** are checked against the transcript. A checked quote shows the transcript's own words, the speaker, the
  time and the session. **Copy** copies it with its citation. A quote marked **Not found in the transcript** isn't in the words of the turn the model pointed to, so it
  can't be copied: treat it with care.
- **Costs and limits:** the line under an answer gives its approximate cost, usually well under a dollar with Sonnet
  5.5. For each question the model reads at most about 20 hours of transcript and makes at most 30 searches or reads,
  then answers from what it has. An answer that hit a limit says so.
- **Stop** ends an answer at once and keeps what was written. Your next question carries on from before it.
- **Follow-up questions** carry on the conversation. Selecting a session shows its summary; **Esc** returns.
- **Chats are saved in the project folder,** after each answer. The **Chats** tab, next to **Sessions**, lists them,
  the last one added to first, with "You" or the colleague who asked. Select one to read it and go on asking; it
  carries on from its earlier questions and answers. In a colleague's chat, your question saves a copy as yours, and
  theirs stays as it was. **New chat**, at the top of the Chats tab, starts afresh. Your name on your chats is set in **Settings → Chats**; until
  you set one, DeScribe uses a made-up name such as "Amber Heron".
- A chat uses the sessions, the brief and the model as they were when it started or was opened: DeScribe says when
  sessions were added since, or the model changed, and when the chat is getting long.
- **Compact a long chat:** type `/compact` and press **Enter**. The model summarises the chat so far and carries on
  from the summary, so later questions are quicker and cheaper. Add what matters after it, e.g. `/compact keep the
  quotes about charging`. The earlier messages stay on screen; the summary is under **Earlier messages summarised**.

## 9. Privacy

- Your recording and glossary go **only to ElevenLabs**. The transcript text and glossary go to Anthropic (Claude)
  or Google (Gemini) only when you translate. If you add a session to a project, its transcript is saved in the
  project folder you chose. To translate and summarise a session, its text and the project brief are sent to the
  provider chosen for the project, Anthropic (Claude) or Google (Gemini). When you ask about a project, your
  question, the brief, the summaries and the transcript passages the model reads are sent to the same provider.
  Chats are saved in the project folder, where everyone who can open it can read them. Nothing is sent anywhere
  else. The About section on Settings says the same and links to each
  provider's privacy and terms pages.
- **Zero retention** asks ElevenLabs not to store your audio or transcript. Only ElevenLabs Enterprise plans can use
  it. With another plan, the run stops with a message that tells you to switch it off.
- Your glossary, settings and last transcript are saved in this browser. **Settings → Clear saved data** deletes them.
  Your API keys stay until you choose **Forget all keys**.
- If you open a project, DeScribe reads and writes only the folder you chose. This browser keeps a link to it, a
  copy of the transcripts' text (so the project opens quickly), and which project file the last transcript belongs
  to. **Clear saved data** removes them, never the files in the folder.
- See [Remember keys on this computer](#remember-keys-on-this-computer) before you save a key on a shared computer.

## 10. Troubleshooting

| Problem | What to do |
|---|---|
| "Couldn't reach ElevenLabs / Claude / Gemini" | Check your internet connection. On a company network, a proxy may block the APIs: ask IT to allow `api.elevenlabs.io`, `api.anthropic.com` and `generativelanguage.googleapis.com`. |
| The file is too large or too long | Export only the audio (for example, download the audio of a Teams recording), or convert it to MP3. Split recordings longer than 10 hours. |
| "This file format can't be played in the browser" | The transcript is fine. To listen, convert the recording to MP3 and attach the copy. WMA, WMV, AVI and AIFF files can't be played. |
| A video plays with no sound in Chrome | Some MP4 videos have audio Chrome can't play (AC-3). Open DeScribe in Edge, or convert the recording to MP3. |
| "This browser isn't saving …" | The browser blocks saved data, or the disk is full. DeScribe still works, but nothing is kept after you close the tab. Download the Word file before you close it. |
| My transcript is gone | DeScribe keeps only the latest transcript. A new run replaces it, so download the Word file of each transcript you need. |
| DeScribe is open in two tabs | Both tabs use the same saved data, and the last one to save wins. Use one tab. |
| "ElevenLabs rejected the API key" | Check the key on Setup, or create a new one. |
| "Zero retention is only available on ElevenLabs Enterprise plans" | Switch off **Zero retention** on Setup and run again. |
| "Your ElevenLabs account has no remaining credits" | Top up your ElevenLabs account, or raise the key's credit limit. |
| "This browser can't open project folders" | Open DeScribe in Edge or Chrome. |
| "This folder isn't a DeScribe project" | Choose the folder that has `describe-project.json` in it, or use **New project…**. |
| "This file is only in OneDrive and the computer is offline" | Connect to the internet, or set the project folder to **Always keep on this device**. |
| "DeScribe no longer has access to the project folder" | Click **Reconnect**, and allow access when the browser asks. |
| "The browser didn't let DeScribe use this folder" | Try again, and allow access when the browser asks. On a company computer, a browser policy may block folder access: ask IT to check the `FileSystem…` policies in `edge://policy`. |
