# DeScribe: User Guide

DeScribe turns a recorded interview or meeting, in English or one of many other languages, into a transcript with
speaker names and timestamps. You can listen from any point, correct the text, translate the transcript to English, and download
it as a Word file.

DeScribe is one HTML file. It runs in your browser, with nothing to install. It uses your own API keys to send the
recording to ElevenLabs, which does the transcription. DeScribe is also a Windows app from the Microsoft Store, which
can transcribe on your computer instead: see [Transcribe on this computer](#transcribe-on-this-computer-windows-app).

## 1. Get the file

1. Download `DeScribe-v<version>.html` from the team's SharePoint folder.
2. Double-click it. If it opens in another program, right-click it and choose **Open with → Microsoft Edge** (or
   Google Chrome).

Use Edge or Chrome. Firefox isn't supported.

## 2. Get your API keys

### ElevenLabs (required, unless the Windows app transcribes on your computer)

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
   - **Language:** pick it if you know it. Auto-detect works for most recordings. The list has the 36 languages
     ElevenLabs transcribes most accurately. Recordings in other languages work with Auto-detect, but expect more
     mistakes in the text.
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

### Transcribe on this computer (Windows app)

The Windows app can transcribe without ElevenLabs, using NVIDIA's speech models on your computer. The recording isn't
sent anywhere, and you don't need an ElevenLabs key.

1. **Download the models once:** on **Settings → Transcribe on this computer**, click **Download speech models**
   (about 0.8 GB from Hugging Face). You can leave Settings while it downloads. If it's interrupted, click it again:
   it carries on where it stopped.
2. **Choose it on Setup:** under **Transcribe with**, choose **This computer**. DeScribe remembers your choice.
   **ElevenLabs** is still there whenever you want it.
3. Click **Next**, then **Run**. Output shows how much of the recording is done. Keep DeScribe open; you can use
   other apps meanwhile.

What's different on this computer:
- **It's slower.** Settings shows how long your last recording took (**Last recording**), so you know what to expect
  on your computer.
- **Choose the language.** There's no Auto-detect: pick the recording's language under **Options**. The list has
  the 25 European languages the models know.
- **No glossary for transcribing.** The terms are still used when you translate.
- **Up to 8 speakers.** Number of speakers and Zero retention aren't offered.
- **Ogg Opus files can't be read.** Convert them to MP3, or transcribe them with ElevenLabs.

**On the graphics card:** if your computer has a graphics card, Settings → **Transcribe on this computer** shows
**Run on**, with **Processor** and each card by name. **Processor** is the default. A card may be faster or slower than
the processor, depending on the computer: try one recording on each and compare **Last recording**. Under
**Timings**, **Ran on** says which one the last recording used. The first run on a card takes a few seconds longer
to start. If a card you chose isn't there (a laptop undocked from it, say), DeScribe uses the processor: **Ran on**
names the card it didn't use, and **Why** says what went wrong. It goes back to the card when the card returns, unless
you choose **Processor** meanwhile.

To free the space, click **Remove** on Settings. Setup then goes back to ElevenLabs. Uninstalling DeScribe removes the
models too.

## 4. Correct the text

To fix misheard words and names, click **Edit text** above the transcript. The text of each turn becomes a box.
- Type your changes. They are saved as you type.
- **Enter** finishes a turn. **Escape** undoes your changes to the turn you are in.
- Click **Done** when you have finished.

Speakers, timestamps and turns stay as they are. While you edit, clicking the text places the cursor; click the
timestamp to listen.

The Word file uses the corrected text. If there is an English translation, each turn you change is marked
**Changed since translation** in the English view, and **Translate** becomes **Update English…**, which translates
only those turns.

### Replace a name

To take a person's name out of the transcript, for example to replace *Anna* with *Participant 1*, click **Find and
replace…** above the transcript. If you select the name in a turn first, it's filled in for you.
1. Type the name in **Find**. The list shows each place it's said, with the speaker, the time and the words around
   it. Case and accents don't matter (*Muller* finds *Müller*), but only whole words are found: *Anna* finds
   *Anna's* and *Anna-Lena*, not *Annabel*.
2. Type what goes in its place in **Replace with**.
3. **Replace** changes the highlighted match and moves to the next. **Next** leaves it as it is. **Replace all**
   changes every match left, after asking. There is no undo. Replace all, and replacing the last match, also take
   the name out of the word timings saved with the transcript, where it stays after **Edit text** takes it out of
   the text.

It changes the version on screen. If there is an English translation, switch to **English** and replace the name
there too. The Word file and the project get the new text, but the speaker names, the recording's file name and the
audio keep the name: rename speakers in the speaker panel.

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

Use **Translate to English** on the Output step when the recording isn't in English and you need an English version.
The button doesn't appear for English recordings.

1. Choose Claude or Gemini, and the model. The default is fine.
2. Click **Translate**. You can keep reading and renaming speakers while it runs.
3. When it's done, switch between **Original** and **English** above the transcript.

**What is sent:** the transcript text, the speaker names and your glossary go to the provider you pick. The audio is
never sent.

If something fails part-way, **Resume** continues where it stopped. A turn that can't be translated keeps its
original text.

## 7. Listen along

- Click a timestamp, or the text of a turn, to play the recording from there. The turn being played is highlighted.
- **Follow playback** scrolls the transcript with the recording.
- **Space** plays and pauses, unless you are typing.

The recording isn't saved. After a reload, attach it again in the player at the bottom of the Output step.

## 8. Projects

A project is a folder with every session's transcript and summary in it. It can be a local folder, or a shared one (for
example in OneDrive) that the whole team can use. In Analyse mode you can see all the sessions, read their summaries
and search them together.

**Open or create a project.** On Home, click **Analyse**.
- **Open project…**: choose the project folder, the one with `describe-project.json` in it.
- **New project…**: choose an empty folder. To share the project, put the folder in your OneDrive (or a SharePoint
  library you sync). DeScribe writes `describe-project.json` there and opens the **Brief**.
- **Change**, at the top once a project is open: lists the other projects you've used on this computer, so one click
  opens any of them.
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

Each hit has a copy button, which copies the whole turn (in English, if it was translated) with the speaker, the time and
the recording's name. The open button beside it opens the transcript on the Output step at that turn. **Esc** clears
the box.

**Working offline:** in File Explorer, right-click the project folder and choose **Always keep on this device**.

### Add a session to a project

On the Output step, click **Add to project…**. The dialog names the project, or lets you open, create or reconnect
one. Once you've used more than one project on this computer, a **Project** list offers the last ten: choose one, and
**Add** opens it and adds the transcript there. That project is then the one open in Analyse. The dialog also shows
the project's **Model** (change it there if you like), and asks for that model's key (Claude or Gemini) if it's
missing. Click **Add**. DeScribe then, in the actions row:
1. saves the transcript in the project folder (the recording itself stays on your computer);
2. translates it to English with the project's model, if it's in another language and has no English yet, or only
   the turns changed since it was translated;
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
- Each quote shows the transcript's own words. Its copy button copies it with its citation, for example `"…" — Anna,
  00:41:12, P07 – home visit, Hamburg (translated from German)`.
- A quote that no longer matches the transcript (because the text was edited) is marked **Not found** and can't be
  copied.
- The open button beside a quote opens the transcript on the Output step at the quote's turn, in English if the quote
  is a translation. Marked quotes have it too, so you can read what was said.
- **Open transcript** opens the session on the Output step, linked to the project. Attach the recording to listen.
- Summaries are written in English. To correct one, edit it (below), or correct the transcript, the speaker names or
  the brief and make it again.

### Correct a summary

Click **Edit** under the summary's title. The summary stays as it is, and you type in it where it stands, as in a
Word document: click anywhere in the text, and use the arrow keys to move through it. Your changes are saved to the
project folder as you type. Click **Done** when you have finished.
- **Enter** in the overview starts a new paragraph, and **Backspace** at the start of one joins it to the one above.
  Enter at the end of a theme's description adds a theme, and at the end of a respondent's detail adds a detail.
  Anywhere else, Enter moves on.
- **Add theme** adds a theme at the end, and the button at the end of a theme removes it with its quotes.
- A quote's words are the transcript's, so they can't be edited. The button on a quote removes it. **Add quote** under
  a finding or a theme opens a quote: paste or type the respondent's words, then click elsewhere. DeScribe finds them
  in the transcript and shows the speaker and time; words it can't find are kept and marked **Not found**.
- The research questions are the brief's, and can only be changed there.
- If a colleague changed the summary while you were editing it, saving stops. **Reload** shows their version, and
  **Keep mine** saves yours over it.
- **Regenerate** makes a new summary and replaces your changes.
- A chat that is already open keeps the summaries it started with. It says how many sessions changed; **New chat**
  uses your corrections.

### When a summary is out of date

A summary is out of date (⟳) when its transcript or the project's brief has changed since it was made. It's still
shown, with **Regenerate**. If you corrected a translated transcript, Regenerate first translates the turns you
changed, so the summary and its quotes use the corrected English. **Summarise all (N)** at the foot of the list makes every missing, out-of-date or failed
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
  time and the session. Its copy button copies it with its citation. A quote marked **Not found in the transcript** isn't in the words of the turn the model pointed to, so it
  can't be copied: treat it with care. One marked **Left-out words may change the meaning** is there, but with words
  left out that could reverse it, such as a "not": check the transcript before you use it. The open button beside a
  quote shows its turn on the Output step.
- **Costs and limits:** the line under an answer gives its approximate cost, usually well under a dollar with Sonnet
  5.5. For each question the model reads at most about 20 hours of transcript and about 30 summaries, and makes at
  most 30 searches or reads, then answers from what it has. An answer that hit a limit says so.
- **Stop** ends an answer at once and keeps what was written. Your next question carries on from before it.
- **Follow-up questions** carry on the conversation. Selecting a session shows its summary; **Esc** returns.
- **Chats are saved in the project folder,** after each answer. The **Chats** tab, next to **Sessions**, lists them,
  the last one added to first, with "You" or the colleague who asked. Select one to read it and go on asking; it
  carries on from its earlier questions and answers. An open chat doesn't change while you read it: select it again
  to see what was added since. In a colleague's chat, your question saves a copy as yours, and
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
- **Names:** to keep people's names from Anthropic and Google, [replace them](#replace-a-name) **before** you
  translate or add the session to a project, since both send the text. The speaker names and the glossary are sent
  too, so rename the speakers and leave names out of the glossary. The audio and the recording's file name still
  have the names.
- **Zero retention** asks ElevenLabs not to store your audio or transcript. Only ElevenLabs Enterprise plans can use
  it. With another plan, the run stops with a message that tells you to switch it off.
- Your glossary, settings and last transcript are saved in this browser. **Settings → Clear saved data** deletes them.
  Your API keys stay until you choose **Forget all keys**.
- If you open a project, DeScribe reads and writes only the folder you chose. This browser keeps a link to it, a
  copy of the transcripts' text (so the project opens quickly), and which project file the last transcript belongs
  to. **Clear saved data** removes them, never the files in the folder.
- See [Remember keys on this computer](#remember-keys-on-this-computer) before you save a key on a shared computer.
- **On this computer** (Windows app): the recording isn't sent anywhere. Downloading the speech models connects to
  Hugging Face, which receives the request and your computer's address, as any website does, and none of your data.

## 10. Troubleshooting

| Problem | What to do |
|---|---|
| You want to report an error | Open **Technical details** under the message, and paste its text into your report. It never contains your keys. |
| "Couldn't reach ElevenLabs / Claude / Gemini" | Check your internet connection. On a company network, a proxy may block the APIs: ask IT to allow `api.elevenlabs.io`, `api.anthropic.com` and `generativelanguage.googleapis.com`. |
| The file is too large or too long | Export only the audio (for example, download the audio of a Teams recording), or convert it to MP3. Split recordings longer than 10 hours. |
| "This file format can't be played in the browser" | The transcript is fine. To listen, convert the recording to MP3 and attach the copy. WMA, WMV, AVI and AIFF files can't be played. |
| A video plays with no sound in Chrome | Some MP4 videos have audio Chrome can't play (AC-3). Open DeScribe in Edge, or convert the recording to MP3. |
| "This browser isn't saving …" | The browser blocks saved data, or the disk is full. DeScribe still works, but nothing is kept after you close the tab. Download the Word file before you close it. |
| My transcript is gone | DeScribe keeps only the latest transcript. A new run replaces it, so download the Word file of each transcript you need. |
| DeScribe is open in two tabs | Both tabs use the same saved data, and the last one to save wins. Use one tab. |
| "ElevenLabs rejected the API key" | Check the key on Setup, or create a new one. |
| "Zero retention is only available on ElevenLabs Enterprise plans" | Switch off **Zero retention** on Setup and run again. |
| "Your ElevenLabs account has no remaining credits" | Top up your ElevenLabs account, raise the key's credit limit, or enter another key in Settings. Then click **Try again**. |
| The speech models don't download: "Your network didn't allow the download from huggingface.co" | A company network may block Hugging Face. Try another network (at home, or a phone's hotspot), or ask IT to allow `huggingface.co` and `us.aws.cdn.hf.co`. |
| "The speech models aren't on this computer any more" | Click **Open Settings** and download them again, or choose **ElevenLabs** on Setup. |
| "This computer ran out of memory while transcribing" | Close other apps and click **Try again**, or transcribe with ElevenLabs. |
| "The graphics card (…) stopped while transcribing" | Click **Try on the processor** to run this recording on the processor. If it keeps happening, choose **Processor** under **Run on** in Settings, or update the card's driver. |
| "This browser can't open project folders" | Open DeScribe in Edge or Chrome. |
| "This folder isn't a DeScribe project" | Choose the folder that has `describe-project.json` in it, or use **New project…**. |
| "This file is only in OneDrive and the computer is offline" | Connect to the internet, or set the project folder to **Always keep on this device**. |
| "DeScribe no longer has access to the project folder" | Click **Reconnect**, and allow access when the browser asks. |
| "The browser didn't let DeScribe use this folder" | Try again, and allow access when the browser asks. On a company computer, a browser policy may block folder access: ask IT to check the `FileSystem…` policies in `edge://policy`. |
