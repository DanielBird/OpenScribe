import { describe, expect, it } from 'vitest';
import { buildTurns } from '../../../domain/segmentation';
import { toTokens, type LocalSegment, type LocalWord } from './mapper';

const w = (text: string, start: number, end = start + 0.3): LocalWord => ({
  text,
  start,
  end,
  confidence: 1,
});
const seg = (speaker: number, start: number, end: number): LocalSegment => ({
  speaker,
  start,
  end,
});

const RAW = { cleanUp: false };
const CLEAN = { cleanUp: true };

const words = (tokens: ReturnType<typeof toTokens>) => tokens.filter((t) => t.kind === 'word');
const speakers = (tokens: ReturnType<typeof toTokens>) => words(tokens).map((t) => t.speakerId);
const texts = (tokens: ReturnType<typeof toTokens>) =>
  words(tokens)
    .map((t) => t.text)
    .join(' ');

describe('toTokens', () => {
  it('gives each word the speaker whose segment overlaps it most', () => {
    const tokens = toTokens(
      [w('Hello', 0.1), w('there.', 0.5), w('Hi.', 2.1)],
      [seg(3, 0, 1.0), seg(5, 2.0, 3.0)],
      RAW,
    );
    expect(speakers(tokens)).toEqual(['speaker_0', 'speaker_0', 'speaker_1']);
  });

  it('weighs overlap, not just the first segment touched', () => {
    // 0.0–0.2 with speaker 0, 0.2–1.0 with speaker 1: the word at 0.1–0.9 is mostly speaker 1.
    const tokens = toTokens(
      [w('First', 0, 0.05), w('word', 0.1, 0.9)],
      [seg(0, 0, 0.2), seg(1, 0.2, 1.0)],
      RAW,
    );
    expect(speakers(tokens)).toEqual(['speaker_0', 'speaker_1']);
  });

  it('gives a word outside every segment the nearest one', () => {
    const tokens = toTokens(
      [w('Before', 0.0), w('gap', 5.0), w('after.', 9.6)],
      [seg(0, 0, 1.0), seg(1, 9.0, 10.0)],
      RAW,
    );
    // "gap" at 5.0–5.3 is 4.0 s from the first segment and 3.7 s from the second.
    expect(speakers(tokens)).toEqual(['speaker_0', 'speaker_1', 'speaker_1']);
  });

  it('lets a lone word between another speaker follow them, unless its own segment holds it', () => {
    const between = [w('So', 0.0), w('we', 0.4), w('went', 0.8), w('home.', 1.2)];
    // "we" barely touches speaker 1's short segment: it follows speaker 0 on both sides.
    const slip = toTokens(between, [seg(0, 0, 0.45), seg(1, 0.45, 0.55), seg(0, 0.55, 1.6)], RAW);
    expect(speakers(slip)).toEqual(['speaker_0', 'speaker_0', 'speaker_0', 'speaker_0']);
    // "we" sits wholly in speaker 1's segment: a real backchannel, kept.
    const held = toTokens(between, [seg(0, 0, 0.4), seg(1, 0.4, 0.75), seg(0, 0.75, 1.6)], RAW);
    expect(speakers(held)).toEqual(['speaker_0', 'speaker_1', 'speaker_0', 'speaker_0']);
  });

  it('picks one speaker for a word said while two speak at once', () => {
    const tokens = toTokens([w('both', 1.0, 1.4)], [seg(0, 0, 1.3), seg(1, 1.1, 2.0)], RAW);
    // 0.3 s with speaker 0, 0.3 s with speaker 1: ties go to the first found; either way exactly one.
    expect(words(tokens)).toHaveLength(1);
    expect(speakers(tokens)).toEqual(['speaker_0']);
  });

  it('puts everything under one speaker when there are no segments', () => {
    const tokens = toTokens([w('One', 0), w('voice.', 0.5)], [], RAW);
    expect(speakers(tokens)).toEqual(['speaker_0', 'speaker_0']);
  });

  it('numbers speakers in order of first appearance, whatever the engine called them', () => {
    const tokens = toTokens(
      [w('a', 0.1), w('b', 1.1), w('c', 2.1), w('d', 3.1)],
      [seg(4, 0, 1), seg(2, 1, 2), seg(4, 2, 3), seg(0, 3, 4)],
      RAW,
    );
    expect(speakers(tokens)).toEqual(['speaker_0', 'speaker_1', 'speaker_0', 'speaker_2']);
  });

  it('sorts words given out of order, and drops ones with impossible times or no text', () => {
    const tokens = toTokens(
      [
        w('second', 1.0),
        w('first', 0.0),
        { text: 'nan', start: Number.NaN, end: 1, confidence: 1 },
        { text: 'negative', start: -1, end: 0, confidence: 1 },
        { text: 'infinite', start: 2, end: Number.POSITIVE_INFINITY, confidence: 1 },
        { text: '  ', start: 3, end: 3.2, confidence: 1 },
        { text: 'backwards', start: 4, end: 3.5, confidence: 1 },
      ],
      [seg(0, 0, 5), { speaker: -1, start: 0, end: 1 }, { speaker: 0, start: 3, end: 2 }],
      RAW,
    );
    expect(texts(tokens)).toBe('first second backwards');
    const last = words(tokens).at(-1)!;
    expect(last.end).toBe(last.start);
  });

  it('puts a spacing token between words, as ElevenLabs does, so segmentation joins them', () => {
    const tokens = toTokens([w('Hello', 0), w('there.', 0.5)], [seg(0, 0, 1)], RAW);
    expect(tokens.map((t) => t.kind)).toEqual(['word', 'spacing', 'word']);
    expect(tokens[1]).toMatchObject({ text: ' ', start: 0.3, end: 0.5 });
    expect(tokens.every((t) => t.logprob === null)).toBe(true);
    expect(buildTurns(tokens).turns[0]!.text).toBe('Hello there.');
  });

  it('maps 25,000 words in reasonable time', () => {
    const many: LocalWord[] = [];
    const segments: LocalSegment[] = [];
    for (let i = 0; i < 25_000; i++) many.push(w(`word${i % 50}.`, i * 0.43));
    for (let s = 0; s < 25_000 * 0.43; s += 7) segments.push(seg((s / 7) % 2, s, s + 7));
    const started = performance.now();
    const tokens = toTokens(many, segments, CLEAN);
    expect(words(tokens)).toHaveLength(25_000);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('the clean-up', () => {
  const run = (list: string[], options = CLEAN) =>
    texts(
      toTokens(
        list.map((t, i) => w(t, i)),
        [seg(0, 0, list.length + 1)],
        options,
      ),
    );

  it('drops fillers, and only fillers', () => {
    expect(run(['So,', 'um,', 'I', 'think', 'uh', 'yes.'])).toBe('So, I think yes.');
    expect(run(['Ähm', 'ich', 'denke', 'er', 'kommt.'])).toBe('Ich denke er kommt.');
    expect(run(['Euh', 'oui.'])).toBe('Oui.');
  });

  it('moves a dropped filler’s sentence end to the word before it', () => {
    expect(run(['I', 'think,', 'um.', 'Then'])).toBe('I think. Then');
  });

  it('capitalises the word after a filler that opened a sentence', () => {
    expect(run(['Um', 'so', 'my', 'name.'])).toBe('So my name.');
    expect(run(['Done.', 'Uh,', 'next', 'one.'])).toBe('Done. Next one.');
    expect(run(['and', 'um', 'then'])).toBe('and then');
  });

  it('keeps once a word said twice in a row, unless the first ends a sentence', () => {
    expect(run(['Yeah', 'yeah.'])).toBe('Yeah.');
    expect(run(['I', 'I', 'think', 'so.'])).toBe('I think so.');
    expect(run(['to', 'to', 'to', 'help.'])).toBe('to help.');
    expect(run(['Yeah.', 'Yeah.'])).toBe('Yeah. Yeah.');
  });

  it('keeps the doubles ordinary grammar has', () => {
    expect(run(['I', 'know', 'that', 'that', 'works.'])).toBe('I know that that works.');
    expect(run(['She', 'had', 'had', 'enough.'])).toBe('She had had enough.');
  });

  it('collapses only one speaker’s repeats, not an echo by the other', () => {
    const tokens = toTokens(
      [w('Yeah', 0), w('yeah', 1)],
      [seg(0, 0, 0.6), seg(1, 0.8, 1.6)],
      CLEAN,
    );
    expect(texts(tokens)).toBe('Yeah yeah');
  });

  it('keeps the first copy’s start and the last copy’s end', () => {
    const tokens = toTokens([w('Yeah', 1, 1.2), w('yeah.', 1.3, 1.6)], [seg(0, 0, 2)], CLEAN);
    expect(words(tokens)).toEqual([expect.objectContaining({ text: 'Yeah.', start: 1, end: 1.6 })]);
  });

  it('does nothing when it is off', () => {
    expect(run(['Um', 'yeah', 'yeah.'], RAW)).toBe('Um yeah yeah.');
  });
});
