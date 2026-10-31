import { describe, expect, it } from 'vitest';
import { findActiveTurnIndex } from './playback';

// Turns at 2, 5 and 9 s; the gap between 5 and 9 belongs to the second turn.
const TURNS = [{ start: 2 }, { start: 5 }, { start: 9 }];

describe('findActiveTurnIndex', () => {
  it.each([
    [0, -1],
    [1.999, -1],
    [2, 0],
    [4.999, 0],
    [5, 1],
    [7, 1],
    [8.999, 1],
    [9, 2],
    [600, 2],
  ])('t = %s → %s', (t, expected) => {
    expect(findActiveTurnIndex(TURNS, t)).toBe(expected);
  });

  it('a single turn is active from its start onwards', () => {
    expect(findActiveTurnIndex([{ start: 3 }], 2.9)).toBe(-1);
    expect(findActiveTurnIndex([{ start: 3 }], 3)).toBe(0);
    expect(findActiveTurnIndex([{ start: 3 }], 1e6)).toBe(0);
  });

  it('a turn at 0 is active from the start', () => {
    expect(findActiveTurnIndex([{ start: 0 }, { start: 3 }], 0)).toBe(0);
  });

  it('an empty list has no active turn', () => {
    expect(findActiveTurnIndex([], 5)).toBe(-1);
  });

  it('NaN has no active turn', () => {
    expect(findActiveTurnIndex(TURNS, Number.NaN)).toBe(-1);
  });

  it('finds the right turn in a long list', () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({ start: i * 3 }));
    expect(findActiveTurnIndex(many, 3 * 1234 + 1)).toBe(1234);
    expect(findActiveTurnIndex(many, 3 * 2000)).toBe(2000);
  });
});
