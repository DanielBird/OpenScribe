import { describe, expect, it } from 'vitest';
import { briefHash, cleanLines, EMPTY_BRIEF, type ProjectBrief } from './project';

const BRIEF: ProjectBrief = {
  researchQuestions: ['How do people fit charging into their day?', 'Who helps them?'],
  context: 'Home visits in Germany and France.',
  metadataFields: ['Age', 'Country'],
};

describe('briefHash', () => {
  it('is stable for the same brief', () => {
    expect(briefHash({ ...BRIEF })).toBe(briefHash(BRIEF));
    expect(briefHash(EMPTY_BRIEF)).toMatch(/^[0-9a-f]{14}$/);
  });

  it('changes with every field', () => {
    const base = briefHash(BRIEF);
    expect(
      briefHash({ ...BRIEF, researchQuestions: ['How do people fit charging into their day?'] }),
    ).not.toBe(base);
    expect(briefHash({ ...BRIEF, context: 'Home visits in Germany.' })).not.toBe(base);
    expect(briefHash({ ...BRIEF, metadataFields: ['Age'] })).not.toBe(base);
  });

  it('changes when the research questions are reordered', () => {
    const reordered = { ...BRIEF, researchQuestions: [...BRIEF.researchQuestions].reverse() };
    expect(briefHash(reordered)).not.toBe(briefHash(BRIEF));
  });

  it('keeps a research question apart from a metadata field', () => {
    const asQuestion = { ...EMPTY_BRIEF, researchQuestions: ['Age'] };
    const asField = { ...EMPTY_BRIEF, metadataFields: ['Age'] };
    expect(briefHash(asQuestion)).not.toBe(briefHash(asField));
    expect(briefHash(asQuestion)).not.toBe(briefHash({ ...EMPTY_BRIEF, context: 'Age' }));
  });
});

describe('cleanLines', () => {
  it('trims each line and drops empty ones, keeping the order', () => {
    expect(cleanLines(['  How do people charge? ', '', '   ', 'Who helps?'])).toEqual([
      'How do people charge?',
      'Who helps?',
    ]);
  });
});
