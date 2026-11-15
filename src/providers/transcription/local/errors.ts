// Local failures as ProviderErrors, each with a message that says what to do (DECISIONS.md D41: the technical detail
// stays behind Technical details). Drafts: Phase 36 words them. Kinds that need a change before trying again are
// 'validation', which hides Try again (JobStatus); the rest keep it.
import { ProviderError, type ProviderErrorKind } from '../../errors';
import type { LocalErrorKind, LocalSttError } from './bridge';

const MESSAGES: Record<LocalErrorKind, { kind: ProviderErrorKind; message: string }> = {
  busy: { kind: 'unknown', message: 'Another transcription is already running on this computer.' },
  recording: {
    kind: 'validation',
    message: "DeScribe can't find this recording any more. Choose it again on Setup.",
  },
  'pack-missing': {
    kind: 'validation',
    message: "The speech models for transcribing on this computer aren't installed.",
  },
  'pack-damaged': {
    kind: 'validation',
    message: 'The speech models on this computer are damaged. Download them again in Settings.',
  },
  'pack-outdated': {
    kind: 'validation',
    message: 'This version of DeScribe needs newer speech models. Download them in Settings.',
  },
  cpu: {
    kind: 'validation',
    message:
      "This computer's processor can't run the speech models. Transcribe with ElevenLabs instead.",
  },
  unreadable: {
    kind: 'validation',
    message: "DeScribe can't read the audio in this file. Try an MP3, M4A or WAV.",
  },
  'out-of-memory': {
    kind: 'server',
    message: 'This computer ran out of memory while transcribing. Close other apps and try again.',
  },
  engine: {
    kind: 'server',
    message: 'Transcribing on this computer stopped unexpectedly. Try again.',
  },
  cancelled: { kind: 'aborted', message: 'Transcription cancelled.' },
};

const OPUS_MESSAGE =
  "DeScribe can't read Ogg Opus files on this computer. Use an MP3 or M4A, or transcribe with ElevenLabs.";

/** `error` as the ProviderError the job store shows. `fileName` names an Ogg Opus file in its message. */
export function toProviderError(error: LocalSttError, fileName: string): ProviderError {
  const { kind, message } = MESSAGES[error.kind];
  const opus = error.kind === 'unreadable' && /\.opus$/i.test(fileName);
  return new ProviderError(kind, opus ? OPUS_MESSAGE : message, {
    detail: `${error.kind}: ${error.detail}`.trim(),
  });
}
