import { describe, expect, it } from 'vitest';
import { technicalDetails } from '../../errors';
import { DOWNLOAD_ERROR_KINDS, SpeechPackError } from './bridge';
import { toDownloadProviderError, toRemoveProviderError } from './downloadErrors';

describe('download failures', () => {
  it('give each kind its own message', () => {
    const messages = DOWNLOAD_ERROR_KINDS.map(
      (kind) => toDownloadProviderError(new SpeechPackError(kind, 'x'), '0.8 GB').userMessage,
    );
    expect(new Set(messages).size).toBe(DOWNLOAD_ERROR_KINDS.length);
    const byKind = (kind: (typeof DOWNLOAD_ERROR_KINDS)[number]) =>
      toDownloadProviderError(new SpeechPackError(kind, 'x'), '0.8 GB').userMessage;
    expect(byKind('blocked')).toContain("didn't allow the download from huggingface.co");
    expect(byKind('offline')).toContain("Couldn't reach huggingface.co");
    expect(byKind('busy')).toBe('Hugging Face is busy. Try again in a few minutes.');
    expect(byKind('disk')).toBe('Not enough disk space: the speech models need 0.8 GB.');
    expect(byKind('write')).toBe(
      "DeScribe couldn't save the speech models. Close other apps that might use them, and try again.",
    );
    expect(byKind('mismatch')).toBe("The download didn't arrive intact. Try again.");
    expect(byKind('gone')).toContain('Update DeScribe.');
  });

  it('keep the kind and Rust’s detail for Technical details', () => {
    const error = toDownloadProviderError(
      new SpeechPackError('blocked', 'words.gguf: HTTP 403 (huggingface.co 302 → cdn 403)'),
      '0.8 GB',
    );
    expect(technicalDetails(error)).toBe(
      'refused\nblocked: words.gguf: HTTP 403 (huggingface.co 302 → cdn 403)',
    );
  });

  it('word a removal that something stopped', () => {
    expect(toRemoveProviderError(new SpeechPackError('in-use', 'x')).userMessage).toBe(
      'Wait for the transcription to finish, then try again.',
    );
    expect(toRemoveProviderError(new SpeechPackError('write', 'x')).userMessage).toContain(
      "couldn't remove",
    );
  });
});
