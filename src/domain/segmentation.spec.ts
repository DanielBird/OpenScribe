import { describe, expect, it } from 'vitest';
import { buildTurns } from './segmentation';
import type { NormalizedToken } from './tokens';

type Kind = NormalizedToken['kind'];

function tok(
  text: string,
  start: number | null,
  end: number | null,
  speakerId: string | null = 'speaker_0',
  kind: Kind = 'word',
): NormalizedToken {
  return { text, start, end, speakerId, kind, logprob: kind === 'spacing' ? 0 : -0.1 };
}
const sp = (start: number | null, end: number | null, speakerId: string | null = 'speaker_0') =>
  tok(' ', start, end, speakerId, 'spacing');

/** One word per second: word i spans [i, i + 0.9], separated by spacing tokens. */
function wordsPerSecond(texts: string[], speakerId = 'speaker_0'): NormalizedToken[] {
  return texts.flatMap((text, i) => {
    const word = tok(text, i, i + 0.9, speakerId);
    return i < texts.length - 1 ? [word, sp(i + 0.9, i + 1, speakerId)] : [word];
  });
}

describe('buildTurns', () => {
  it('returns nothing for empty input', () => {
    expect(buildTurns([])).toEqual({ speakers: [], turns: [] });
  });

  it('starts a new turn when the speaker changes', () => {
    const { turns } = buildTurns([
      tok('Hello', 0, 0.5, 'speaker_0'),
      sp(0.5, 0.6),
      tok('there.', 0.6, 1, 'speaker_0'),
      sp(1, 1.5),
      tok('Hi!', 1.5, 1.8, 'speaker_1'),
    ]);
    expect(turns.map((t) => [t.id, t.speakerId, t.text, t.start, t.end])).toEqual([
      ['t1', 'speaker_0', 'Hello there.', 0, 1],
      ['t2', 'speaker_1', 'Hi!', 1.5, 1.8],
    ]);
  });

  it('never lets spacing tokens start a turn, end a turn or change the speaker', () => {
    const { turns } = buildTurns([
      sp(0, 0.2, 'speaker_3'), // leading spacing with another speaker id
      tok('One', 0.2, 0.5),
      sp(0.5, 0.6, 'speaker_1'), // spacing labelled with another speaker inside a turn
      tok('two.', 0.6, 0.9),
      sp(0.9, 2), // trailing spacing before a speaker change
      tok('Three.', 2, 2.4, 'speaker_1'),
      sp(2.4, 3, 'speaker_1'), // trailing spacing at the very end
    ]);
    expect(turns.map((t) => [t.speakerId, t.text, t.start, t.end])).toEqual([
      ['speaker_0', 'One two.', 0.2, 0.9],
      ['speaker_1', 'Three.', 2, 2.4],
    ]);
  });

  it('joins token texts exactly, then trims', () => {
    const { turns } = buildTurns([
      tok(' Well,', 0, 0.3),
      tok(' ', 0.3, 0.4, 'speaker_0', 'spacing'),
      tok('ok…', 0.4, 0.7),
    ]);
    expect(turns[0]?.text).toBe('Well, ok…');
  });

  it('keeps only word and event tokens in turn.words, with their times', () => {
    const { turns } = buildTurns([
      tok('Yes', 0, 0.4),
      sp(0.4, 0.5),
      tok('(laughs)', 0.5, 1.2, 'speaker_0', 'event'),
    ]);
    expect(turns[0]?.text).toBe('Yes (laughs)');
    expect(turns[0]?.words).toEqual([
      { text: 'Yes', start: 0, end: 0.4, logprob: -0.1 },
      { text: '(laughs)', start: 0.5, end: 1.2, logprob: -0.1 },
    ]);
  });

  it('treats events like words for speaker changes', () => {
    const { turns } = buildTurns([
      tok('Funny.', 0, 0.5, 'speaker_0'),
      tok('(laughter)', 0.5, 1, 'speaker_1', 'event'),
    ]);
    expect(turns.map((t) => t.speakerId)).toEqual(['speaker_0', 'speaker_1']);
  });

  it('drops turns that contain only whitespace and keeps ids consecutive', () => {
    const { turns, speakers } = buildTurns([
      tok('First.', 0, 0.5, 'speaker_0'),
      tok(' ', 0.5, 0.6, 'speaker_1'), // a "word" with no text
      tok('Second.', 0.6, 1, 'speaker_0'),
    ]);
    expect(turns.map((t) => [t.id, t.text])).toEqual([
      ['t1', 'First.'],
      ['t2', 'Second.'],
    ]);
    expect(speakers.map((s) => s.id)).toEqual(['speaker_0']);
  });

  it('lists speakers in order of first appearance with default labels', () => {
    const { speakers } = buildTurns([
      tok('A', 0, 1, 'speaker_5'),
      tok('B', 1, 2, 'speaker_0'),
      tok('C', 2, 3, 'speaker_5'),
      tok('D', 3, 4, 'speaker_2'),
    ]);
    expect(speakers).toEqual([
      { id: 'speaker_5', label: 'Speaker 1' },
      { id: 'speaker_0', label: 'Speaker 2' },
      { id: 'speaker_2', label: 'Speaker 3' },
    ]);
  });

  it('maps a missing speaker id to speaker_0', () => {
    const { turns, speakers } = buildTurns([tok('Anyone?', 0, 1, null)]);
    expect(turns[0]?.speakerId).toBe('speaker_0');
    expect(speakers).toEqual([{ id: 'speaker_0', label: 'Speaker 1' }]);
  });

  describe('missing timestamps', () => {
    it("takes the previous token's end, or the next timed start when there is no previous token", () => {
      const { turns } = buildTurns([
        tok('First', null, null), // nothing before it: next timed start (1.0)
        sp(1, 1.2),
        tok('middle', null, null), // previous end: 1.2
        sp(null, null), // previous end: 1.2
        tok('late', null, 2.5), // start from previous end (1.2), own end kept
        sp(2.5, 2.6),
        tok('last.', 2.6, null), // end falls back to its start
      ]);
      expect(turns[0]?.words.map((w) => [w.text, w.start, w.end])).toEqual([
        ['First', 1, 1],
        ['middle', 1.2, 1.2],
        ['late', 1.2, 2.5],
        ['last.', 2.6, 2.6],
      ]);
      expect([turns[0]?.start, turns[0]?.end]).toEqual([1, 2.6]);
    });

    it('uses 0 when no token has a time at all', () => {
      const { turns } = buildTurns([
        tok('Untimed', null, null),
        sp(null, null),
        tok('words', null, null),
      ]);
      expect(turns[0]).toMatchObject({ text: 'Untimed words', start: 0, end: 0 });
    });

    it('never produces an end before the start', () => {
      const { turns } = buildTurns([tok('Odd', 5, 4)]);
      expect([turns[0]?.start, turns[0]?.end]).toEqual([5, 5]);
    });
  });

  describe('long turns', () => {
    const opts = { softMaxTurnSec: 3, hardMaxTurnSec: 5 };

    it('splits after the first sentence end once the soft limit has passed', () => {
      // Elapsed time at each word end: 0.9, 1.9, 2.9, 3.9, 4.9 …
      const tokens = wordsPerSecond(['One', 'two.', 'three', 'four.', 'five', 'six.']);
      const { turns } = buildTurns(tokens, opts);
      // "two." ends at 1.9 s (not past 3 s): no split. "four." ends at 3.9 s: split after it.
      expect(turns.map((t) => [t.id, t.speakerId, t.text, t.start, t.end])).toEqual([
        ['t1', 'speaker_0', 'One two. three four.', 0, 3.9],
        ['t2', 'speaker_0', 'five six.', 4, 5.9],
      ]);
    });

    it('splits after the next word once the hard limit has passed without a sentence end', () => {
      const tokens = wordsPerSecond(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
      const { turns } = buildTurns(tokens, opts);
      // "f" ends at 5.9 s, the first word past 5 s.
      expect(turns.map((t) => [t.text, t.start, t.end])).toEqual([
        ['a b c d e f', 0, 5.9],
        ['g h i', 6, 8.9],
      ]);
    });

    it('recognises sentence ends followed by closing quotes or brackets', () => {
      const tokens = wordsPerSecond(['He', 'said', 'no', 'way!"', 'Then', 'left.)', 'ok']);
      // 'way!"' ends 3.9 s into turn 1; 'left.)' ends 1.9 s into turn 2. Both are past 1.5 s.
      const { turns } = buildTurns(tokens, { softMaxTurnSec: 1.5, hardMaxTurnSec: 100 });
      expect(turns.map((t) => t.text)).toEqual(['He said no way!"', 'Then left.)', 'ok']);
    });

    it('applies the default 90 s / 120 s limits', () => {
      const texts = Array.from({ length: 140 }, (_, i) => (i === 95 ? 'end.' : `w${i}`));
      const { turns } = buildTurns(wordsPerSecond(texts));
      // Word 95 ends at 95.9 s (past 90 s, sentence end): split. The next turn starts at 96 s and has no
      // sentence end, so it runs until the hard limit is passed or the words run out (139.9 s < 216 s).
      expect(turns.map((t) => [t.start, t.end])).toEqual([
        [0, 95.9],
        [96, 139.9],
      ]);
    });
  });
});
