import { describe, expect, it } from 'vitest';
import { matchString, normalizeForMatch, wordsWithOffsets } from './normalize';

const words = (text: string) => wordsWithOffsets(text).map((w) => w.word);

describe('normalizeForMatch', () => {
  it.each([
    ['accents', 'Hörgerät Café naïve', 'horgerat cafe naive'],
    ['decomposed accents', 'Ho\u0308rgera\u0308t', 'horgerat'],
    ['ß and ẞ', 'Straße STRAẞE', 'strasse strasse'],
    [
      'typographic quotes',
      '“Yes,” she said, ‘it’s fine’ «oui» „ja“',
      `"yes," she said, 'it's fine' "oui" "ja"`,
    ],
    ['dashes', 'well – maybe — no −1 follow‑up', 'well - maybe - no -1 follow-up'],
    ['compatibility forms', 'ﬁne ½ ²', 'fine 1⁄2 2'],
    ['whitespace', '  a \n\t b\u00a0c  ', 'a b c'],
    ['ASCII', '  The CHARGER  by the bed. ', 'the charger by the bed.'],
  ])('%s', (_name, input, expected) => {
    expect(normalizeForMatch(input)).toBe(expected);
  });

  it('keeps letters that NFKD does not decompose', () => {
    expect(normalizeForMatch('København Æble Łódź')).toBe('københavn æble łodz');
  });
});

describe('wordsWithOffsets', () => {
  it('finds normalised words and ignores punctuation', () => {
    expect(words('Hörgerät, HORGERAT and hörgerät!')).toEqual([
      'horgerat',
      'horgerat',
      'and',
      'horgerat',
    ]);
    expect(words('...!? — ')).toEqual([]);
    expect(words('')).toEqual([]);
  });

  it('splits words at apostrophes and hyphens', () => {
    expect(words("doctor's")).toEqual(['doctor', 's']);
    expect(words('l’appareil')).toEqual(['l', 'appareil']);
    expect(words("aujourd'hui")).toEqual(['aujourd', 'hui']);
    expect(words('e-mail')).toEqual(['e', 'mail']);
    expect(words('10,000 or 3.5')).toEqual(['10', '000', 'or', '3', '5']);
  });

  it('gives offsets into the original text', () => {
    const text = '“Das Hörgerät,” sagte sie.';
    const found = wordsWithOffsets(text);
    expect(found.map((w) => text.slice(w.start, w.end))).toEqual([
      'Das',
      'Hörgerät',
      'sagte',
      'sie',
    ]);
  });

  it('keeps original offsets after an NFKD expansion', () => {
    const text = 'Die ﬁne Straße';
    const found = wordsWithOffsets(text);
    expect(found.map((w) => w.word)).toEqual(['die', 'fine', 'strasse']);
    expect(found.map((w) => text.slice(w.start, w.end))).toEqual(['Die', 'ﬁne', 'Straße']);
  });

  it('gives each piece of a word that NFKD splits the offsets of the whole word', () => {
    expect(wordsWithOffsets('½ Stunde')).toEqual([
      { word: '1', start: 0, end: 1 },
      { word: '2', start: 0, end: 1 },
      { word: 'stunde', start: 2, end: 8 },
    ]);
  });

  it('keeps decomposed text in one word', () => {
    const text = 'Ho\u0308rgera\u0308t';
    expect(wordsWithOffsets(text)).toEqual([{ word: 'horgerat', start: 0, end: text.length }]);
  });
});

describe('matchString', () => {
  it('joins the words with single spaces, with a space at each end', () => {
    expect(matchString('I put them on the Charger.')).toBe(' i put them on the charger ');
    expect(matchString('Das Hörgerät – nachts.')).toBe(' das horgerat nachts ');
  });

  it('is a single space for text without words', () => {
    expect(matchString('')).toBe(' ');
    expect(matchString('!!! …')).toBe(' ');
  });

  it.each([
    'Plain ASCII, with punctuation; and 42 numbers.',
    "Don't stop: it's the doctor's e-mail",
    'Le chargeur près du lit, aujourd’hui.',
    'Das Hörgerät ½ Stunde lang — Straße',
    'Ho\u0308rgera\u0308t',
  ])('agrees with wordsWithOffsets: %s', (text) => {
    expect(matchString(text)).toBe(` ${words(text).join(' ')} `.replace(/^ {2}$/, ' '));
  });
});
