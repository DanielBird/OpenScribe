import { describe, expect, it, vi } from 'vitest';
import { z } from '../../lib/zod';
import { ProviderError } from '../errors';
import {
  createConversations,
  runAgentLoop,
  type AgentAdapter,
  type AgentAttempt,
  type AgentOutput,
  type ConversationRegistry,
  type ToolOutcome,
} from './agentLoop';
import type { AgentEvent, AgentRunRequest, AgentTool, AgentUsage } from './types';

// The loop with a scripted adapter: request n runs step n, which streams through `output` and returns the attempt.

type Turn = { role: 'user' | 'model' | 'results'; text?: string; outcomes?: ToolOutcome[] };
type Call = { name: string; input: unknown };
type Step = (output: AgentOutput) => AgentAttempt<Turn, Call> | Promise<AgentAttempt<Turn, Call>>;

const usage = (n: number): AgentUsage => ({
  inputTokens: n,
  outputTokens: 2 * n,
  cacheReadTokens: 3 * n,
  cacheWriteTokens: 4 * n,
});

/** A reply that streams `text` in one piece. */
const reply =
  (text: string, next: 'tools' | 'again' | 'done' | 'limit', calls: Call[] = []): Step =>
  (output) => {
    output.text(text);
    output.usage(usage(1));
    return { turn: { role: 'model', text }, text, calls, next };
  };

function scripted(steps: Step[], registry = createConversations<Turn>('fakeAgent')) {
  const sent: Turn[][] = [];
  const toError = vi.fn((err: unknown) =>
    err instanceof ProviderError ? err : new ProviderError('unknown', 'Something went wrong.'),
  );
  const adapter: AgentAdapter<Turn, Call, ToolOutcome> = {
    model: 'fake-model',
    conversations: registry,
    resends: 2,
    messages: { aborted: 'Stopped.', badOutput: 'Bad output.' },
    userTurn: (text) => ({ role: 'user', text }),
    async send(conversation, output) {
      sent.push([...conversation]);
      const step = steps[sent.length - 1];
      if (!step) throw new Error(`no step for request ${sent.length}`);
      return step(output);
    },
    callOf: (call) => call,
    result: (_call, outcome) => outcome,
    resultsTurn: (outcomes) => ({ role: 'results', outcomes }),
    toError,
  };
  return { adapter, sent, toError, registry };
}

function request(overrides: Partial<AgentRunRequest> = {}) {
  const events: AgentEvent[] = [];
  const req: AgentRunRequest = {
    instructions: 'Instructions.',
    context: 'Context.',
    tools: [],
    conversation: null,
    userMessage: 'What did Anna say?',
    maxIterations: 10,
    effort: 'medium',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    ...overrides,
  };
  return { req, events };
}

const texts = (events: readonly AgentEvent[]) =>
  events.flatMap((e) =>
    e.type === 'text' ? [e.delta] : e.type === 'retry' ? [`<retry ${e.discard}>`] : [],
  );

const searchTool = (
  run: AgentTool['run'] = async () => ({ content: 'two hits', activity: 'Searched' }),
) =>
  ({
    name: 'search',
    description: 'Search.',
    input: z.object({ query: z.string() }),
    run,
  }) as AgentTool;

describe('runAgentLoop', () => {
  it("streams each reply's text, with a blank line before each reply's text but the first", async () => {
    const { adapter } = scripted([
      reply('Looking.', 'tools', [{ name: 'search', input: { query: 'charger' } }]),
      reply('Found it.', 'done'),
    ]);
    const { req, events } = request({ tools: [searchTool()] });

    const result = await runAgentLoop(req, adapter);

    expect(texts(events)).toEqual(['Looking.', '\n\n', 'Found it.']);
    expect(result).toMatchObject({ text: 'Looking.\n\nFound it.', stopped: 'done' });
  });

  it('ignores an empty piece of text, so the blank line waits for real text', async () => {
    const { adapter } = scripted([
      reply('Looking.', 'tools', [{ name: 'search', input: { query: 'charger' } }]),
      (output) => {
        output.text('');
        output.text('Found it.');
        return { turn: { role: 'model' }, text: 'Found it.', calls: [], next: 'done' };
      },
    ]);
    const { req, events } = request({ tools: [searchTool()] });

    await runAgentLoop(req, adapter);

    expect(texts(events)).toEqual(['Looking.', '\n\n', 'Found it.']);
  });

  it('adds no blank line after a reply without text', async () => {
    const { adapter } = scripted([
      reply('', 'tools', [{ name: 'search', input: { query: 'charger' } }]),
      reply('Found it.', 'done'),
    ]);
    const { req, events } = request({ tools: [searchTool()] });

    const result = await runAgentLoop(req, adapter);

    expect(texts(events)).toEqual(['Found it.']);
    expect(result.text).toBe('Found it.');
  });

  it('takes back what a request sent again streamed, its blank line included, and streams the line again', async () => {
    const { adapter, sent } = scripted([
      reply('Looking.', 'tools', [{ name: 'search', input: { query: 'charger' } }]),
      (output) => {
        output.text('Half an');
        output.usage(usage(5));
        return { resend: 'unreadable tool input' };
      },
      reply('Found it.', 'done'),
    ]);
    const { req, events } = request({ tools: [searchTool()] });

    const result = await runAgentLoop(req, adapter);

    expect(texts(events)).toEqual([
      'Looking.',
      '\n\n',
      'Half an',
      '<retry 9>',
      '\n\n',
      'Found it.',
    ]);
    expect(result.text).toBe('Looking.\n\nFound it.');
    expect(sent[2]).toEqual(sent[1]); // the same request, again
    expect(result.usage).toEqual(usage(7)); // the failed request counts
  });

  it('fails with bad_output, with the reason as its detail, after its re-sends', async () => {
    const resend: Step = (output) => {
      output.text('Half');
      return { resend: 'unreadable tool input' };
    };
    const { adapter, sent, toError } = scripted([resend, resend, resend, reply('Never.', 'done')]);
    const { req, events } = request();

    const error = await runAgentLoop(req, adapter).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      kind: 'bad_output',
      userMessage: 'Bad output.',
      opts: { detail: 'unreadable tool input' },
    });
    expect(toError).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(3); // the first request and two re-sends
    expect(events.filter((e) => e.type === 'retry')).toEqual([
      { type: 'retry', discard: 4 },
      { type: 'retry', discard: 4 },
    ]);
  });

  it('reports the usage of every request and adds it up', async () => {
    const { adapter } = scripted([
      reply('Looking.', 'tools', [{ name: 'search', input: { query: 'charger' } }]),
      reply('Found it.', 'done'),
    ]);
    const { req, events } = request({ tools: [searchTool()] });

    const result = await runAgentLoop(req, adapter);

    expect(events.filter((e) => e.type === 'usage')).toEqual([
      { type: 'usage', usage: usage(1) },
      { type: 'usage', usage: usage(1) },
    ]);
    expect(result.usage).toEqual(usage(2));
  });

  it('sends the conversation again for `again`, without running its calls', async () => {
    const run = vi.fn(async () => ({ content: 'two hits', activity: 'Searched' }));
    const { adapter, sent } = scripted([
      reply('Still working.', 'again', [{ name: 'search', input: { query: 'charger' } }]),
      reply('Done.', 'done'),
    ]);
    const { req } = request({ tools: [searchTool(run)] });

    const result = await runAgentLoop(req, adapter);

    expect(run).not.toHaveBeenCalled();
    expect(sent[1]).toEqual([
      { role: 'user', text: 'What did Anna say?' },
      { role: 'model', text: 'Still working.' },
    ]);
    expect(result.text).toBe('Still working.\n\nDone.');
  });

  it("runs a reply's calls together, and sends their results in one turn, in the order of the calls", async () => {
    const started: string[] = [];
    const finish: Record<string, () => void> = {};
    const tool = searchTool(
      (input) =>
        new Promise((resolve) => {
          const { query } = input as { query: string };
          started.push(query);
          finish[query] = () =>
            resolve({ content: `hits for ${query}`, activity: `Searched ${query}` });
        }),
    );
    const { adapter, sent } = scripted([
      reply('', 'tools', [
        { name: 'search', input: { query: 'first' } },
        { name: 'search', input: { query: 'second' } },
      ]),
      reply('Done.', 'done'),
    ]);
    const { req, events } = request({ tools: [tool] });

    const running = runAgentLoop(req, adapter);
    await vi.waitFor(() => expect(started).toEqual(['first', 'second']));
    finish.second!();
    finish.first!();
    await running;

    expect(sent[1]?.at(-1)).toEqual({
      role: 'results',
      outcomes: [
        { content: 'hits for first', isError: false },
        { content: 'hits for second', isError: false },
      ],
    });
    expect(
      events.filter((e) => e.type === 'tool').map((e) => e.type === 'tool' && e.activity),
    ).toEqual(['Searched second', 'Searched first']);
  });

  it('gives the model an error result for an unknown tool, an invalid input and a tool that throws', async () => {
    const failing = searchTool(async () => {
      throw new Error('The corpus is not loaded.');
    });
    const { adapter, sent } = scripted([
      reply('', 'tools', [
        { name: 'missing', input: {} },
        { name: 'search', input: { query: 3 } },
        { name: 'search', input: { query: 'charger' } },
      ]),
      reply('Done.', 'done'),
    ]);
    const { req, events } = request({ tools: [failing] });

    await runAgentLoop(req, adapter);

    const outcomes = sent[1]?.at(-1)?.outcomes;
    expect(outcomes?.map((o) => o.isError)).toEqual([true, true, true]);
    expect(outcomes?.[0]?.content).toBe('There is no tool "missing".');
    expect(outcomes?.[1]?.content).toMatch(/^Invalid input: /);
    expect(outcomes?.[2]?.content).toBe('The corpus is not loaded.');
    expect(events.filter((e) => e.type === 'tool')).toEqual([
      { type: 'tool', name: 'missing', activity: 'There is no tool "missing".', isError: true },
      { type: 'tool', name: 'search', activity: 'search: invalid input', isError: true },
      { type: 'tool', name: 'search', activity: 'The corpus is not loaded.', isError: true },
    ]);
  });

  it('stops with `aborted` when the signal is aborted while tools run', async () => {
    const controller = new AbortController();
    const tool = searchTool(async () => {
      controller.abort();
      return { content: 'two hits', activity: 'Searched' };
    });
    const { adapter, sent } = scripted([
      reply('Looking.', 'tools', [{ name: 'search', input: { query: 'charger' } }]),
      reply('Never.', 'done'),
    ]);
    const { req } = request({ tools: [tool], signal: controller.signal });

    await expect(runAgentLoop(req, adapter)).rejects.toMatchObject({
      kind: 'aborted',
      userMessage: 'Stopped.',
    });
    expect(sent).toHaveLength(1);
  });

  it('ends with `limit` after maxIterations requests; a follow-up continues after the tool results', async () => {
    const searching = reply('Looking.', 'tools', [{ name: 'search', input: { query: 'charger' } }]);
    const { adapter, sent, registry } = scripted([searching, searching, reply('Answer.', 'done')]);
    const { req } = request({ tools: [searchTool()], maxIterations: 2 });

    const result = await runAgentLoop(req, adapter);
    expect(result.stopped).toBe('limit');
    expect(sent).toHaveLength(2);

    const followUp = request({
      tools: [searchTool()],
      conversation: result.conversation,
      userMessage: 'Go on.',
    });
    await runAgentLoop(followUp.req, scripted([], registry).adapter).catch(() => undefined);
    expect(registry.continuing(result.conversation, 'fake-model').map((t) => t.role)).toEqual([
      'user',
      'model',
      'results',
      'model',
      'results',
    ]);
  });

  it('ends with `limit` when the adapter says so', async () => {
    const { adapter } = scripted([reply('Cut', 'limit')]);
    const { req } = request();

    await expect(runAgentLoop(req, adapter)).resolves.toMatchObject({
      text: 'Cut',
      stopped: 'limit',
    });
  });

  it('passes every error through toError', async () => {
    const { adapter, toError } = scripted([
      () => {
        throw new TypeError('Failed to fetch');
      },
    ]);
    const { req } = request();

    await expect(runAgentLoop(req, adapter)).rejects.toMatchObject({ kind: 'unknown' });
    expect(toError).toHaveBeenCalledWith(new TypeError('Failed to fetch'));
  });
});

describe('createConversations', () => {
  const run = async (
    registry: ConversationRegistry<Turn>,
    conversation: AgentRunRequest['conversation'],
  ) => {
    const { adapter, sent } = scripted([reply('Answer.', 'done')], registry);
    const result = await runAgentLoop(request({ conversation }).req, adapter);
    return { result, sent };
  };

  it("continues a conversation with its turns, and doesn't change the one it continued", async () => {
    const registry = createConversations<Turn>('fakeAgent');
    const first = await run(registry, null);
    const second = await run(registry, first.result.conversation);

    expect(second.sent[0]?.map((t) => t.role)).toEqual(['user', 'model', 'user']);
    expect(registry.continuing(first.result.conversation, 'fake-model')).toHaveLength(2);
    expect(registry.continuing(second.result.conversation, 'fake-model')).toHaveLength(4);
    expect(Object.isFrozen(registry.continuing(first.result.conversation, 'fake-model'))).toBe(
      true,
    );
  });

  it("rejects a conversation it didn't make, or one started on another model, before any request", async () => {
    const registry = createConversations<Turn>('fakeAgent');
    const theirs = createConversations<Turn>('otherAgent').make('fake-model', []);
    const ours = registry.make('other-model', []);

    for (const conversation of [theirs, ours]) {
      const { adapter, sent, toError } = scripted([reply('Never.', 'done')], registry);
      const error = await runAgentLoop(request({ conversation }).req, adapter).catch(
        (err: unknown) => err,
      );
      expect(error).not.toBeInstanceOf(ProviderError);
      expect(sent).toHaveLength(0);
      expect(toError).not.toHaveBeenCalled();
    }
    expect(() => registry.continuing(theirs, 'fake-model')).toThrow(
      'fakeAgent: unknown conversation',
    );
    expect(() => registry.continuing(ours, 'fake-model')).toThrow(
      "fakeAgent: a conversation started on other-model can't continue on fake-model",
    );
  });
});
