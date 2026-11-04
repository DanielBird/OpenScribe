import { describe, expect, it } from 'vitest';
import {
  cleanTurnText,
  defaultSpeakerLabel,
  formatDate,
  formatDateTime,
  formatTimestamp,
  joinLines,
  languageName,
  languageOrUnknown,
  normalizeLanguage,
} from './transcript';

describe('formatDateTime', () => {
  it('formats in en-GB with a short time', () => {
    expect(formatDateTime('2026-10-13T12:05:00Z', { timeZone: 'UTC' })).toBe('13 Oct 2026, 12:05');
    expect(formatDateTime('2026-10-13T12:05:00Z', { timeZone: 'Europe/Copenhagen' })).toBe(
      '13 Oct 2026, 14:05',
    );
  });

  it('returns an invalid date unchanged', () => {
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});

describe('formatDate', () => {
  it('formats the date only, in en-GB', () => {
    const ms = Date.UTC(2026, 8, 14, 23, 30);
    expect(formatDate(ms, { timeZone: 'UTC' })).toBe('14 Sept 2026');
    expect(formatDate(ms, { timeZone: 'Europe/Copenhagen' })).toBe('15 Sept 2026');
  });

  it('gives an empty string for an invalid date', () => {
    expect(formatDate(Number.NaN)).toBe('');
  });
});

describe('formatTimestamp', () => {
  it.each([
    [0, '00:00:00'],
    [59.9, '00:00:59'],
    [60, '00:01:00'],
    [3599.99, '00:59:59'],
    [3600, '01:00:00'],
    [36000, '10:00:00'],
    [36061.5, '10:01:01'],
    [360000, '100:00:00'],
  ])('%s s → %s', (sec, expected) => {
    expect(formatTimestamp(sec)).toBe(expected);
  });

  it('clamps negative and non-finite input to zero', () => {
    expect(formatTimestamp(-5)).toBe('00:00:00');
    expect(formatTimestamp(Number.NaN)).toBe('00:00:00');
    expect(formatTimestamp(Number.POSITIVE_INFINITY)).toBe('00:00:00');
  });
});

describe('normalizeLanguage', () => {
  it.each([
    ['eng', 'en'],
    ['en', 'en'],
    ['EN', 'en'],
    ['en-GB', 'en'],
    ['deu', 'de'],
    ['ger', 'de'],
    ['de', 'de'],
    ['de_AT', 'de'],
    ['fra', 'fr'],
    ['fre', 'fr'],
    ['FR', 'fr'],
    [' fra ', 'fr'],
    ['SPA', 'es'],
    ['jpn', 'ja'],
    ['nor', 'no'],
    ['msa', 'ms'],
    ['zho', 'zh'],
    ['cmn', 'zh'],
    ['nl', 'nl'],
    ['yue', 'yue'],
  ])('%s → %s', (code, expected) => {
    expect(normalizeLanguage(code)).toBe(expected);
  });

  it('returns codes it does not know lower-cased, without a region', () => {
    expect(normalizeLanguage('ZZZ')).toBe('zzz');
    expect(normalizeLanguage('x_Y')).toBe('x');
    expect(normalizeLanguage('')).toBe('');
  });
});

describe('languageName', () => {
  it('names a language from any of its codes', () => {
    expect(languageName('eng')).toBe('English');
    expect(languageName('en-GB')).toBe('English');
    expect(languageName('deu')).toBe('German');
    expect(languageName('de')).toBe('German');
    expect(languageName('fra')).toBe('French');
    expect(languageName('spa')).toBe('Spanish');
    expect(languageName('jpn')).toBe('Japanese');
    expect(languageName('nor')).toBe('Norwegian');
    expect(languageName('nl')).toBe('Dutch');
  });

  it('falls back to the upper-cased code', () => {
    expect(languageName('zzz')).toBe('ZZZ');
    expect(languageName(' x ')).toBe('X');
    expect(languageName('')).toBe('');
  });
});

describe('languageOrUnknown', () => {
  it('names a language, or says it is not known', () => {
    expect(languageOrUnknown('deu')).toBe('German');
    expect(languageOrUnknown('zzz')).toBe('ZZZ');
    expect(languageOrUnknown('')).toBe('Unknown language');
    expect(languageOrUnknown('  ')).toBe('Unknown language');
  });
});

describe('defaultSpeakerLabel', () => {
  it('numbers speakers from 1', () => {
    expect(defaultSpeakerLabel(0)).toBe('Speaker 1');
    expect(defaultSpeakerLabel(31)).toBe('Speaker 32');
  });
});

describe('cleanTurnText', () => {
  it.each([
    ['a line break', 'one\ntwo', 'one two'],
    ['a Windows line break', 'one\r\ntwo', 'one two'],
    ['an old Mac line break', 'one\rtwo', 'one two'],
    ['several breaks in a row', 'one\n\n\r\ntwo', 'one two'],
    ['spaces around a break', 'one  \n  two', 'one two'],
    ['a line separator', 'one\u2028two', 'one two'],
    ['a paragraph separator', 'one\u2029two', 'one two'],
    ['leading and trailing whitespace', '  \n one two \t\n', 'one two'],
    ['inner double spaces', 'one  two', 'one  two'],
    ['whitespace only', ' \n\t\r\n ', ''],
  ])('handles %s', (_name, input, expected) => {
    expect(cleanTurnText(input)).toBe(expected);
  });
});

describe('joinLines', () => {
  it('joins lines like cleanTurnText, without trimming', () => {
    expect(joinLines(' and\nmore\n')).toBe(' and more ');
    expect(joinLines('no breaks  here ')).toBe('no breaks  here ');
  });
});
