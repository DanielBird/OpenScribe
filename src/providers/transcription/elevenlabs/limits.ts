// From docs/reference/elevenlabs-stt.md (Limits & cost).
export const ELEVENLABS_LIMITS = {
  maxFileBytes: 3 * 1024 ** 3,
  maxDurationSec: 10 * 3600,
  minDurationSec: 0.1,
  maxSpeakers: 32,
  keyterms: {
    maxTerms: 1000,
    // The API reference says each keyterm "must be less than 50 characters".
    maxChars: 49,
    maxWords: 5,
    // "The following characters are not supported". One such term makes the whole request fail (V1).
    forbiddenChars: '<>{}[]\\',
  },
} as const;

export const ELEVENLABS_MODEL = 'scribe_v2';
