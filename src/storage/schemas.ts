// Zod schemas for what Describe reads back from storage and from the project folder. A value that doesn't match is
// ignored or reported, never repaired (DECISIONS.md D18).
import type { SessionText } from '../domain/corpus/sessionText';
import type { SessionSummary } from '../domain/summary';
import { TRANSCRIPT_SCHEMA_VERSION, type TranscriptDoc } from '../domain/transcript';
import { z } from '../lib/zod';
import type { FileStat } from './folder';

const SpeakerSchema = z.object({ id: z.string(), label: z.string() });

const WordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  logprob: z.number().nullable(),
});

const TurnSchema = z.object({
  id: z.string(),
  speakerId: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(WordSchema),
});

const TranslationSchema = z.object({
  provider: z.enum(['claude', 'gemini']),
  model: z.string(),
  createdAt: z.string(),
  texts: z.record(z.string(), z.string()),
});

/** What a saved transcript must look like to be used: the last transcript, and a project's transcript files. */
export const TranscriptDocSchema = z.object({
  schemaVersion: z.literal(TRANSCRIPT_SCHEMA_VERSION),
  id: z.string(),
  createdAt: z.string(),
  source: z.object({
    fileName: z.string(),
    fileSize: z.number(),
    mimeType: z.string(),
    lastModified: z.number(),
    durationSec: z.number().nullable(),
  }),
  request: z.object({
    provider: z.literal('elevenlabs'),
    model: z.string(),
    languageHint: z.enum(['auto', 'en', 'de', 'fr']),
    numSpeakers: z.number().nullable(),
    zeroRetention: z.boolean(),
    keyterms: z.array(z.string()),
  }),
  result: z.object({
    providerTranscriptId: z.string().nullable(),
    languageCode: z.string(),
    languageProbability: z.number().nullable(),
    audioDurationSec: z.number().nullable(),
  }),
  speakers: z.array(SpeakerSchema),
  turns: z.array(TurnSchema),
  translations: z.object({ en: TranslationSchema.optional() }),
}) satisfies z.ZodType<TranscriptDoc>;

/** A transcript's text without word timings, as the corpus cache keeps it (`domain/corpus/sessionText.ts`). */
export const SessionTextSchema = z.object({
  sessionId: z.string(),
  recordingName: z.string(),
  recordedAt: z.number(),
  durationSec: z.number().nullable(),
  languageCode: z.string(),
  speakers: z.array(SpeakerSchema),
  turns: z.array(
    z.object({
      id: z.string(),
      speakerId: z.string(),
      start: z.number(),
      text: z.string(),
      en: z.string().nullable(),
    }),
  ),
  transcriptHash: z.string(),
}) satisfies z.ZodType<SessionText>;

const SummaryQuoteSchema = z.object({ turnId: z.string(), text: z.string() });

/** A session summary as it is saved in the project folder (`domain/summary.ts`). */
export const SessionSummarySchema = z.object({
  title: z.string(),
  synopsis: z.string(),
  overview: z.string(),
  respondents: z.array(
    z.object({
      speakerId: z.string().nullable(),
      label: z.string(),
      attributes: z.array(
        z.object({ field: z.string(), value: z.string(), turnIds: z.array(z.string()) }),
      ),
    }),
  ),
  researchQuestions: z.array(
    z.object({
      question: z.string(),
      finding: z.string(),
      turnIds: z.array(z.string()),
      quotes: z.array(SummaryQuoteSchema),
    }),
  ),
  themes: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      turnIds: z.array(z.string()),
      isNew: z.boolean(),
      quotes: z.array(SummaryQuoteSchema),
    }),
  ),
}) satisfies z.ZodType<SessionSummary>;

export const FileStatSchema = z.object({
  size: z.number(),
  lastModified: z.number(),
}) satisfies z.ZodType<FileStat>;
