import { describe, expect, it } from 'vitest';
import { parseQuery, type Query } from '../../domain/corpus/query';
import { agentSessions, agentSummaries } from '../../testing/agentCorpus';
import { makeAgentCorpus } from '../../testing/agentCorpus';
import { createCorpusReader } from './corpus';

describe('createCorpusReader', () => {
  it('keys the sessions by recording date and titles them from their summary or recording', () => {
    const corpus = makeAgentCorpus();
    expect(corpus.sessions.map((s) => [s.key, s.title, s.summary !== null])).toEqual([
      ['s1', 'P01 – kitchen interview, Leeds', true],
      ['s2', 'P02 – home visit, Hamburg', true],
      ['s3', 'P03 interview.m4a', false],
    ]);
    const [, , english] = agentSessions();
    expect(corpus.byKey(' S1 ')?.text.sessionId).toBe(english!.sessionId);
    expect(corpus.byId(english!.sessionId)?.key).toBe('s1');
    expect(corpus.byKey('s4')).toBeUndefined();
  });

  it("keeps a saved chat's keys, in key order", () => {
    const sessions = agentSessions();
    const [german, , english] = sessions;
    const corpus = createCorpusReader(sessions, agentSummaries(sessions), {
      [german!.sessionId]: 's1',
      [english!.sessionId]: 's4',
    });
    expect(corpus.sessions.map((s) => [s.key, s.text.sessionId])).toEqual([
      ['s1', german!.sessionId],
      ['s4', english!.sessionId],
      ['s5', sessions[1]!.sessionId],
    ]);
    expect(corpus.byKey('s4')?.text.sessionId).toBe(english!.sessionId);
  });

  it('searches the prepared sessions', () => {
    const result = makeAgentCorpus().search(parseQuery('charger') as Query, {
      field: 'english',
      maxHitsPerSession: 5,
    });
    expect(result.totalHits).toBe(2);
  });
});
