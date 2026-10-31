import { describe, expect, it } from 'vitest';
import type { Turn } from '../../domain/transcript';
import { makeBatches } from './batching';

const turn = (n: number, text = `Turn ${n}.`): Turn => ({
  id: `t${n}`,
  speakerId: `speaker_${n % 2}`,
  start: n,
  end: n + 1,
  text,
  words: [],
});
const turns = (count: number, text?: string) =>
  Array.from({ length: count }, (_, i) => turn(i + 1, text));
const ids = (list: readonly Turn[]) => list.map((t) => t.id);

describe('makeBatches', () => {
  it('returns no batches for no turns', () => {
    expect(makeBatches([])).toEqual([]);
  });

  it('keeps a short transcript in one batch with no context', () => {
    const batches = makeBatches(turns(5));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ index: 0, context: [] });
    expect(ids(batches[0]!.turns)).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });

  it('starts a new batch after maxTurns turns, in order', () => {
    const batches = makeBatches(turns(130));
    expect(batches.map((b) => b.turns.length)).toEqual([60, 60, 10]);
    expect(batches.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(batches.flatMap((b) => ids(b.turns))).toEqual(ids(turns(130)));
  });

  it('starts a new batch before maxChars would be exceeded', () => {
    const batches = makeBatches(turns(5, 'x'.repeat(40)), { maxChars: 100 });
    expect(batches.map((b) => ids(b.turns))).toEqual([['t1', 't2'], ['t3', 't4'], ['t5']]);
  });

  it('gives a turn longer than maxChars a batch of its own', () => {
    const list = [turn(1, 'short'), turn(2, 'y'.repeat(150)), turn(3, 'short')];
    const batches = makeBatches(list, { maxChars: 100 });
    expect(batches.map((b) => ids(b.turns))).toEqual([['t1'], ['t2'], ['t3']]);
  });

  it('carries the previous contextTurns turns as context', () => {
    const batches = makeBatches(turns(10), { maxTurns: 4, contextTurns: 3 });
    expect(batches.map((b) => ids(b.context))).toEqual([
      [],
      ['t2', 't3', 't4'],
      ['t6', 't7', 't8'],
    ]);
  });

  it('gives fewer context turns when fewer come before', () => {
    const batches = makeBatches(turns(3), { maxTurns: 1, contextTurns: 3 });
    expect(batches.map((b) => ids(b.context))).toEqual([[], ['t1'], ['t1', 't2']]);
  });

  it('can carry no context', () => {
    const batches = makeBatches(turns(4), { maxTurns: 2, contextTurns: 0 });
    expect(batches.map((b) => b.context)).toEqual([[], []]);
  });
});
