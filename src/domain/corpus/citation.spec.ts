import { describe, expect, it } from 'vitest';
import { formatCitation, formatCitations, type CitationParts } from './citation';

const QUOTE: CitationParts = {
  text: 'I just put them on the charger by the bed.',
  speakerLabel: 'Anna (P02)',
  start: 2472.6,
  sessionTitle: 'P02 – home visit, Lyon',
  translatedFrom: null,
};

describe('formatCitation', () => {
  it('gives the quote, speaker, time and session', () => {
    expect(formatCitation(QUOTE)).toBe(
      '"I just put them on the charger by the bed." — Anna (P02), 00:41:12, P02 – home visit, Lyon',
    );
  });

  it('says when the text is a translation, naming the original language', () => {
    expect(formatCitation({ ...QUOTE, translatedFrom: 'fra' })).toBe(
      '"I just put them on the charger by the bed." — Anna (P02), 00:41:12, P02 – home visit, Lyon ' +
        '(translated from French)',
    );
    expect(formatCitation({ ...QUOTE, translatedFrom: 'de' })).toMatch(
      /\(translated from German\)$/,
    );
  });

  it('keeps a quote on one line', () => {
    const citation = formatCitation({
      ...QUOTE,
      text: ' Charger\nby the bed. ',
      speakerLabel: 'Anna\n',
      sessionTitle: 'P02\r\nLyon',
    });
    expect(citation).toBe('"Charger by the bed." — Anna, 00:41:12, P02 Lyon');
  });
});

describe('formatCitations', () => {
  it('separates quotes with a blank line', () => {
    const second = { ...QUOTE, text: 'Every night.', start: 65, translatedFrom: 'fr' };
    expect(formatCitations([QUOTE, second])).toBe(
      `${formatCitation(QUOTE)}\n\n"Every night." — Anna (P02), 00:01:05, P02 – home visit, Lyon (translated from French)`,
    );
  });

  it('gives an empty string for no quotes', () => {
    expect(formatCitations([])).toBe('');
  });
});
