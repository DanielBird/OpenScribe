import { describe, expect, it } from 'vitest';
import type { SessionText } from '../../domain/corpus/sessionText';
import type { AgentTool } from '../../providers/llm/types';
import { makeAgentCorpus } from '../../testing/agentCorpus';
import { makeSessionText } from '../../testing/projectSessions';
import { createCorpusReader } from './corpus';
import { AGENT_LIMITS, agentBudgetLimits, DEFAULT_AGENT_LIMITS, estimateTokens } from './limits';
import {
  budgetNote,
  createAgentTools,
  createBudget,
  READING_BUDGET_REACHED,
  spentBudget,
  SUMMARY_BUDGET_REACHED,
  TOOL_BUDGET_REACHED,
  type AgentBudget,
} from './tools';

const signal = new AbortController().signal;

function tools(corpus = makeAgentCorpus(), budget: AgentBudget = createBudget()) {
  const list = createAgentTools(corpus, budget);
  const byName = (name: string) => list.find((t) => t.name === name) as AgentTool;
  /** Runs a tool with input checked by its schema, as the provider does: the result as the model gets it. */
  const run = (name: string, input: unknown) => {
    const tool = byName(name);
    return tool.run(tool.input.parse(input), signal);
  };
  /** `run`, with the budget note at the end checked and taken off, so a test compares the tool's own text (D46). */
  const call = async (name: string, input: unknown) => {
    const result = await run(name, input);
    if (result.content === TOOL_BUDGET_REACHED) return result;
    const note = `\n\n${budgetNote(budget)}`;
    expect(result.content.slice(-note.length)).toBe(note);
    return { ...result, content: result.content.slice(0, -note.length) };
  };
  return { list, run, call, budget };
}

const lastLine = (content: string) => content.split('\n').at(-1);

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

    it('gives whole summaries until the summary budget is reached, then names the rest (D45)', async () => {
      const s1 = (await tools().call('get_summaries', { sessions: ['s1'] })).content;
      const budget = createBudget();
      // Room for s1 exactly.
      budget.summaryTokens = DEFAULT_AGENT_LIMITS.summaryTokens - estimateTokens(s1);
      const { call } = tools(makeAgentCorpus(), budget);

      const partial = await call('get_summaries', { sessions: ['s1', 's2', 's3'] });
      expect(partial).toEqual({
        content: `${s1}\n\n${SUMMARY_BUDGET_REACHED} Not shown: s2, s3.`,
        activity: 'Read the summaries of P01 – kitchen interview, Leeds',
      });
      expect(budget.summaryTokens).toBe(DEFAULT_AGENT_LIMITS.summaryTokens);

      const refused = await call('get_summaries', { sessions: ['s2'] });
      expect(refused).toEqual({
        content: SUMMARY_BUDGET_REACHED,
        activity: 'Summary budget reached',
      });
    });

    it('keeps the summary budget apart from the reading budget', async () => {
      const { call, budget } = tools();
      await call('get_summaries', { sessions: ['s1', 's2'] });
      const summaryTokens = budget.summaryTokens;
      expect(summaryTokens).toBeGreaterThan(0);
      expect(budget.transcriptTokens).toBe(0);
      await call('read_transcript', { session: 's1' });
      expect(budget.transcriptTokens).toBeGreaterThan(0);
      expect(budget.summaryTokens).toBe(summaryTokens);

      const noReading = createBudget();
      noReading.transcriptTokens = DEFAULT_AGENT_LIMITS.transcriptTokens;
      const summaries = await tools(makeAgentCorpus(), noReading).call('get_summaries', {
        sessions: ['s1'],
      });
      expect(summaries.content).not.toContain(SUMMARY_BUDGET_REACHED);
    });

    it('refuses on a spent budget, as for /compact', async () => {
      const { call } = tools(makeAgentCorpus(), { ...spentBudget(), toolCalls: 0 });
      expect(await call('get_summaries', { sessions: ['s1'] })).toEqual({
        content: SUMMARY_BUDGET_REACHED,
        activity: 'Summary budget reached',
      });
      expect(await call('read_transcript', { session: 's1' })).toEqual({
        content: READING_BUDGET_REACHED,
        activity: 'Reading budget reached',
      });
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
        DEFAULT_AGENT_LIMITS.transcriptTokens - 3 * estimateTokens(line) - 1;
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
    for (let i = 0; i < DEFAULT_AGENT_LIMITS.toolCalls; i++) {
      expect((await call('list_themes', {})).content).not.toBe(TOOL_BUDGET_REACHED);
    }
    expect(await call('search_transcripts', { query: 'bed' })).toEqual({
      content: TOOL_BUDGET_REACHED,
      activity: 'Tool budget reached',
    });
    expect(budget.toolCalls).toBe(31);
  });

  describe('chosen budgets (D48)', () => {
    const low = agentBudgetLimits('low', 'low');

    it('stops at the chosen number of tool calls', async () => {
      const { call } = tools(makeAgentCorpus(), createBudget(low));
      for (let i = 0; i < low.toolCalls; i++) {
        expect((await call('list_themes', {})).content).not.toBe(TOOL_BUDGET_REACHED);
      }
      expect((await call('list_themes', {})).content).toBe(TOOL_BUDGET_REACHED);
    });

    it('stops reading and summaries at the chosen amounts', async () => {
      const reading = createBudget(low);
      reading.transcriptTokens = low.transcriptTokens;
      const read = await tools(makeAgentCorpus(), reading).run('read_transcript', {
        session: 's1',
      });
      expect(read.activity).toBe('Reading budget reached');

      const summaries = createBudget(low);
      summaries.summaryTokens = low.summaryTokens;
      const got = await tools(makeAgentCorpus(), summaries).run('get_summaries', {
        sessions: ['s1'],
      });
      expect(got.activity).toBe('Summary budget reached');
    });

    it('shows the chosen budgets in the note', () => {
      expect(budgetNote(createBudget(low))).toBe(
        'Left for this question: 15 of 15 tool calls · reading budget 125k of 125k tokens · summary budget 37k of 37k tokens',
      );
    });

    it('spends whichever budgets it is given', () => {
      expect(spentBudget(low)).toEqual({
        limits: low,
        toolCalls: 15,
        transcriptTokens: 125_000,
        summaryTokens: 37_500,
      });
    });
  });

  describe('budget note (D46)', () => {
    it("ends every result with what's left for the question, after a blank line", async () => {
      const result = await tools().run('list_themes', {});
      const lines = result.content.split('\n');
      expect(lines.at(-1)).toBe(
        'Left for this question: 29 of 30 tool calls · reading budget 250k of 250k tokens · summary budget 75k of 75k tokens',
      );
      expect(lines.at(-2)).toBe('');
      // The chat's activity list never shows it.
      expect(result.activity).toBe('Listed 2 themes');
    });

    it('counts down the reading budget for reads and the summary budget for summaries', async () => {
      const { run } = tools();
      expect(lastLine((await run('read_transcript', { session: 's1' })).content)).toBe(
        'Left for this question: 29 of 30 tool calls · reading budget 249k of 250k tokens · summary budget 75k of 75k tokens',
      );
      expect(lastLine((await run('get_summaries', { sessions: ['s1'] })).content)).toBe(
        'Left for this question: 28 of 30 tool calls · reading budget 249k of 250k tokens · summary budget 74k of 75k tokens',
      );
    });

    it('rounds tokens down to thousands, and never below 0', () => {
      expect(
        budgetNote({
          ...createBudget(),
          toolCalls: 3,
          transcriptTokens: 37_600,
          summaryTokens: 80_000,
        }),
      ).toBe(
        'Left for this question: 27 of 30 tool calls · reading budget 212k of 250k tokens · summary budget 0k of 75k tokens',
      );
    });

    it("gives every result of one reply what's left after all of them", async () => {
      const { run } = tools();
      const results = await Promise.all([
        run('list_themes', {}),
        run('search_transcripts', { query: 'charg*' }),
        run('get_summaries', { sessions: ['s1'] }),
      ]);
      const notes = new Set(results.map((r) => lastLine(r.content)));
      expect([...notes]).toEqual([
        'Left for this question: 27 of 30 tool calls · reading budget 250k of 250k tokens · summary budget 74k of 75k tokens',
      ]);
    });

    it('says to answer on the last call, and nothing more after it', async () => {
      const { run } = tools(makeAgentCorpus(), { ...createBudget(), toolCalls: 29 });
      expect(lastLine((await run('list_themes', {})).content)).toBe(
        'Left for this question: 0 of 30 tool calls. Answer now.',
      );
      expect(await run('list_themes', {})).toEqual({
        content: TOOL_BUDGET_REACHED,
        activity: 'Tool budget reached',
      });
    });

    it('leaves it off a call that fails, which still counts', async () => {
      const { run, budget } = tools();
      await expect(run('read_transcript', { session: 's9' })).rejects.toThrow(
        /^Unknown session s9\. Use the keys from the session list\.$/,
      );
      expect(budget.toolCalls).toBe(1);
      expect(lastLine((await run('list_themes', {})).content)).toMatch(
        /^Left for this question: 28 of 30 tool calls · /,
      );
    });
  });
});
