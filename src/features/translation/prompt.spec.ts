import { describe, expect, it } from 'vitest';
import { makeDoc } from '../../testing/transcriptDoc';
import { makeBatches } from './batching';
import { buildInput, systemPrompt, TranslationBatchSchema } from './prompt';

describe('systemPrompt', () => {
  it('names the source language and the rules', () => {
    const prompt = systemPrompt('German');
    expect(prompt).toContain('from German into natural, faithful English.');
    expect(prompt).toContain('Return exactly one item per input `id`');
    expect(prompt).toContain('`context` segments are earlier turns');
    expect(prompt).toContain("Keep the speaker's tone");
  });

  it('leaves out a source language that is not known', () => {
    expect(systemPrompt('').split('\n')[0]).toBe(
      'You are a professional translator. Translate the transcript segments into natural, faithful English.',
    );
  });
});

describe('buildInput', () => {
  const doc = makeDoc();
  const labels = new Map([
    ['speaker_0', 'Interviewer'],
    ['speaker_1', 'Speaker 2'],
  ]);

  it('sends the glossary, the context and the segments with speaker names', () => {
    const [, second] = makeBatches(doc.turns, { maxTurns: 3, contextTurns: 2 });
    const input = JSON.parse(buildInput(second!, ['Describe', 'Demant'], labels)) as unknown;
    expect(input).toEqual({
      glossary: ['Describe', 'Demant'],
      context: [
        { speaker: labels.get(doc.turns[1]!.speakerId), text: doc.turns[1]!.text },
        { speaker: labels.get(doc.turns[2]!.speakerId), text: doc.turns[2]!.text },
      ],
      segments: doc.turns.slice(3).map((t) => ({
        id: t.id,
        speaker: labels.get(t.speakerId),
        text: t.text,
      })),
    });
  });

  it('falls back to the speaker id when a label is missing', () => {
    const [batch] = makeBatches(doc.turns.slice(0, 1));
    const input = JSON.parse(buildInput(batch!, [], new Map())) as {
      segments: { speaker: string }[];
    };
    expect(input.segments[0]!.speaker).toBe(doc.turns[0]!.speakerId);
  });
});

describe('TranslationBatchSchema', () => {
  it('accepts translations and rejects other shapes', () => {
    expect(
      TranslationBatchSchema.safeParse({ translations: [{ id: 't1', text: 'Hi.' }] }).success,
    ).toBe(true);
    expect(
      TranslationBatchSchema.safeParse({ translations: [{ id: 1, text: 'Hi.' }] }).success,
    ).toBe(false);
    expect(TranslationBatchSchema.safeParse({ items: [] }).success).toBe(false);
  });
});
