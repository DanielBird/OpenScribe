# DeScribe privacy statement

*Last updated: 31 October 2026*

This statement explains what personal data DeScribe handles, where it goes, and how you control it. It covers the
DeScribe desktop app from the Microsoft Store and the single-file version that runs in Edge or Chrome. DeScribe is
published by Dtype ("we", "us").

## In short

- **We don't collect your data.** There is no DeScribe server or account, and no analytics or advertising. The app
  sends nothing to us.
- **Your recordings and transcripts go to the AI providers you choose.** The app sends them straight from your
  computer to ElevenLabs, Anthropic or Google, using API keys that you supply. Their own terms and privacy policies
  apply to that data.
- **Everything else stays on your computer** or in a project folder that you pick, and you can delete it at any time.

## Personal data DeScribe handles

DeScribe works with whatever you give it. Recordings and transcripts often contain personal data: people's voices,
names, and anything said in a conversation. DeScribe handles:

| Data | Where it goes |
|---|---|
| **Audio and video recordings** you choose to transcribe | Sent to ElevenLabs for transcription. Not saved by DeScribe. |
| **Glossary terms** (for example names and product terms) | Sent to ElevenLabs with each recording, and to Anthropic or Google when you translate. Saved on your computer, and with each transcript you add to a project. |
| **Transcripts** (the text, speaker labels, timestamps and the recording's file name) | The last transcript is saved on your computer. Sent to Anthropic or Google only when you translate or analyse it. Saved in your project folder if you add it to a project. |
| **Project briefs, summaries, questions and chats** | Sent to the provider chosen for the project (Anthropic or Google) when you analyse a project or ask about it. Saved in your project folder. |
| **Your name** (optional, in Settings) | Saved on your computer, and shown on the chats you save in a project. If you leave it empty, DeScribe uses a random name. |
| **API keys** for ElevenLabs, Anthropic and Google | Sent only to the provider each key belongs to, to sign your requests. Saved on your computer only if you tick **Remember keys on this computer**. |

DeScribe doesn't collect your location, contacts, device identifiers, usage statistics or crash reports.

## How DeScribe uses personal data

DeScribe uses this data only to do what you ask it to: transcribe a recording, show and play the transcript,
translate it, summarise and search a project, answer your questions about a project, and export a Word document. It
doesn't use your data for advertising, profiling or any other purpose.

## Who receives your data

DeScribe connects only to these three services.

| Provider | Receives | Privacy policy | Terms |
|---|---|---|---|
| ElevenLabs (speech to text) | Recordings and glossary | [elevenlabs.io/privacy-policy](https://elevenlabs.io/privacy-policy) | [elevenlabs.io/terms-of-use](https://elevenlabs.io/terms-of-use) |
| Anthropic (Claude) | Transcript text, glossary, project briefs, summaries, questions and chats | [anthropic.com/legal/privacy](https://www.anthropic.com/legal/privacy) | [anthropic.com/legal/commercial-terms](https://www.anthropic.com/legal/commercial-terms) |
| Google (Gemini) | Transcript text, glossary, project briefs, summaries, questions and chats | [policies.google.com/privacy](https://policies.google.com/privacy) | [ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms) |

You (or your organisation) hold the account and API key with each provider, so the data is processed under your
agreement with that provider. That includes how long the provider keeps it and whether it may use it to improve its
services. These rules differ between providers and plans. For example, on the Gemini API's free tier, Google may use
what you send to improve its products, and people may read it, so Google asks you not to send personal information
there. In the EEA, Switzerland and the UK, Google's paid-tier rules on using your data apply to free use too. Check
your provider's terms before you send recordings of other people.

**Zero retention:** on Setup you can ask ElevenLabs not to store your audio or transcript. ElevenLabs offers this
only on Enterprise plans. On other plans, ElevenLabs refuses the request and DeScribe asks you to switch Zero
retention off.

We never receive your data, so we can't sell, rent, share or disclose it.

## Data stored on your computer

- **The desktop app** keeps its data in its own storage in your Windows user profile. Uninstalling DeScribe deletes
  it.
- **The single-file version** keeps its data in your browser's storage for that file.

This storage holds your settings, glossary, name, last transcript, the link to your project folder, a copy of your
project's transcript text so it opens quickly, and your API keys if you ticked **Remember keys on this computer**.
Otherwise, keys are kept only until you close the app or the browser tab.

**Project folders** are ordinary folders that you choose, for example on OneDrive or SharePoint. DeScribe saves
transcripts, summaries and chats there. Anyone who can open the folder can read them, so choose a folder that only
the right people can access.

**Word documents** that you export are ordinary files on your computer.

## How to see, export and delete your data

- **Settings → Forget all keys** deletes your saved API keys.
- **Settings → Clear saved data** deletes your glossary, settings (including your name), last transcript, the link to
  your project and the copy of its text from this computer. It doesn't touch your project folder.
- **Your project folder** is yours to manage. Delete or move its files as you would any others.
- **Uninstalling** the desktop app deletes everything it saved on your computer.
- **Data held by a provider:** providers keep it under your agreement with them. To see or delete it, use your
  account with the provider or contact them, using the links above. If your organisation holds the account, ask your
  organisation.

## Cookies and similar technologies

DeScribe doesn't use cookies, tracking pixels or any other tracking technology. It uses local storage on your
computer only to remember the data listed above.

## Artificial intelligence

DeScribe uses AI models from ElevenLabs, Anthropic and Google to transcribe, translate, summarise and answer
questions. AI output can be wrong. Check transcripts, translations and summaries before you rely on them, especially
names, numbers and quotes. We don't train AI models, and DeScribe doesn't send your data to us for that purpose.

## Security

DeScribe sends data to the providers over encrypted HTTPS connections, and its content security policy blocks
connections to any other address. API keys are never written to logs, web addresses or error messages. In the
single-file version, remembered keys can be read by any other web page you open from a file on your computer. If you
share a computer, leave **Remember keys on this computer** unticked.

## Where your data is processed

The providers may process your data outside your country, including in the United States. Their privacy policies
describe where they process data and how they protect it when they move it across borders.

## Children

DeScribe is a work tool and isn't meant for children to use.

## Microsoft Store, Windows and browsers

Microsoft handles installing and updating the desktop app, and DeScribe runs in Microsoft Edge WebView2. Microsoft
processes data for these services under the [Microsoft privacy statement](https://privacy.microsoft.com/privacystatement),
not under this statement. Depending on your Windows diagnostic data settings, Microsoft may share install and crash
reports for the desktop app with us through the Microsoft Store.

The single-file version runs in Edge or Chrome, which handle data under their own privacy statements.

## Changes to this statement

When DeScribe's handling of data changes, we'll update this statement and the date at the top. If a change means
your data goes somewhere new, the app's Settings → About section will say so too.

## Contact us

If you have questions about this statement or about DeScribe, email daniel@dtype.app.
