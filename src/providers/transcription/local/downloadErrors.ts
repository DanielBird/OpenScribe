// A failed download or removal of the speech models as a ProviderError, so Settings shows its message with
// Technical details (DECISIONS.md D41) as every other failure does. Drafts (D13): Phase 36 may trim them.
import { ProviderError, type ProviderErrorKind } from '../../errors';
import type { DownloadErrorKind, SpeechPackError } from './bridge';

const HOST = 'huggingface.co';

function message(kind: DownloadErrorKind, size: string): { kind: ProviderErrorKind; text: string } {
  switch (kind) {
    case 'blocked':
      return {
        kind: 'refused',
        text: `Your network didn't allow the download from ${HOST}. Try another network, or ask IT to allow it.`,
      };
    case 'offline':
      return {
        kind: 'network',
        text: `Couldn't reach ${HOST}. Check your connection and try again.`,
      };
    case 'busy':
      return { kind: 'rate_limit', text: 'Hugging Face is busy. Try again in a few minutes.' };
    case 'disk':
      return { kind: 'validation', text: `Not enough disk space: the speech models need ${size}.` };
    case 'mismatch':
      return { kind: 'bad_output', text: "The download didn't arrive intact. Try again." };
    case 'gone':
      return {
        kind: 'validation',
        text: "This version of DeScribe can't download its speech models any more. Update DeScribe.",
      };
    case 'in-use':
      return { kind: 'unknown', text: 'Wait for the transcription to finish, then try again.' };
    case 'cancelled':
      return { kind: 'aborted', text: 'Download cancelled.' };
  }
}

/** `error` as the ProviderError Settings shows. `size` is the download's size as shown beside its button. */
export function toDownloadProviderError(error: SpeechPackError, size: string): ProviderError {
  const { kind, text } = message(error.kind, size);
  return new ProviderError(kind, text, { detail: `${error.kind}: ${error.detail}`.trim() });
}

/** A failed removal: a write that failed, or something still running. */
export function toRemoveProviderError(error: SpeechPackError): ProviderError {
  if (error.kind === 'in-use') return toDownloadProviderError(error, '');
  return new ProviderError(
    'unknown',
    "DeScribe couldn't remove the speech models. Close other apps that might use them, and try again.",
    { detail: `${error.kind}: ${error.detail}`.trim() },
  );
}
