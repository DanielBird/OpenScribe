import { describe, expect, it } from 'vitest';
import type { SessionText } from '../../domain/corpus/sessionText';
import type { AgentTool } from '../../providers/llm/types';
import { makeAgentCorpus } from '../../testing/agentCorpus';
import { makeSessionText } from '../../testing/projectSessions';
import { createCorpusReader } from './corpus';
import { AGENT_LIMITS, estimateTokens } from './limits';
import {
  createAgentTools,
  createBudget,
  READING_BUDGET_REACHED,
  TOOL_BUDGET_REACHED,
  type AgentBudget,
} from './tools';

const signal = new AbortController().signal;

function tools(corpus = makeAgentCorpus(), budget: AgentBudget = createBudget()) {
  const list = createAgentTools(corpus, budget);
  const byName = (name: string) => list.find((t) => t.name === name) as AgentTool;
  /** Runs a tool with input checked by its schema, as the provider does. */
  const call = (name: string, input: unknown) => {
    const tool = byName(name);
    return tool.run(tool.input.parse(input), signal);
  };
  return { list, call, budget };
}

/** A session of `count` English turns, each `words` words long. */
function longSession(n: number, count: number, words = 20): SessionText {
  return makeSessionText(n, {
    turns: Array.from({ length: count }, (_, i) => ({
      id: `t${i + 1}`,
      speakerId: i % 2 ? 'speaker_1' : 'speaker_0',
      start: i * 30,
      text: `Turn ${i + 1} ${'about charging '.repeat(words / 2).trim()}.`,
      en: null,
    })),
  });
}

describe('createAgentTools', () => {
  it('gives the four tools in a fixed order', () => {
    expect(tools().list.map((t) => t.name)).toEqual([
      'search_transcripts',
      'get_summaries',
      'read_transcript',
      'list_themes',
    ]);
  });

  describe('search_transcripts', () => {
    it('groups hits by session with refs, times, speakers and snippets', async () => {
      const result = await tools().call('search_transcripts', { query: 'charg*' });
      expect(result.activity).toBe('Searched "charg*" · 4 hits in 2 sessions');
      // Equal hit counts: the newer session first.
      expect(result.content).toBe(
        [
          '4 hits in 2 sessions · page 1 of 1',
          '',
          's2 · P02 – home visit, Hamburg · 2 hits',
          's2/t1 [00:00:05] Interviewer: When do you charge them?',
          's2/t2 [00:00:40] Anna: In the evening I put them on the charger.',
          '',
          's1 · P01 – kitchen interview, Leeds · 2 hits',
          's1/t1 [00:00:03] Interviewer: How do you charge them?',
          's1/t2 [00:01:01] Mary: I put them on the charger by the bed, like my phone.',
        ].join('\n'),
      );
    });

    it('searches the original text, and marks those hits', async () => {
      const result = await tools().call('search_transcripts', {
        query: 'chargeur OR Ladegerat',
        in: 'original',
      });
      expect(result.activity).toBe(
        'Searched "chargeur OR Ladegerat" (original) · 2 hits in 2 sessions',
      );
      expect(result.content).toContain(
        's3/t2 [00:00:30] Anna (original): La nuit, sur le chargeur.',
      );
      expect(result.content).toContain(
        's2/t2 [00:00:40] Anna (original): Abends lege ich sie auf das Ladegerät.',
      );
    });

    it('searches only the given sessions', async () => {
      const result = await tools().call('search_transcripts', {
        query: 'charger',
        sessions: ['S2'],
      });
      expect(result.content).toContain('1 hit in 1 session');
      expect(result.content).not.toContain('s1/');
    });

    it('says when nothing is found', async () => {
      const result = await tools().call('search_transcripts', { query: 'umbrella' });
      expect(result).toEqual({
        content: 'No hits for "umbrella".',
        activity: 'Searched "umbrella" · no hits',
      });
    });

    it('shows at most 5 hits per session and 12 sessions per page', async () => {
      const sessions = Array.from({ length: 14 }, (_, i) => longSession(i + 1, 8));
      const { call } = tools(createCorpusReader(sessions, new Map()));
      const first = await call('search_transcripts', { query: 'charging' });
      expect(first.content.split('\n')[0]).toBe('112 hits in 14 sessions · page 1 of 2');
      expect(first.content).toContain('8 hits, first 5 shown');
      expect(first.content.match(/^s\d+\/t\d+ /gm)).toHaveLength(AGENT_LIMITS.hitsPerCall);
      const second = await call('search_transcripts', { query: 'charging', page: 2 });
      expect(second.content.match(/^s\d+ · /gm)).toHaveLength(2);
      const third = await call('search_transcripts', { query: 'charging', page: 3 });
      expect(third.content).toContain('No more sessions after page 2.');
    });

    it('reports query errors and unknown sessions as errors to fix', async () => {
      const { call } = tools();
      await expect(call('search_transcripts', { query: '"charger' })).rejects.toThrow(
        'Query error: Close the quotation marks.',
      );
      await expect(call('search_transcripts', { query: 'bed', sessions: ['s9'] })).rejects.toThrow(
        'Unknown session s9. Use the keys from the session list.',
      );
    });
  });

  describe('get_summaries', () => {
    it('gives each summary as compact text with refs, and says when there is none', async () => {
      const result = await tools().call('get_summaries', { sessions: ['s1', 's3'] });
      expect(result.activity).toBe(
        'Read the summaries of P01 – kitchen interview, Leeds, P03 interview.m4a',
      );
      const [first, second] = result.content.split('\n\n');
      expect(first).toContain('s1 · P01 – kitchen interview, Leeds · English');
      expect(first).toContain('Synopsis: Mary charges her hearing aids every night by the bed.');
      expect(first).toContain('- Mary (Age: 71; Hearing aids used: 2 years)');
      expect(first).toContain(
        [
          '- charging routines: How charging fits the day. (s1/t2, s1/t4)',
          '  - s1/t2 "I put them on the charger by the bed, like my phone."',
          '  - s1/t4 "Every night. My husband reminds me when I forget."',
          '- partner support: Who helps. (s1/t4)',
        ].join('\n'),
      );
      expect(second).toBe(
        's3 · P03 interview.m4a · French, not translated yet\nNo summary yet. Search or read its transcript instead.',
      );
    });

    it('takes at most 10 sessions and only known keys', async () => {
      const { call } = tools();
      const many = Array.from({ length: 11 }, (_, i) => `s${i + 1}`);
      await expect(call('get_summaries', { sessions: many })).rejects.toThrow(
        'At most 10 sessions per call.',
      );
      await expect(call('get_summaries', { sessions: ['s7'] })).rejects.toThrow(
        'Unknown session s7.',
      );
    });
  });

  describe('read_transcript', () => {
    it('reads around a turn in English', async () => {
      const result = await tools().call('read_transcript', {
        session: 's1',
        around: 't2',
        before: 0,
        after: 1,
      });
      expect(result.content).toBe(
        [
          's1 · P01 – kitchen interview, Leeds · turns t2–t3 of 4 · English',
          't2 [00:01:01] Mary: I put them on the charger by the bed, like my phone.',
          't3 [00:01:35] Interviewer: Every night?',
        ].join('\n'),
      );
      expect(result.activity).toBe('Read P01 – kitchen interview, Leeds 00:01:01–00:01:35');
    });

    it('reads 8 turns either side by default, a from–to range, or the whole session', async () => {
      const { call } = tools(createCorpusReader([longSession(1, 30)], new Map()));
      const around = await call('read_transcript', { session: 's1', around: 't15' });
      expect(around.content.split('\n')[0]).toContain('turns t7–t23 of 30');
      const range = await call('read_transcript', { session: 's1', from: 't3', to: 't5' });
      expect(range.content.split('\n')).toHaveLength(4);
      const whole = await call('read_transcript', { session: 's1' });
      expect(whole.content.split('\n')[0]).toContain('turns t1–t30 of 30');
    });

    it('reads the translation, or the original on request', async () => {
      const { call } = tools();
      const english = await call('read_transcript', { session: 's2', from: 't2', to: 't2' });
      expect(english.content).toBe(
        's2 · P02 – home visit, Hamburg · turns t2–t2 of 2 · English\n' +
          't2 [00:00:40] Anna: In the evening I put them on the charger.',
      );
      const original = await call('read_transcript', {
        session: 's2',
        from: 't2',
        to: 't2',
        original: true,
      });
      expect(original.content).toContain(
        '· German (original)\nt2 [00:00:40] Anna: Abends lege ich sie auf das Ladegerät.',
      );
      expect(original.activity).toBe('Read P02 – home visit, Hamburg 00:00:40–00:00:40 (original)');
    });

    it('names a language that is not known as such, here and in the summaries', async () => {
      const session = makeSessionText(1, {
        languageCode: '',
        turns: [{ id: 't1', speakerId: 'speaker_0', start: 5, text: 'Wann?', en: 'When?' }],
      });
      const { call } = tools(createCorpusReader([session], new Map()));
      const original = await call('read_transcript', { session: 's1', original: true });
      expect(original.content.split('\n')[0]).toBe(
        's1 · P01 interview.m4a · turns t1–t1 of 1 · Unknown language (original)',
      );
      const summaries = await call('get_summaries', { sessions: ['s1'] });
      expect(summaries.content.split('\n')[0]).toBe(
        's1 · P01 interview.m4a · Unknown language, translated',
      );
    });

    it("says when a session isn't translated yet", async () => {
      const result = await tools().call('read_transcript', { session: 's3' });
      expect(result.content.split('\n')[0]).toBe(
        "s3 · P03 interview.m4a · turns t1–t2 of 2 · French, not translated yet: the original text, which can't be quoted",
      );
      expect(result.content).toContain('t2 [00:00:30] Anna: La nuit, sur le chargeur.');
    });

    it('marks the turns changed since the translation, which have no English (D39)', async () => {
      const session = makeSessionText(1, {
        languageCode: 'deu',
        turns: [
          { id: 't1', speakerId: 'speaker_0', start: 5, text: 'Wann?', en: 'When?' },
          { id: 't2', speakerId: 'speaker_1', start: 40, text: 'Abends, korrigiert.', en: null },
        ],
      });
      const { call } = tools(createCorpusReader([session], new Map()));
      const result = await call('read_transcript', { session: 's1' });
      const [header, ...lines] = result.content.split('\n');
      expect(header).toMatch(
        /· English, except turns marked \(original\): changed since the translation, so they can't be quoted$/,
      );
      expect(lines[0]).toMatch(/^t1 \[00:00:05\] [^(]+: When\?$/);
      expect(lines[1]).toMatch(/^t2 \[00:00:40\] .+ \(original\): Abends, korrigiert\.$/);

      const first = await call('read_transcript', { session: 's1', from: 't1', to: 't1' });
      expect(first.content.split('\n')[0]).toMatch(/· English$/);
    });

    it('reports unknown sessions and turns', async () => {
      const { call } = tools();
      await expect(call('read_transcript', { session: 's9' })).rejects.toThrow(
        'Unknown session s9.',
      );
      await expect(call('read_transcript', { session: 's1', around: 't99' })).rejects.toThrow(
        'Session s1 has no turn t99. Its turns are t1–t4.',
      );
    });

    it('reads as much as fits the reading budget, then refuses', async () => {
      const session = longSession(1, 40);
      const line = `t1 [00:00:00] Interviewer: ${session.turns[0]!.text}`;
      const budget = createBudget();
      // Room for 3 more lines of about this size.
      budget.transcriptTokens =
        AGENT_LIMITS.transcriptTokensPerQuestion - 3 * estimateTokens(line) - 1;
      const { call } = tools(createCorpusReader([session], new Map()), budget);

      const partial = await call('read_transcript', { session: 's1' });
      const lines = partial.content.split('\n');
      expect(lines[0]).toContain('turns t1–t3 of 40');
      expect(lines.at(-1)).toBe(READING_BUDGET_REACHED);
      expect(lines).toHaveLength(5);

      const refused = await call('read_transcript', { session: 's1', around: 't20' });
      expect(refused).toEqual({
        content: READING_BUDGET_REACHED,
        activity: 'Reading budget reached',
      });
    });
  });

  describe('list_themes', () => {
    it('lists every theme with its sessions, merging spellings', async () => {
      const result = await tools().call('list_themes', {});
      expect(result).toEqual({
        content: [
          '2 themes in 2 summaries, most used first',
          'charging routines (2): s1, s2',
          'partner support (1): s1',
        ].join('\n'),
        activity: 'Listed 2 themes',
      });
    });

    it('says when there are no summaries yet', async () => {
      const { call } = tools(createCorpusReader([makeSessionText(1)], new Map()));
      expect((await call('list_themes', {})).content).toBe(
        'No session has a summary yet, so there are no themes.',
      );
    });
  });

  it('answers every call after the 30th with the tool budget message', async () => {
    const { call, budget } = tools();
    for (let i = 0; i < AGENT_LIMITS.toolCallsPerQuestion; i++) {
      expect((await call('list_themes', {})).content).not.toBe(TOOL_BUDGET_REACHED);
    }
    expect(await call('search_transcripts', { query: 'bed' })).toEqual({
      content: TOOL_BUDGET_REACHED,
      activity: 'Tool budget reached',
    });
    expect(budget.toolCalls).toBe(31);
  });
});
