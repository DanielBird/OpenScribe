import type { NormalizedToken, NormalizedTranscription } from '../../domain/tokens';
import type { LanguageHint, TranscriptionProviderId } from '../../domain/transcript';

export type { NormalizedToken, NormalizedTranscription, TranscriptionProviderId };

export interface TranscriptionInput {
  file: File;
  /** '' for a provider that needs no key. */
  apiKey: string;
  languageHint: LanguageHint;
  numSpeakers: number | null;
  zeroRetention: boolean;
  keyterms: string[];
  /** Drop fillers and doubled words where the provider writes them (on this computer, DECISIONS.md D53). */
  cleanUp: boolean;
}

export type TranscriptionProgress =
  | { phase: 'uploading'; loaded: number; total: number }
  | { phase: 'processing' }
  /** On this computer: reading the recording and loading the models. */
  | { phase: 'preparing' }
  /** On this computer: seconds of audio done, out of the total if the file states it. */
  | { phase: 'transcribing'; doneSec: number; totalSec: number | null };

export interface KeyCheckResult {
  ok: boolean;
  message: string;
}

/** How long a run on this computer took (Phase 34, decision 7): the only measurement the work laptop can give. */
export interface TranscriptionTimings {
  decodeSec: number;
  wordsSec: number;
  speakersSec: number;
  totalSec: number;
  threads: number;
  peakMemoryBytes: number | null;
}

/** What a run returns. `timings` only from a provider that measures itself; it never goes into the doc. */
export interface TranscriptionRun extends NormalizedTranscription {
  timings?: TranscriptionTimings;
}

export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId;
  /** The model, as the doc records it: ElevenLabs' model id, or the speech pack's id on this computer. */
  readonly model: string;
  readonly needsKey: boolean;
  /** What a request can ask for. A provider that can't take one is sent none, and the doc records none. */
  readonly supports: {
    keyterms: boolean;
    zeroRetention: boolean;
    numSpeakers: boolean;
    /** Whether it reports the language it detected. Without it, Setup asks for one (Phase 36). */
    autoDetect: boolean;
  };
  readonly limits: {
    maxFileBytes: number;
    maxDurationSec: number;
    minDurationSec: number;
    maxSpeakers: number;
    /** `forbiddenChars`: every character in this string is rejected by the provider inside a term. */
    keyterms?: { maxTerms: number; maxChars: number; maxWords: number; forbiddenChars: string };
  };
  /** The languages that can be chosen instead of Auto-detect, as `normalizeLanguage()` codes. */
  readonly languages: readonly string[];
  transcribe(
    input: TranscriptionInput,
    opts: { signal: AbortSignal; onProgress: (p: TranscriptionProgress) => void },
  ): Promise<TranscriptionRun>;
  verifyKey?(apiKey: string, signal?: AbortSignal): Promise<KeyCheckResult>;
}
