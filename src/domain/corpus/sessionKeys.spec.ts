import { describe, expect, it } from 'vitest';
import { assignSessionKeys, parseRef } from './sessionKeys';
import type { SessionText } from './sessionText';

function session(sessionId: string, recordedAt: number): SessionText {
  return {
    sessionId,
    recordingName: `${sessionId}.m4a`,
    recordedAt,
    durationSec: null,
    languageCode: 'eng',
    speakers: [],
    turns: [],
    transcriptHash: '0',
  };
}

describe('assignSessionKeys', () => {
  const sessions = [session('c', 300), session('b', 100), session('a', 200), session('a2', 100)];

  it('numbers sessions by recording date, then by id', () => {
    expect([...assignSessionKeys(sessions)]).toEqual([
      ['a2', 's1'],
      ['b', 's2'],
      ['a', 's3'],
      ['c', 's4'],
    ]);
  });

  it('is stable whatever the input order', () => {
    expect(assignSessionKeys([...sessions].reverse())).toEqual(assignSessionKeys(sessions));
  });

  it('gives an empty map for no sessions', () => {
    expect(assignSessionKeys([]).size).toBe(0);
  });

  describe('with fixed keys (a saved chat)', () => {
    it('keeps them, and numbers new sessions after the highest one', () => {
      // 'gone' was s5 when the chat was saved: its key isn't given to anyone else.
      const fixed = { c: 's1', a: 's3', gone: 's5' };
      expect([...assignSessionKeys(sessions, fixed)]).toEqual([
        ['c', 's1'],
        ['a', 's3'],
        ['a2', 's6'],
        ['b', 's7'],
      ]);
    });

    it('is the plain numbering when every session has its usual key', () => {
      const fixed = Object.fromEntries(assignSessionKeys(sessions));
      expect(assignSessionKeys(sessions, fixed)).toEqual(assignSessionKeys(sessions));
    });

    it('ignores keys that are malformed or taken twice (the older recording keeps it)', () => {
      expect([...assignSessionKeys(sessions, { c: 's2', a: 's2', b: 'x9', a2: 's0' })]).toEqual([
        ['a', 's2'],
        ['a2', 's3'],
        ['b', 's4'],
        ['c', 's5'],
      ]);
    });
  });
});

describe('parseRef', () => {
  it('splits a ref into its session key and turn id', () => {
    expect(parseRef('s12/t412')).toEqual({ sessionKey: 's12', turnId: 't412' });
    expect(parseRef(' s1/t1 ')).toEqual({ sessionKey: 's1', turnId: 't1' });
  });

  it.each([
    '',
    's12',
    's12/',
    '/t412',
    's12/412',
    '12/t412',
    's12-t412',
    'S12/T412',
    's12/t412/x',
    'sx/t1',
  ])('returns null for %j', (ref) => {
    expect(parseRef(ref)).toBeNull();
  });
});
