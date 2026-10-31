import { describe, expect, it } from 'vitest';
import nullSpeakers from '../../../../fixtures/elevenlabs/null-speakers.json';
import twoSpeakers from '../../../../fixtures/elevenlabs/two-speakers-short.json';
import { ProviderError } from '../../errors';
import { toNormalized } from './mapper';

function expectBadOutput(json: unknown): ProviderError {
  try {
    toNormalized(json);
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe('bad_output');
    return err as ProviderError;
  }
  throw new Error('expected toNormalized to throw');
}

describe('toNormalized', () => {
  it('maps a single-channel response', () => {
    const norm = toNormalized(twoSpeakers);
    expect(norm).toMatchObject({
      providerTranscriptId: 'fixture-two-speakers-short',
      languageCode: 'deu',
      languageProbability: 0.97,
      audioDurationSec: 16.6,
    });
    expect(norm.tokens).toHaveLength(70);
    expect(norm.tokens.slice(0, 3)).toEqual([
      { text: ' ', start: 0, end: 0.2, speakerId: 'speaker_0', kind: 'spacing', logprob: 0 },
      { text: 'Guten', start: 0.2, end: 0.5, speakerId: 'speaker_0', kind: 'word', logprob: 0 },
      { text: ' ', start: 0.5, end: 0.6, speakerId: 'speaker_0', kind: 'spacing', logprob: 0 },
    ]);
  });

  it('keeps null speakers and null times as null (segmentation fills them)', () => {
    const norm = toNormalized(nullSpeakers);
    expect(norm.tokens.every((t) => t.speakerId === null)).toBe(true);
    expect(norm.tokens.filter((t) => t.start === null)).toHaveLength(3);
  });

  it('maps audio_event to event, and unknown types to word', () => {
    const norm = toNormalized({
      language_code: 'eng',
      words: [
        { text: '(laughter)', type: 'audio_event' },
        { text: 'hm', type: 'something_new' },
      ],
    });
    expect(norm.tokens.map((t) => t.kind)).toEqual(['event', 'word']);
  });

  it('turns missing optional fields into nulls', () => {
    const norm = toNormalized({ words: [{ text: 'Hi', type: 'word' }] });
    expect(norm).toEqual({
      providerTranscriptId: null,
      languageCode: '',
      languageProbability: null,
      audioDurationSec: null,
      tokens: [
        { text: 'Hi', start: null, end: null, speakerId: null, kind: 'word', logprob: null },
      ],
    });
  });

  it('accepts an empty transcript (silence)', () => {
    expect(toNormalized({ language_code: 'eng', text: '', words: [] }).tokens).toEqual([]);
  });

  it('rejects the multichannel shape', () => {
    const err = expectBadOutput({ transcripts: [twoSpeakers] });
    expect(err.userMessage).toContain('multichannel');
  });

  it.each([
    ['null', null],
    ['a string', 'hello'],
    ['an object without words', { language_code: 'eng' }],
    ['words that are not a list', { words: 'nope' }],
    ['a word without text', { words: [{ type: 'word', start: 0 }] }],
    ['a time that is not a number', { words: [{ text: 'a', type: 'word', start: '0.1' }] }],
  ])('rejects %s as bad_output, naming the problem in detail', (_label, json) => {
    const err = expectBadOutput(json);
    expect(err.userMessage).toBe(
      "ElevenLabs sent a response that DeScribe couldn't read. Try again.",
    );
    expect(err.opts.detail).toBeTruthy();
  });
});
