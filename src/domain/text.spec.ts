import { describe, expect, it } from 'vitest';
import { oneLine, plural } from './text';

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'hit')).toBe('1 hit');
    expect(plural(1, 'summary', 'summaries')).toBe('1 summary');
  });

  it('adds an s by default, for zero and for more than one', () => {
    expect(plural(0, 'hit')).toBe('0 hits');
    expect(plural(3, 'session')).toBe('3 sessions');
  });

  it('uses the given plural', () => {
    expect(plural(2, 'summary', 'summaries')).toBe('2 summaries');
    expect(plural(0, 'conflict copy', 'conflict copies')).toBe('0 conflict copies');
  });
});

describe('oneLine', () => {
  it('makes each run of whitespace one space, line breaks included', () => {
    expect(oneLine('P02 –\nhome  visit\t\tLyon')).toBe('P02 – home visit Lyon');
    expect(oneLine('first\r\n\r\nsecond third')).toBe('first second third');
  });

  it('trims the ends', () => {
    expect(oneLine('  \n Anna \n')).toBe('Anna');
    expect(oneLine(' \n\t ')).toBe('');
  });

  it('leaves text that is already on one line unchanged', () => {
    expect(oneLine('I just put them on the charger.')).toBe('I just put them on the charger.');
  });
});
