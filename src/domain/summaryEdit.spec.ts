import { describe, expect, it } from 'vitest';
import { NOT_DISCUSSED, type SessionSummary } from './summary';
import {
  addAttribute,
  addQuote,
  addTheme,
  blockText,
  cleanBlockText,
  joinParagraphs,
  leaveBlock,
  overviewParagraphs,
  removeAttribute,
  removeQuote,
  removeTheme,
  setBlockText,
  setOverviewParagraphs,
  splitParagraph,
  splitPastedParagraphs,
  tidySummary,
} from './summaryEdit';

const known = (name: string) => ['charging', 'cost'].includes(name.trim().toLowerCase());

function makeSummary(): SessionSummary {
  return {
    title: 'P07 – home visit',
    synopsis: 'Anna charges at night.',
    overview: 'First paragraph.\n\nSecond paragraph.',
    respondents: [
      {
        speakerId: 'A',
        label: 'Anna',
        attributes: [{ field: 'Age', value: '67', turnIds: ['t1'] }],
      },
    ],
    researchQuestions: [
      {
        question: 'How do people charge?',
        finding: 'By the bed.',
        turnIds: ['t2'],
        quotes: [{ turnId: 't2', text: 'by the bed' }],
      },
    ],
    themes: [
      { name: 'Charging', description: 'At night.', turnIds: ['t2'], isNew: false, quotes: [] },
      { name: 'Cost', description: 'Too dear.', turnIds: ['t3'], isNew: false, quotes: [] },
    ],
  };
}

describe('setBlockText', () => {
  it('returns the same summary when the text is unchanged', () => {
    const s = makeSummary();
    expect(setBlockText(s, { kind: 'title' }, s.title, known)).toBe(s);
    expect(setBlockText(s, { kind: 'themeName', index: 9 }, 'x', known)).toBe(s);
  });

  it('changes one block and keeps the other entries’ identity', () => {
    const s = makeSummary();
    const next = setBlockText(s, { kind: 'themeDescription', index: 1 }, 'Far too dear.', known);
    expect(next.themes[1]?.description).toBe('Far too dear.');
    expect(next.themes[0]).toBe(s.themes[0]);
    expect(next.researchQuestions).toBe(s.researchQuestions);
    expect(next.themes[1]?.turnIds).toBe(s.themes[1]?.turnIds);
  });

  it('sets every kind of block', () => {
    let s = makeSummary();
    s = setBlockText(s, { kind: 'synopsis' }, 'New.', known);
    s = setBlockText(s, { kind: 'respondent', index: 0 }, 'Anna B.', known);
    s = setBlockText(s, { kind: 'field', respondent: 0, index: 0 }, 'Years', known);
    s = setBlockText(s, { kind: 'value', respondent: 0, index: 0 }, '68', known);
    s = setBlockText(s, { kind: 'finding', index: 0 }, 'On the bedside table.', known);
    expect(s.synopsis).toBe('New.');
    expect(s.respondents[0]).toMatchObject({ label: 'Anna B.', speakerId: 'A' });
    expect(s.respondents[0]?.attributes[0]).toEqual({
      field: 'Years',
      value: '68',
      turnIds: ['t1'],
    });
    expect(s.researchQuestions[0]).toMatchObject({
      question: 'How do people charge?',
      finding: 'On the bedside table.',
      turnIds: ['t2'],
    });
  });

  it('makes line breaks spaces, and doesn’t trim while typing', () => {
    const s = setBlockText(makeSummary(), { kind: 'title' }, 'Two\r\nlines ', known);
    expect(s.title).toBe('Two lines ');
  });

  it('marks a renamed theme new unless the other sessions use its name', () => {
    const s = makeSummary();
    expect(
      setBlockText(s, { kind: 'themeName', index: 0 }, 'Routines', known).themes[0]?.isNew,
    ).toBe(true);
    expect(setBlockText(s, { kind: 'themeName', index: 0 }, 'COST', known).themes[0]?.isNew).toBe(
      false,
    );
  });

  it('keeps fields this build doesn’t know', () => {
    const s = { ...makeSummary(), extra: 1 } as SessionSummary;
    expect(setBlockText(s, { kind: 'title' }, 'New', known)).toHaveProperty('extra', 1);
  });
});

describe('leaveBlock', () => {
  it('trims', () => {
    const s = setBlockText(makeSummary(), { kind: 'synopsis' }, '  Padded  ', known);
    expect(leaveBlock(s, { kind: 'synopsis' }, '', known).synopsis).toBe('Padded');
  });

  it('gives an empty title back its text', () => {
    const s = setBlockText(makeSummary(), { kind: 'title' }, ' ', known);
    expect(leaveBlock(s, { kind: 'title' }, 'P07 – home visit', known).title).toBe(
      'P07 – home visit',
    );
  });

  it('makes an empty finding "not discussed", and keeps its quotes', () => {
    const s = setBlockText(makeSummary(), { kind: 'finding', index: 0 }, '', known);
    const next = leaveBlock(s, { kind: 'finding', index: 0 }, 'By the bed.', known);
    expect(next.researchQuestions[0]?.finding).toBe(NOT_DISCUSSED);
    expect(next.researchQuestions[0]?.quotes).toHaveLength(1);
  });

  it('gives an empty theme name back its text while the theme has a description', () => {
    const s = setBlockText(makeSummary(), { kind: 'themeName', index: 1 }, '', known);
    const next = leaveBlock(s, { kind: 'themeName', index: 1 }, 'Cost', known);
    expect(next.themes[1]).toMatchObject({ name: 'Cost', isNew: false });
    const bare = setBlockText(
      setBlockText(makeSummary(), { kind: 'themeDescription', index: 1 }, '', known),
      { kind: 'themeName', index: 1 },
      '',
      known,
    );
    expect(leaveBlock(bare, { kind: 'themeName', index: 1 }, 'Cost', known).themes[1]?.name).toBe(
      '',
    );
  });

  it('allows an empty synopsis', () => {
    const s = setBlockText(makeSummary(), { kind: 'synopsis' }, '', known);
    expect(leaveBlock(s, { kind: 'synopsis' }, 'Anna charges at night.', known).synopsis).toBe('');
  });
});

describe('the overview', () => {
  it('reads and writes paragraphs, leaving empty ones out', () => {
    const s = makeSummary();
    expect(overviewParagraphs(s.overview)).toEqual(['First paragraph.', 'Second paragraph.']);
    expect(setOverviewParagraphs(s, ['First paragraph.', 'Second paragraph.'])).toBe(s);
    expect(setOverviewParagraphs(s, ['One', ' ', 'Two\nlines']).overview).toBe('One\n\nTwo lines');
  });

  it('splits a paragraph at the caret', () => {
    expect(splitParagraph(['Hello world. Bye.'], 0, 12)).toEqual({
      paragraphs: ['Hello world.', 'Bye.'],
      caret: { index: 1, offset: 0 },
    });
    expect(splitParagraph(['End.'], 0, 4).paragraphs).toEqual(['End.', '']);
  });

  it('joins a paragraph to the one above, with the caret at the join', () => {
    expect(joinParagraphs(['One.', 'Two.'], 1)).toEqual({
      paragraphs: ['One. Two.'],
      caret: { index: 0, offset: 5 },
    });
    expect(joinParagraphs(['One.', ''], 1)).toEqual({
      paragraphs: ['One.'],
      caret: { index: 0, offset: 4 },
    });
    expect(joinParagraphs(['One.'], 0)).toBeNull();
  });

  it('splits pasted text at blank lines', () => {
    expect(splitPastedParagraphs('A line\nwrapped.\n\n\nNext one.\r\n\r\n')).toEqual([
      'A line wrapped.',
      'Next one.',
    ]);
    expect(cleanBlockText('a\n\nb')).toBe('a b');
  });
});

describe('themes, details and quotes', () => {
  it('adds and removes themes', () => {
    const s = makeSummary();
    const added = addTheme(s, 0);
    expect(added.themes.map((t) => t.name)).toEqual(['Charging', '', 'Cost']);
    expect(added.themes[1]).toEqual({
      name: '',
      description: '',
      turnIds: [],
      isNew: true,
      quotes: [],
    });
    expect(addTheme(s, -1).themes[0]?.name).toBe('');
    expect(removeTheme(s, 0).themes.map((t) => t.name)).toEqual(['Cost']);
    expect(removeTheme(s, 5)).toBe(s);
  });

  it('adds and removes detail rows', () => {
    const s = makeSummary();
    const added = addAttribute(s, 0, 0);
    expect(added.respondents[0]?.attributes[1]).toEqual({ field: '', value: '', turnIds: [] });
    expect(removeAttribute(added, 0, 1).respondents[0]?.attributes).toHaveLength(1);
    expect(addAttribute(s, 3, 0)).toBe(s);
  });

  it('adds and removes quotes without changing turnIds', () => {
    const s = makeSummary();
    const added = addQuote(s, { kind: 'theme', index: 1 }, { turnId: 't9', text: 'too dear' });
    expect(added.themes[1]?.quotes).toEqual([{ turnId: 't9', text: 'too dear' }]);
    expect(added.themes[1]?.turnIds).toEqual(['t3']);
    const removed = removeQuote(s, { kind: 'question', index: 0 }, 0);
    expect(removed.researchQuestions[0]?.quotes).toEqual([]);
    expect(removed.researchQuestions[0]?.turnIds).toEqual(['t2']);
    expect(removeQuote(s, { kind: 'question', index: 0 }, 4)).toBe(s);
  });

  it('reads a block’s text', () => {
    const s = makeSummary();
    expect(blockText(s, { kind: 'value', respondent: 0, index: 0 })).toBe('67');
    expect(blockText(s, { kind: 'finding', index: 3 })).toBeNull();
  });
});

describe('tidySummary', () => {
  it('removes empty themes and detail rows, and trims the title and synopsis', () => {
    let s = addAttribute(addTheme(makeSummary(), 1), 0, 0);
    s = setBlockText(s, { kind: 'title' }, ' Title ', known);
    const tidy = tidySummary(s);
    expect(tidy.themes).toHaveLength(2);
    expect(tidy.respondents[0]?.attributes).toHaveLength(1);
    expect(tidy.title).toBe('Title');
  });

  it('returns the same summary when there is nothing to tidy', () => {
    const s = makeSummary();
    expect(tidySummary(s)).toBe(s);
  });
});
