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

  it.each([
    ['Vietnamese', 'người', 'nguoi'],
    ['Greek', 'Ἄνθρωπος', 'ανθρωπος'],
    ['Cyrillic', 'Йогурт', 'иогурт'],
    ['Arabic vowel points', 'العَرَبِيَّة', 'العربية'],
    ['Hebrew points', 'שָׁלוֹם', 'שלום'],
    ['Japanese voicing marks', 'ベッド', 'ヘット'],
  ])('removes accents: %s', (_name, input, expected) => {
    expect(normalizeForMatch(input)).toBe(expected);
  });

  it.each([
    ['Thai', 'ฉัน'],
    ['Hindi', 'हिंदी'],
    ['Kannada', 'ಕನ್ನಡ'],
    ['Malayalam', 'മലയാളം'],
  ])('keeps the vowel signs that spell a word: %s', (_name, word) => {
    expect(normalizeForMatch(word)).toBe(word.normalize('NFKD'));
    expect(wordsWithOffsets(word)).toEqual([
      { word: word.normalize('NFKD'), start: 0, end: word.length },
    ]);
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

  it('segments scripts written without spaces into words, with their own offsets', () => {
    const japanese = '\u300c\u6bce\u6669\u3001\u5145\u96fb\u3057\u307e\u3059\u3002\u300d';
    const found = wordsWithOffsets(japanese);
    expect(found.map((w) => japanese.slice(w.start, w.end))).toEqual([
      '\u6bce\u6669',
      '\u5145\u96fb',
      '\u3057',
      '\u307e\u3059',
    ]);
    expect(found.map((w) => w.word)).toEqual([
      '\u6bce\u6669',
      '\u5145\u96fb',
      '\u3057',
      '\u307e\u3059',
    ]);

    const thai =
      '\u0e09\u0e31\u0e19\u0e0a\u0e32\u0e23\u0e4c\u0e08\u0e21\u0e31\u0e19\u0e02\u0e49\u0e32\u0e07\u0e40\u0e15\u0e35\u0e22\u0e07';
    expect(words(thai)).toEqual([
      '\u0e09\u0e31\u0e19',
      '\u0e0a\u0e32\u0e23\u0e4c\u0e08',
      '\u0e21\u0e31\u0e19',
      '\u0e02\u0e49\u0e32\u0e07',
      '\u0e40\u0e15\u0e35\u0e22\u0e07',
    ]);
  });

  it('segments a run that mixes scripts, and leaves spaced scripts alone', () => {
    expect(words('Oticon\u306e\u5145\u96fb\u5668')).toEqual([
      'oticon',
      '\u306e',
      '\u5145\u96fb\u5668',
    ]);
    expect(
      words(
        '\u0417\u0430\u0440\u044f\u0434\u043a\u0430 \u0443 \u043a\u0440\u043e\u0432\u0430\u0442\u0438',
      ),
    ).toEqual([
      '\u0437\u0430\u0440\u044f\u0434\u043a\u0430',
      '\u0443',
      '\u043a\u0440\u043e\u0432\u0430\u0442\u0438',
    ]);
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
