// Request building (docs/reference/elevenlabs-stt.md, "Request fields DeScribe sends"; DECISIONS.md D4, D5).
import type { TranscriptionInput } from '../types';
import { ELEVENLABS_MODEL } from './limits';

export const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io';
export const ELEVENLABS_STT_URL = `${ELEVENLABS_API_BASE}/v1/speech-to-text`;

/**
 * The smallest request that makes ElevenLabs check a key: a transcription with no audio. The key is checked
 * before the body, so nothing is transcribed or billed (verification log V3).
 */
export function buildKeyCheckFormData(): FormData {
  const form = new FormData();
  form.append('model_id', ELEVENLABS_MODEL);
  return form;
}

/** Zero retention is a query parameter (Enterprise only). */
export function buildUrl(zeroRetention: boolean): string {
  return zeroRetention ? `${ELEVENLABS_STT_URL}?enable_logging=false` : ELEVENLABS_STT_URL;
}

/**
 * The multipart body. The API key is not part of it (it goes in the `xi-api-key` header). Optional fields
 * are omitted when unset: language for Auto, speakers for Auto, keyterms for an empty glossary.
 * Keyterms are sent as repeated fields, one term per field (confirmed live, verification log V1: a single
 * JSON-array string is rejected as a term with invalid characters).
 */
export function buildFormData(
  input: Pick<TranscriptionInput, 'file' | 'languageHint' | 'numSpeakers' | 'keyterms'>,
): FormData {
  const form = new FormData();
  form.append('model_id', ELEVENLABS_MODEL);
  form.append('file', input.file, input.file.name);
  if (input.languageHint !== 'auto') form.append('language_code', input.languageHint);
  form.append('diarize', 'true');
  if (input.numSpeakers !== null) form.append('num_speakers', String(input.numSpeakers));
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  form.append('no_verbatim', 'true');
  for (const term of input.keyterms) form.append('keyterms', term);
  return form;
}
