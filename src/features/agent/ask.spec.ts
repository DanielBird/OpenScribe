import { describe, expect, it } from 'vitest';
import { hashText } from '../../domain/hash';
import type {
  AgentEvent,
  AgentProvider,
  AgentRunRequest,
  AgentRunResult,
} from '../../providers/llm/types';
import { createClaudeAgent } from '../../providers/llm/claudeAgent';
import {
  agentMessage,
  scriptedFetch,
  textBlock,
  thinkingBlock,
  toolUseBlock,
} from '../../testing/agent';
import { makeAgentCorpus } from '../../testing/agentCorpus';
import { askProject } from './ask';
import { AGENT_INSTRUCTIONS } from './instructions';
import { agentBudgetLimits, DEFAULT_AGENT_LIMITS } from './limits';
import { TOOL_BUDGET_REACHED } from './tools';

const corpus = makeAgentCorpus();
const CONTEXT = 'Sessions (3): …';

const ANSWER =
  'Mary charges them by the bed.\n<quote ref="s1/t2">I put them on the charger by the bed</quote>';

/** A provider that calls `list_themes` `calls` times, then answers. */
function fakeProvider(calls: number) {
  const requests: AgentRunRequest[] = [];
  const results: string[][] = [];
  const provider: AgentProvider = {
    model: 'fake',
    async run(req): Promise<AgentRunResult> {
      requests.push(req);
      const contents: string[] = [];
      const tool = req.tools.find((t) => t.name === 'list_themes')!;
      for (let i = 0; i < calls; i++) {
        const { content, activity } = await tool.run({}, req.signal);
        contents.push(content);
        req.onEvent({ type: 'tool', name: tool.name, activity, isError: false });
      }
      results.push(contents);
      req.onEvent({ type: 'text', delta: ANSWER });
      return {
        text: ANSWER,
        conversation: req.conversation ?? ({ model: 'fake' } as AgentRunResult['conversation']),
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
        stopped: 'done',
      };
    },
    resume: () => {
      throw new Error('not used here');
    },
  };
  return { provider, requests, results };
}

const ask = (provider: AgentProvider, events: AgentEvent[] = []) =>
  askProject({
    provider,
    corpus,
    context: CONTEXT,
    conversation: null,
    question: 'Who charges at night?',
    effort: 'medium',
    limits: DEFAULT_AGENT_LIMITS,
    signal: new AbortController().signal,
    onEvent: (e) => events.push(e),
  });

describe('askProject', () => {
  it('runs the provider with the instructions, the context, the tools and the question', async () => {
    const { provider, requests } = fakeProvider(1);
    const events: AgentEvent[] = [];
    const result = await ask(provider, events);

    expect(requests[0]).toMatchObject({
      instructions: AGENT_INSTRUCTIONS,
      context: CONTEXT,
      conversation: null,
      userMessage: 'Who charges at night?',
      maxIterations: DEFAULT_AGENT_LIMITS.maxIterations,
      effort: 'medium',
    });
    expect(requests[0]!.tools.map((t) => t.name)).toEqual([
      'search_transcripts',
      'get_summaries',
      'read_transcript',
      'list_themes',
    ]);
    expect(result.activity).toEqual(['Listed 2 themes']);
    expect(events.map((e) => e.type)).toEqual(['tool', 'text']);
    expect(result.blocks.map((b) => b.kind)).toEqual(['paragraph', 'quote']);
    expect(result.blocks[1]).toMatchObject({ check: { status: 'verified' } });
    expect(result.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
    });
  });

  it('runs with the effort and the budgets it is given (D48)', async () => {
    const { provider, requests, results } = fakeProvider(1);
    await askProject({
      provider,
      corpus,
      context: CONTEXT,
      conversation: null,
      question: 'Who charges at night?',
      effort: 'high',
      limits: agentBudgetLimits('low', 'high'),
      signal: new AbortController().signal,
      onEvent: () => {},
    });
    expect(requests[0]).toMatchObject({ effort: 'high', maxIterations: 20 });
    expect(results[0]![0]).toMatch(
      /Left for this question: 14 of 15 tool calls · reading budget 500k of 500k tokens · summary budget 150k of 150k tokens$/,
    );
  });

  it('gives each question a fresh tool budget', async () => {
    const { provider, results } = fakeProvider(DEFAULT_AGENT_LIMITS.toolCalls + 1);
    await ask(provider);
    await ask(provider);
    for (const contents of results) {
      expect(contents.filter((c) => c === TOOL_BUDGET_REACHED)).toHaveLength(1);
      expect(contents.at(-1)).toBe(TOOL_BUDGET_REACHED);
      // The budget note starts again too (D46).
      expect(contents[0]).toMatch(/\n\nLeft for this question: 29 of 30 tool calls · /);
    }
  });

  it('runs search → read → answer with Claude, and a follow-up extends the conversation', async () => {
    const { fetch, requests } = scriptedFetch([
      {
        message: agentMessage([
          thinkingBlock('sig-1'),
          toolUseBlock('tu_1', 'search_transcripts', { query: 'charg* night' }),
        ]),
      },
      {
        message: agentMessage([
          thinkingBlock('sig-2'),
          toolUseBlock('tu_2', 'read_transcript', {
            session: 's1',
            around: 't2',
            before: 0,
            after: 2,
          }),
        ]),
      },
      { message: agentMessage([thinkingBlock('sig-3'), textBlock(ANSWER)]) },
      { message: agentMessage([textBlock('Her husband reminds her.')]) },
    ]);
    const provider = createClaudeAgent({
      apiKey: 'test-key',
      model: 'claude-sonnet-5-5',
      fetch,
      maxRetries: 0,
    });
    const events: AgentEvent[] = [];
    const first = await ask(provider, events);

    expect(first.activity).toEqual([
      'Searched "charg* night" · no hits',
      'Read P01 – kitchen interview, Leeds 00:01:01–00:41:12',
    ]);
    expect(first.blocks[1]).toMatchObject({
      kind: 'quote',
      citation: { text: 'I put them on the charger by the bed', speakerLabel: 'Mary', start: 61 },
    });
    expect(first.stopped).toBe('done');
    const read = (requests[2]!.body.messages as { content: { content?: string }[] }[])[4]!;
    expect(read.content[0]!.content).toContain(
      't4 [00:41:12] Mary: Every night. My husband reminds me',
    );
    // The tool result, not the prefix, says what's left (D46).
    expect(read.content[0]!.content).toMatch(
      /\n\nLeft for this question: 28 of 30 tool calls · reading budget 249k of 250k tokens · summary budget 75k of 75k tokens$/,
    );

    const second = await askProject({
      provider,
      corpus,
      context: CONTEXT,
      conversation: first.conversation,
      question: 'Who helps?',
      effort: 'medium',
      limits: DEFAULT_AGENT_LIMITS,
      signal: new AbortController().signal,
      onEvent: () => {},
    });
    expect(second.text).toBe('Her husband reminds her.');
    expect(requests[3]!.body.messages).toHaveLength(7);
    expect(requests[3]!.body.system).toEqual(requests[0]!.body.system);
    expect(requests[3]!.body.tools).toEqual(requests[0]!.body.tools);
  });

  it('keeps the cached prefix byte for byte: the tool definitions and the instructions', async () => {
    const { fetch, requests } = scriptedFetch([{ message: agentMessage([textBlock(ANSWER)]) }]);
    const provider = createClaudeAgent({
      apiKey: 'test-key',
      model: 'claude-sonnet-5-5',
      fetch,
      maxRetries: 0,
    });
    await ask(provider);
    const { tools, system } = requests[0]!.body;
    // Every cached request starts with these bytes, so any change invalidates every cached prefix. Change the hash
    // only when the tools or the instructions are meant to change (AGENTIC_SEARCH.md, "Changing it").
    expect(hashText(JSON.stringify([tools, (system as unknown[])[0]]))).toBe('186b00b0a93588');
  });
});
