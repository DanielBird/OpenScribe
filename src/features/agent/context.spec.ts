import { describe, expect, it } from 'vitest';
import { EMPTY_BRIEF } from '../../domain/project';
import { agentSessions, agentSummaries, makeAgentCorpus } from '../../testing/agentCorpus';
import { renderContext } from './context';
import { createCorpusReader } from './corpus';

const BRIEF = {
  researchQuestions: ['How do people fit charging into their day?'],
  context: 'Home visits in three countries.',
  metadataFields: ['Age'],
};

describe('renderContext', () => {
  it('renders the brief and one card per session, in key order', () => {
    expect(renderContext('Hearing at home 2026', BRIEF, makeAgentCorpus())).toBe(
      [
        'Project: Hearing at home 2026',
        'Research questions:',
        '1. How do people fit charging into their day?',
        'Context: Home visits in three countries.',
        'Metadata fields: Age',
        '',
        'Sessions (3): key · date · length · language · title',
        's1 · 2026-09-01 · 1:02 · English · P01 – kitchen interview, Leeds',
        '  Respondents: Mary (Age: 71; Hearing aids used: 2 years)',
        '  Themes: charging routines; partner support',
        '  Synopsis: Mary charges her hearing aids every night by the bed.',
        's2 · 2026-09-02 · 2:03 · German, translated · P02 – home visit, Hamburg',
        '  Respondents: Anna (Country: Germany)',
        '  Themes: Charging routines',
        '  Synopsis: A short session about charging hearing aids at home.',
        's3 · 2026-09-03 · ? · French, not translated yet · P03 interview.m4a (no summary yet)',
      ].join('\n'),
    );
  });

  it('leaves out an empty project name and brief', () => {
    const context = renderContext('  ', EMPTY_BRIEF, makeAgentCorpus());
    expect(context.split('\n')[0]).toBe('Sessions (3): key · date · length · language · title');
  });

  it('is byte-for-byte the same for the same input, whatever order the sessions come in', () => {
    const sessions = agentSessions();
    const summaries = agentSummaries(sessions);
    const a = renderContext('P', BRIEF, createCorpusReader(sessions, summaries));
    const b = renderContext('P', BRIEF, createCorpusReader([...sessions].reverse(), summaries));
    expect(b).toBe(a);
    expect(renderContext('P', BRIEF, createCorpusReader(sessions, summaries))).toBe(a);
  });
});
