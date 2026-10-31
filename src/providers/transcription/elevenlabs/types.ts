// Runtime schemas for ElevenLabs responses (docs/reference/elevenlabs-stt.md). These shapes never leave
// this folder; mapper.ts turns them into NormalizedTranscription.
import { z } from '../../../lib/zod';

export const ElevenLabsWordSchema = z.object({
  text: z.string(),
  start: z.number().nullish(),
  end: z.number().nullish(),
  // 'word' | 'spacing' | 'audio_event' today. Kept open so a new type can't break every transcription.
  type: z.string(),
  speaker_id: z.string().nullish(),
  logprob: z.number().nullish(),
});

/** Single-channel response. The multichannel shape (`{ transcripts: [...] }`) is never requested. */
export const ElevenLabsResponseSchema = z.object({
  language_code: z.string().nullish(),
  language_probability: z.number().nullish(),
  text: z.string().nullish(),
  words: z.array(ElevenLabsWordSchema),
  transcription_id: z.string().nullish(),
  audio_duration_secs: z.number().nullish(),
});

/** `detail` is a string, `{ status, message }`, or (for request validation) a FastAPI-style list. */
export const ElevenLabsErrorBodySchema = z.object({
  detail: z.union([
    z.string(),
    // Seen live (2026-10-13): { type, code, message, status, request_id, param }. `status` is the specific
    // reason (e.g. "invalid_keyword"), `code` the general one (e.g. "invalid_parameters").
    z.object({
      status: z.string().nullish(),
      code: z.string().nullish(),
      message: z.string().nullish(),
      request_id: z.string().nullish(),
    }),
    z.array(
      z.object({
        msg: z.string().nullish(),
        loc: z.array(z.union([z.string(), z.number()])).nullish(),
      }),
    ),
  ]),
});
