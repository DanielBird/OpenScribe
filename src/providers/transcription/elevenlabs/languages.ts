// The languages Setup offers (DECISIONS.md D37): ElevenLabs' "Excellent" tier, a word error rate of 5% or less, as
// its Speech-to-Text page listed them on 2026-11-01 (docs/reference/elevenlabs-stt.md, "Supported languages"). Other
// languages are still transcribed with Auto-detect.
import { normalizeLanguage } from '../../../domain/transcript';

/** ISO 639-3, as ElevenLabs writes them and accepts them in `language_code`. */
// prettier-ignore
export const ELEVENLABS_LANGUAGES = [
  'bel', 'bos', 'bul', 'cat', 'hrv', 'ces', 'dan', 'nld', 'eng', 'est', 'fin', 'fra',
  'glg', 'deu', 'ell', 'hun', 'isl', 'ind', 'ita', 'jpn', 'kan', 'lav', 'mkd', 'msa',
  'mal', 'nor', 'pol', 'por', 'ron', 'rus', 'slk', 'spa', 'swe', 'tur', 'ukr', 'vie',
] as const;

/** ElevenLabs' own code for a language hint (`de` → `deu`), or the hint itself if it isn't listed. */
export function elevenLabsLanguageCode(hint: string): string {
  return ELEVENLABS_LANGUAGES.find((code) => normalizeLanguage(code) === hint) ?? hint;
}
