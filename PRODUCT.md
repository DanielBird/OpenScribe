# Product

<!-- impeccable:product-schema 1 -->

Product truth for design work on DeScribe. How it is built lives in [AGENTS.md](AGENTS.md) and
[docs/ROADMAP.md](docs/ROADMAP.md); why things are the way they are lives in [docs/DECISIONS.md](docs/DECISIONS.md).

## Platform

web

## Users

**Researchers at Demant** who run interviews and ethnographic fieldwork in English, German or French. They record
on microphones in the field, so a Teams recording (and Teams' own transcript) is often not an option.

Their job: turn a recording into a transcript they can trust and use. They name the speakers, check passages
against the audio, correct misheard words and names, translate German or French sessions to English when needed,
and take the Word file into their analysis: quoting, coding and sharing it with colleagues.

## Product Purpose

DeScribe turns a recorded interview or field session into a readable transcript with speaker names and
timestamps. The researcher can listen from any turn, correct the text, translate it to English and download it as
`.docx`.

Success: a researcher gets from a raw recording to a transcript they can quote from without installing anything,
asking IT, or sending data anywhere they didn't choose.

## Positioning

Confirmed reasons a researcher picks DeScribe over the transcription built into Teams or Word:

- **Any recording.** Field recordings from microphones, not just Teams meetings. Audio or video up to 3 GB and
  10 hours.
- **The researcher controls the data.** Their own API keys. The recording goes only to ElevenLabs. Transcript text
  goes to Anthropic or Google only when they translate, and only to the one they pick. A Content Security Policy
  limits the page to those three API hosts. Zero retention is available on ElevenLabs Enterprise.
- **No install, no IT.** One HTML file from SharePoint, double-clicked, running from `file://` in Edge or Chrome.
- **Domain accuracy.** A glossary of product names, people and jargon (`Oticon Intent`, `BTE`, `audiogram`) is
  sent to ElevenLabs as key terms and given to the translation.
- **German and French to English** on demand, with Claude or Gemini, exported to Word.

## Operating Context

- **Distribution:** `DeScribe-v<version>.html` in the team's SharePoint folder. Windows laptops, Edge or Chrome.
  Firefox is not supported. Company proxies may block the API hosts.
- **Flow:** three steps, Setup → Glossary → Output. Setup takes the keys, the recording and the options; Glossary
  takes the terms; Output shows progress, then the transcript with speakers, playback, edit, translate and
  export.
- **Recordings are long.** Multi-hour sessions take several minutes to transcribe and the tab must stay open. A
  3-hour session is about 2,200 turns and 25,000 words, and the Output step must stay responsive at that size.
- **Costs are the researcher's own:** ElevenLabs bills per hour of audio (a glossary adds about 20%); translation
  bills the Claude or Gemini account.
- **What persists:** the glossary, settings and the latest transcript stay in the browser; the recording does
  not, so playback after a reload means attaching it again. Every HTML file opened from disk shares one browser
  storage. Glossaries are shared between colleagues by copy and paste.
- **What leaves:** the Word file (Calibri, header block, one paragraph per turn) is what reaches other people.
- **Who builds it:** one maintainer, working in phases with coding agents (`docs/phases/`).

## Capabilities and Constraints

**Shipped (1.0.0, plus Edit text unreleased):**
- Transcription with ElevenLabs `scribe_v2`: speakers, word timestamps, clean verbatim (fixed, not a setting).
  Language auto, English, German or French. Number of speakers auto or 1–32. Zero retention.
- Glossary: paste, edit, delete, clear, copy; invalid terms are marked skipped.
- Output: turns with timestamps, speaker renaming, Edit text (turn text only), playback from any turn, Follow
  playback, Space to play or pause, autosave and reopen of the last transcript.
- Translation to English with Claude or Gemini: progress, Cancel and Resume in the actions row; Original | English
  switch once a translation exists.
- `.docx` export of the original or the English version.
- About: where data goes, where keys are kept, Forget all keys, Clear saved data, providers' privacy and terms.

**Hard constraints:** one self-contained HTML file with nothing loaded from the network; three allowed API hosts;
keys handled only through `src/storage/secrets.ts`; Chromium targets; UI in English. Details and the full list are
in [AGENTS.md](AGENTS.md).

**Terminology** used in the UI and docs: *Setup*, *Glossary*, *Output* (steps); *turn*; *speaker*; *Run*;
*Translate to English*; *Original* / *English*; *Edit text*; *Follow playback*; *Last transcript*; *Remember keys on
this computer*; *Zero retention*; *Download .docx*.

**Not decided** (ideas in [docs/phases/future.md](docs/phases/future.md), not commitments): AI audit of the
transcript, other transcription providers, splitting/merging/reassigning turns, several files in a queue, saving
and opening transcript files, `.txt` and subtitle export, word-level highlighting, a UI in German and French, a
dark theme.

## Brand Commitments

- **Name:** DeScribe (renamed from Describe on 2026-10-31, D35).
- **Its own tool.** DeScribe does not carry Demant's corporate identity (confirmed 2026-10-14). Its identity is the
  maintainer's existing choices, recorded in [docs/DECISIONS.md](docs/DECISIONS.md): D13 minimal UI, D15 speaker
  colours as marks only, D16 DM Sans, D17 the fixed speaker column. Visual details live in the code
  (`src/ui/styles/tokens.css`), not here.
- **Voice:** plain, short English. Say each thing once. Show detail only when it's needed. Don't announce what the
  user can see happen. Error messages say what happened and what to do next.

## Evidence on Hand

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md): the colleague-facing guide, including privacy and troubleshooting.
- [CHANGELOG.md](CHANGELOG.md): the 1.0.0 release and its known limitations.
- [docs/TESTING.md](docs/TESTING.md): timings for a generated 3-hour transcript.
- `fixtures/`: generated ElevenLabs responses and a synthetic test tone. No real research recordings.

**Absent, so never invent:** user quotes or testimonials, adoption or usage numbers, measured transcription
accuracy, measured translation quality or cost (live check L3 open), and a live run of a recording of 60 minutes
or more (check V4 open).

## Product Principles

1. **The researcher decides where their data goes.** Nothing leaves the browser except to the provider they chose,
   for the step they started. Say so plainly where it matters, and never weaken it quietly: a new host is a
   product decision.
2. **A transcript is only as good as its link to the recording.** Every turn leads back to the audio, and the text
   can be checked and corrected before it is passed on.
3. **Nothing to install, nothing to ask for.** DeScribe keeps working as one file on a locked-down laptop. A
   feature that needs a server or an install changes the product.
4. **Take each step in at a glance** (D13). Fewer words, detail on demand.
5. **Hold up on long fieldwork.** Multi-hour recordings and transcripts of thousands of turns stay responsive and
   survive a reload.

## Accessibility & Inclusion

- **Standard:** WCAG 2.2 AA, checked with axe in the e2e suite (`tests/e2e/a11y.e2e.ts`) and by token contrast
  tests (`src/ui/styles/tokens.spec.ts`).
- Real buttons, inputs and labels; everything keyboard-reachable; visible focus; status changes announced through
  `aria-live` (AGENTS.md rule 9). When visible text is removed (D13), the accessible name or announcement stays.
- Colour never carries meaning alone: speaker names identify speakers, and colours are only marks (D15).
- No user-specific needs beyond this standard have been established.
