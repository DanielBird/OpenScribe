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
