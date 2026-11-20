// Local failures as ProviderErrors, each with a message that says what to do (DECISIONS.md D41: the technical detail
// stays behind Technical details). Kinds that need a change before trying again are 'validation', which hides Try
// again (JobStatus); the rest keep it. The speech models' own failures offer Settings, where they are downloaded. A
// failure on a graphics card names it and offers the processor (Phase 37, decision 6).
import { ProviderError, type ProviderErrorKind } from '../../errors';
import type { LocalErrorKind, LocalSttError } from './bridge';

const MESSAGES: Record<
  LocalErrorKind,
  { kind: ProviderErrorKind; message: string; fixIn?: 'settings'; retryOn?: 'processor' }
> = {
  busy: { kind: 'unknown', message: 'Another transcription is already running on this computer.' },
  downloading: {
    kind: 'unknown',
    message: 'DeScribe is downloading its speech models. Try again when it has finished.',
  },
  recording: {
    kind: 'validation',
    message: "DeScribe can't find this recording any more. Choose it again on Setup.",
  },
  'pack-missing': {
    kind: 'validation',
    message:
      "The speech models aren't on this computer any more. Download them in Settings, or transcribe with ElevenLabs.",
    fixIn: 'settings',
  },
  'pack-damaged': {
    kind: 'validation',
    message: 'The speech models on this computer are damaged. Download them again in Settings.',
    fixIn: 'settings',
  },
  'pack-outdated': {
    kind: 'validation',
    message: 'This version of DeScribe needs newer speech models. Download them in Settings.',
    fixIn: 'settings',
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
  gpu: {
    kind: 'server',
    message: 'The graphics card stopped while transcribing.',
    retryOn: 'processor',
  },
  cancelled: { kind: 'aborted', message: 'Transcription cancelled.' },
};

const OPUS_MESSAGE =
  "DeScribe can't read Ogg Opus files on this computer. Use an MP3 or M4A, or transcribe with ElevenLabs.";

/** The message for a failure on `card`, naming it when it's known. */
function gpuMessage(card: string | null): string {
  return card ? `The graphics card (${card}) stopped while transcribing.` : MESSAGES.gpu.message;
}

/**
 * `error` as the ProviderError the job store shows. `fileName` names an Ogg Opus file in its message; `card` is the
 * graphics card the run was on, or null for the processor.
 */
export function toProviderError(
  error: LocalSttError,
  { fileName, card }: { fileName: string; card: string | null },
): ProviderError {
  const { kind, message, fixIn, retryOn } = MESSAGES[error.kind];
  const opus = error.kind === 'unreadable' && /\.opus$/i.test(fileName);
  const text = opus ? OPUS_MESSAGE : error.kind === 'gpu' ? gpuMessage(card) : message;
  return new ProviderError(kind, text, {
    detail: `${error.kind}: ${error.detail}`.trim(),
    fixIn,
    retryOn,
  });
}
