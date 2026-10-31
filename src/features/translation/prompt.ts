import { z } from '../../lib/zod';
import type { Batch } from './batching';

/** The instructions for every batch. Only the source language changes. */
export function systemPrompt(sourceLanguage: string): string {
  return [
    `You are a professional translator. Translate the transcript segments from ${sourceLanguage} into natural, faithful English.`,
    '- Translate every segment in `segments`. Return exactly one item per input `id`, using the same `id`.',
    "- Do not merge, split, summarise, shorten, explain or omit anything. Keep the speaker's tone, hedges and informal style.",
    '- Keep names, product names and the glossary terms exactly as written, unless a standard English form exists.',
    '- `context` segments are earlier turns, provided only for understanding. Do not translate or return them.',
    '- If a segment is already in English, return it unchanged.',
  ].join('\n');
}

/**
 * The user message: the glossary, the context turns and the segments to translate, as JSON.
 * `speakerLabels` maps speaker ids to the names shown in the transcript.
 */
export function buildInput(
  batch: Batch,
  glossary: readonly string[],
  speakerLabels: ReadonlyMap<string, string>,
): string {
  const speaker = (id: string) => speakerLabels.get(id) ?? id;
  return JSON.stringify({
    glossary,
    context: batch.context.map((t) => ({ speaker: speaker(t.speakerId), text: t.text })),
    segments: batch.turns.map((t) => ({ id: t.id, speaker: speaker(t.speakerId), text: t.text })),
  });
}

/** What the model returns for one batch. */
export const TranslationBatchSchema = z.object({
  translations: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type TranslationBatch = z.infer<typeof TranslationBatchSchema>;
