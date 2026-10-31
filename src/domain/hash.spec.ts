import { describe, expect, it } from 'vitest';
import { hashParts, hashText } from './hash';

describe('hashText', () => {
  it('is stable: the same text gives the same 14 hex digits', () => {
    expect(hashText('Hörgerät')).toBe(hashText('Hörgerät'));
    expect(hashText('Hörgerät')).toMatch(/^[0-9a-f]{14}$/);
    expect(hashText('')).toMatch(/^[0-9a-f]{14}$/);
  });

  it('changes with a one-character change', () => {
    const base = hashText('I put them on the charger by the bed.');
    expect(hashText('I put them on the charger by the bed!')).not.toBe(base);
    expect(hashText('i put them on the charger by the bed.')).not.toBe(base);
    expect(hashText('I put them on the charger by the bed. ')).not.toBe(base);
  });

  it('pins a known value, so the hash never changes between releases', () => {
    // Stored in summary files (transcriptHash, briefHash): a new algorithm would mark every summary out of date.
    expect(hashText('abc')).toBe('11f9f91ac18c8d');
    expect(hashText('')).toBe('0bdcb81aee8d83');
    expect(hashText('Hörgerät')).toBe('0b509a03af5b6e');
  });
});

describe('hashParts', () => {
  it('keeps the boundaries between parts', () => {
    expect(hashParts(['ab', 'c'])).not.toBe(hashParts(['a', 'bc']));
    expect(hashParts(['a', ''])).not.toBe(hashParts(['', 'a']));
  });

  it('depends on the order of the parts', () => {
    expect(hashParts(['a', 'b'])).not.toBe(hashParts(['b', 'a']));
  });

  it('is the hash of the parts joined with U+0000', () => {
    expect(hashParts(['a', 'b'])).toBe(hashText('a\u0000b'));
  });
});
