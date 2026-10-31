import { describe, expect, it } from 'vitest';
import {
  mergeTerms,
  normalizeTerm,
  parseTerms,
  termKey,
  validateList,
  validateTerm,
  type KeytermLimits,
} from './glossary';

// The ElevenLabs values (providers/transcription/elevenlabs/limits.ts).
const LIMITS: KeytermLimits = {
  maxTerms: 1000,
  maxChars: 49,
  maxWords: 5,
  forbiddenChars: '<>{}[]\\',
};

describe('parseTerms', () => {
  it.each([
    ['new lines', 'a\nb\r\nc\rd', ['a', 'b', 'c', 'd']],
    ['commas', 'a,b, c', ['a', 'b', 'c']],
    ['semicolons', 'a;b; c', ['a', 'b', 'c']],
    ['tabs', 'a\tb\t\tc', ['a', 'b', 'c']],
    ['mixed runs of separators', 'a,;\n\tb', ['a', 'b']],
  ])('splits on %s', (_name, raw, expected) => {
    expect(parseTerms(raw)).toEqual(expected);
  });

  it('trims pieces and collapses internal whitespace', () => {
    expect(parseTerms('  hearing    aid  \n Oticon  More ')).toEqual([
      'hearing aid',
      'Oticon More',
    ]);
  });

  it('drops empty pieces', () => {
    expect(parseTerms('\n\n , ; \t  ')).toEqual([]);
    expect(parseTerms('')).toEqual([]);
    expect(parseTerms('""')).toEqual([]);
  });

  it.each([
    ['"Oticon"', 'Oticon'],
    ["'Oticon'", 'Oticon'],
    ['“Oticon”', 'Oticon'],
    ['„Hörgerät“', 'Hörgerät'],
    ['‘Oticon’', 'Oticon'],
    ['« appareil auditif »', 'appareil auditif'],
    ['  " hearing aid "  ', 'hearing aid'],
  ])('strips surrounding quotes from %s', (raw, expected) => {
    expect(parseTerms(raw)).toEqual([expected]);
  });

  it('keeps quotes that do not surround the whole term', () => {
    expect(parseTerms(`Rock 'n' Roll\n'90s\n"Smart" Mic\n"`)).toEqual([
      "Rock 'n' Roll",
      "'90s",
      '"Smart" Mic',
      '"',
    ]);
  });

  it('strips only one pair of quotes', () => {
    expect(parseTerms(`"'Oticon'"`)).toEqual(["'Oticon'"]);
  });

  it('keeps umlauts and accents, normalised to NFC', () => {
    const decomposed = 'Hörgerät'; // o + combining diaeresis
    const [term] = parseTerms(`${decomposed}\nprothèse auditive\nÇa va`);
    expect(term).toBe('Hörgerät');
    expect(term).toHaveLength(8);
    expect(parseTerms('prothèse auditive; Ça va')).toEqual(['prothèse auditive', 'Ça va']);
  });
});

describe('normalizeTerm', () => {
  it('cleans a single typed value the same way as pasted pieces', () => {
    expect(normalizeTerm('  "Oticon   Intent"  ')).toBe('Oticon Intent');
    expect(normalizeTerm('   ')).toBe('');
  });

  it('does not split on separators', () => {
    expect(normalizeTerm('Smith, John')).toBe('Smith, John');
  });
});

describe('termKey', () => {
  it('ignores case and Unicode composition', () => {
    expect(termKey('HÖRGERÄT')).toBe(termKey('Hörgerät'));
    expect(termKey('Oticon')).toBe(termKey('oticon'));
    expect(termKey('Oticon')).not.toBe(termKey('Otikon'));
  });
});

describe('mergeTerms', () => {
  it('adds new terms after the existing ones, in order', () => {
    expect(mergeTerms(['a', 'b'], ['c', 'd'])).toEqual({
      terms: ['a', 'b', 'c', 'd'],
      added: 2,
      duplicates: 0,
    });
  });

  it('skips case-insensitive duplicates of existing terms and keeps the existing casing', () => {
    expect(mergeTerms(['Oticon'], ['OTICON', 'oticon', 'Philips'])).toEqual({
      terms: ['Oticon', 'Philips'],
      added: 1,
      duplicates: 2,
    });
  });

  it('skips duplicates within the incoming terms and keeps the first casing seen', () => {
    expect(mergeTerms([], ['Hörgerät', 'hörgerät', 'HÖRGERÄT'])).toEqual({
      terms: ['Hörgerät'],
      added: 1,
      duplicates: 2,
    });
  });

  it('treats composed and decomposed umlauts as the same term', () => {
    expect(mergeTerms(['Hörgerät'], ['Hörgerät']).duplicates).toBe(1);
  });

  it('drops duplicates already in the existing list without counting them', () => {
    expect(mergeTerms(['a', 'A'], [])).toEqual({ terms: ['a'], added: 0, duplicates: 0 });
  });

  it('handles the acceptance paste: 4 added, 1 duplicate', () => {
    const incoming = parseTerms('Oticon\nPhilips; hearing aid, Hörgerät\n\n oticon ');
    expect(mergeTerms([], incoming)).toEqual({
      terms: ['Oticon', 'Philips', 'hearing aid', 'Hörgerät'],
      added: 4,
      duplicates: 1,
    });
  });
});

describe('validateTerm', () => {
  it('accepts an ordinary term', () => {
    expect(validateTerm('Oticon Intent', LIMITS)).toEqual([]);
  });

  it('keeps 49 characters and rejects 50', () => {
    expect(validateTerm('a'.repeat(49), LIMITS)).toEqual([]);
    expect(validateTerm('a'.repeat(50), LIMITS)).toEqual(['too_long']);
  });

  it('counts characters as code points, so umlauts and emoji count once', () => {
    expect(validateTerm('ä'.repeat(49), LIMITS)).toEqual([]);
    expect(validateTerm('😀'.repeat(49), LIMITS)).toEqual([]);
    expect(validateTerm('😀'.repeat(50), LIMITS)).toEqual(['too_long']);
  });

  it('keeps 5 words and rejects 6', () => {
    expect(validateTerm('one two three four five', LIMITS)).toEqual([]);
    expect(validateTerm('one two three four five six', LIMITS)).toEqual(['too_many_words']);
  });

  it('counts hyphenated words as one word', () => {
    expect(validateTerm('in-the-ear behind-the-ear receiver-in-canal a b c', LIMITS)).toEqual([
      'too_many_words',
    ]);
    expect(validateTerm('in-the-ear behind-the-ear receiver-in-canal a b', LIMITS)).toEqual([]);
  });

  it.each([...'<>{}[]\\'])('rejects a term containing %s', (char) => {
    expect(validateTerm(`Foo ${char}bar`, LIMITS)).toEqual(['unsupported_chars']);
  });

  it.each([`O'Brien & Co. (DK)`, `50%/x: "y"?! – #1`, 'Smith, John; Jr.'])(
    'accepts other punctuation: %s',
    (term) => {
      expect(validateTerm(term, LIMITS)).toEqual([]);
    },
  );

  it('reports every issue a term has', () => {
    const term = `${'a'.repeat(10)} b c d e [f] ${'g'.repeat(40)}`;
    expect(validateTerm(term, LIMITS)).toEqual(['too_long', 'too_many_words', 'unsupported_chars']);
  });
});

describe('validateList', () => {
  it('separates valid and invalid terms, in order', () => {
    const result = validateList(['Oticon', 'Foo [bar]', 'a'.repeat(50), 'Philips'], LIMITS);
    expect(result).toEqual({
      valid: ['Oticon', 'Philips'],
      invalid: [
        { term: 'Foo [bar]', issues: ['unsupported_chars'] },
        { term: 'a'.repeat(50), issues: ['too_long'] },
      ],
      overLimit: [],
    });
  });

  it('puts valid terms beyond 1000 into overLimit', () => {
    const terms = Array.from({ length: 1003 }, (_, i) => `term ${i}`);
    const result = validateList(terms, LIMITS);
    expect(result.valid).toHaveLength(1000);
    expect(result.valid.at(-1)).toBe('term 999');
    expect(result.overLimit).toEqual(['term 1000', 'term 1001', 'term 1002']);
    expect(result.invalid).toEqual([]);
  });

  it('removes invalid terms before applying the 1000-term cap', () => {
    const terms = ['bad [1]', ...Array.from({ length: 1000 }, (_, i) => `term ${i}`), 'bad {2}'];
    const result = validateList(terms, LIMITS);
    expect(result.valid).toHaveLength(1000);
    expect(result.overLimit).toEqual([]);
    expect(result.invalid.map((i) => i.term)).toEqual(['bad [1]', 'bad {2}']);
  });

  it('handles an empty list', () => {
    expect(validateList([], LIMITS)).toEqual({ valid: [], invalid: [], overLimit: [] });
  });
});
