# Future work (after 1.0)

These are not planned in detail. The v1 architecture already leaves room for each of them. When one is picked up,
turn it into a numbered phase file using the same template.

## F1 — AI audit of transcript quality

**Idea:** An LLM reviews the transcript and suggests corrections (misheard words, glossary terms spelled wrong,
speaker misattributions). The user accepts or rejects each suggestion.

**Hooks already in v1:**
- `LlmProvider.generateStructured` (Phase 6) can be reused as is.
- `Turn.words[].logprob` is stored, so low-confidence words can be pointed out to the model.
- `doc.request.keyterms` holds the glossary used.

**Sketch:**
- `features/audit/audit.ts` batches turns like translation does. Each batch sends turns, low-confidence words
  (`logprob` below a threshold) and the glossary. The output is
  `{ suggestions: { turnId, original, suggested, reason, confidence }[] }`.
- UI: an "Audit" button opens a review panel listing suggestions, each with a diff and Accept/Reject.
- Data model change (schema v2): `Turn.originalText` keeps the machine text, `Turn.text` holds the accepted
  version, and `doc.audit = { provider, model, createdAt, suggestions[], decisions }`. This needs a storage
  migration and a DECISIONS entry.
- Option: Gemini accepts audio input, so an audio-aware audit could send short clips around low-confidence words.
  This would change the privacy statement and needs explicit approval.

## F2 — More transcription providers

*Partly delivered by Phases 33–36 (DECISIONS D50, D56): the desktop app has a second provider, `local`, and Setup's
choice between it and ElevenLabs (`supports` hides what a provider can't take). A third provider would add its id
and its place in that choice.*

**Hooks:** the `TranscriptionProvider` interface, the `NormalizedTranscription` tokens, provider-agnostic
segmentation (T3), and `getTranscriptionProvider()`.

**Steps:**
1. Implement the provider folder under `providers/transcription/<name>/`. Map the provider's output to
   normalized tokens and give it its own limits.
2. Add a provider select on Setup, with per-provider key fields and options. Hide options the provider doesn't
   support.
3. Add the provider's host to the CSP, DECISIONS and the About panel.
4. Glossary limits come from the selected provider (`validateList` already takes limits).

## F3 — More transcript editing

Turn text became editable in Phase 9 (DECISIONS D19). Still open:
- Split and merge turns.
- Reassign a turn to another speaker.
- Undo/redo across turns.
- `originalText`: keep the machine text so a turn can be restored. This shares the schema v2 change with F1.
- Edit the English translation.

## F4 — Smaller ideas

- Process several files in a queue (one transcript each).
- **Save/Open transcript (.json):** keep several jobs without paying twice. The autosave already uses the same
  format.
- A Word template with company branding for the export.
- More export formats: `.txt`, `.srt`/`.vtt` subtitles (turn times are available).
- Word-level highlighting during playback (uses `turn.words`).
- UI translated into German and French.
- Speaker role detection (ElevenLabs `detect_speaker_roles`; +10% cost) to pre-fill names like
  "Interviewer"/"Participant".
- Detect silent playback in Chrome (AC-3 audio in an MP4, reference V6). Chromium's `webkitAudioDecodedByteCount`
  stays at 0 while `currentTime` advances, which could show the existing format message. This is a non-standard API,
  so try it on real files in Edge and Chrome before relying on it.
- A dark theme (tokens are ready for it; contrast is checked in `tokens.spec.ts`).
- **Right-to-left transcripts** (Arabic, Hebrew, Persian, Urdu; Auto-detect transcribes them since Phase 26): `dir="auto"`
  on each turn's text, the edit box and search snippets, and right-to-left paragraphs in the `.docx` (`docx` 9.11 has
  `bidirectional` on paragraphs and `rightToLeft` on runs).
- **Translating into languages other than English.** English is the only target, and projects rely on it (summaries,
  quotes and search read the English text, PROJECTS.md A4), so this is a redesign rather than an option.

## F5 — Finding personal data

**Idea:** a model suggests the names and other personal data in a transcript, for Phase 38's **Find and replace**
dialog (D59) to replace. NVIDIA's GLiNER PII model is the first candidate; another may do. Today the user finds each
name by reading.

**Hooks:** `domain/replace.ts` (`findMatches`, `replaceInText`, `replaceInWords`) and the transcript store's
`replaceMatches` replace whatever is found, in the text and the word list.

**Also left out by Phase 38**, for when this is picked up:
- Several names at once, or a saved list of names, per project or on this computer.
- Speaker labels, the recording's file name, and the glossary terms saved in `request.keyterms`.
- Summaries, quotes and chats already in a project, and the project's other sessions.
- Undo, a match-case or regex option, and highlighting the match in the transcript behind the dialog.
- The audio, which still has the names.

## F6 — More summary editing

**Idea:** Phase 39 (D60) lets a researcher correct a summary by hand. Left out of it, for later:
- **Editing a summary with AI:** a prompt box under the summary, or `@` a session in the project chat with an edit tool
  that reaches only the summaries named. The maintainer's answers so far: one summary per request, written directly,
  and the model's output checked as any summary is (`checkSummary`). The project agent's other tools stay read-only.
- **Renaming or merging a theme in every summary,** without AI.
- Undo and redo across blocks, and of a removed theme or quote.
- Adding and removing respondents; changing a quote's words or its turn by hand; editing a research question's wording.
- An edit history: who edited a summary and when, or earlier versions.
- A warning before **Regenerate** replaces edits, and updating a chat already open with an edited summary.

**Hooks:** `domain/summaryEdit.ts` (the edits as functions), `stores/summaryEdit.ts` (the draft, autosave and the
change check), `project.saveEditedSummary`.
