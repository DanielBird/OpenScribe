import type { NormalizedToken, NormalizedTranscription } from '../../domain/tokens';
import type { LanguageHint } from '../../domain/transcript';

export type { NormalizedToken, NormalizedTranscription };

export interface TranscriptionInput {
  file: File;
  apiKey: string;
  languageHint: LanguageHint;
  numSpeakers: number | null;
  zeroRetention: boolean;
  keyterms: string[];
}

export type TranscriptionProgress =
  { phase: 'uploading'; loaded: number; total: number } | { phase: 'processing' };

export interface KeyCheckResult {
  ok: boolean;
  message: string;
}

export interface TranscriptionProvider {
  readonly id: 'elevenlabs';
  readonly model: string;
  readonly limits: {
    maxFileBytes: number;
    maxDurationSec: number;
    minDurationSec: number;
    maxSpeakers: number;
    /** `forbiddenChars`: every character in this string is rejected by the provider inside a term. */
    keyterms: { maxTerms: number; maxChars: number; maxWords: number; forbiddenChars: string };
  };
  transcribe(
    input: TranscriptionInput,
    opts: { signal: AbortSignal; onProgress: (p: TranscriptionProgress) => void },
  ): Promise<NormalizedTranscription>;
  verifyKey?(apiKey: string, signal?: AbortSignal): Promise<KeyCheckResult>;
}
