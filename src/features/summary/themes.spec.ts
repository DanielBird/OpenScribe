import { describe, expect, it } from 'vitest';
import type { SessionSummary, SummaryTheme } from '../../domain/summary';
import { themeVocabulary } from './themes';

const theme = (name: string): SummaryTheme => ({
  name,
  description: '',
  turnIds: [],
  isNew: false,
  quotes: [],
});

const summary = (...names: string[]): SessionSummary => ({
  title: '',
  synopsis: '',
  overview: '',
  respondents: [],
  researchQuestions: [],
  themes: names.map(theme),
});

describe('themeVocabulary', () => {
  it('is empty for no summaries', () => {
    expect(themeVocabulary([])).toEqual([]);
  });

  it('counts the summaries that use each theme', () => {
    expect(
      themeVocabulary([summary('stigma', 'charging routines'), summary('charging routines')]),
    ).toEqual([
      { name: 'charging routines', count: 2 },
      { name: 'stigma', count: 1 },
    ]);
  });

  it('merges names that differ only in case or spacing, under the most common spelling', () => {
    const vocabulary = themeVocabulary([
      summary('Charging routines'),
      summary('charging  routines '),
      summary('charging routines'),
      summary('stigma', 'STIGMA'),
    ]);
    expect(vocabulary).toEqual([
      { name: 'charging routines', count: 3 },
      { name: 'stigma', count: 1 }, // one summary, even with two spellings
    ]);
  });

  it('takes the first spelling seen on a tie', () => {
    expect(themeVocabulary([summary('Stigma'), summary('stigma')])).toEqual([
      { name: 'Stigma', count: 2 },
    ]);
  });

  it('sorts by count, then by name', () => {
    const vocabulary = themeVocabulary([
      summary('cost', 'battery life', 'appearance'),
      summary('cost'),
    ]);
    expect(vocabulary.map((t) => t.name)).toEqual(['cost', 'appearance', 'battery life']);
  });

  it('ignores blank names', () => {
    expect(themeVocabulary([summary('  ', 'cost')])).toEqual([{ name: 'cost', count: 1 }]);
  });
});
