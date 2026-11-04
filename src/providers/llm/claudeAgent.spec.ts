import { describe, expect, it, vi } from 'vitest';
import { z } from '../../lib/zod';
import {
  agentMessage,
  apiError,
  brokenToolUseBlock,
  fallbackBlock,
  heldReply,
  scriptedFetch,
  streamedText,
  textBlock,
  thinkingBlock,
  toolUseBlock,
  type ScriptedReply,
} from '../../testing/agent';
import { ProviderError } from '../errors';
import { CLAUDE_FALLBACK_BETA } from './claude';
import { createClaudeAgent } from './claudeAgent';
import {
  AGENT_MAX_OUTPUT_TOKENS,
  type AgentConversation,
  type AgentEvent,
  type AgentRunRequest,
  type AgentTool,
} from './types';

const KEY = 'test-key-agent-123';
const MODEL = 'claude-sonnet-5-5';

/** A tool that echoes its query, and records what it was called with. */
function searchTool(calls: string[] = []): AgentTool<{ query: string }> {
  return {
    name: 'search_transcripts',
    description: 'Find turns.',
    input: z.object({ query: z.string() }),
    run: async ({ query }) => {
      calls.push(query);
      return { content: `hits for ${query}`, activity: `Searched "${query}"` };
    },
  };
}

const readTool: AgentTool<{ session: string }> = {
  name: 'read_transcript',
  description: 'Read turns.',
  input: z.object({ session: z.string() }),
  run: async ({ session }) => ({ content: `t1 [00:00:03] Anna: …`, activity: `Read ${session}` }),
};

const failingTool: AgentTool<{ session: string }> = {
  name: 'get_summaries',
  description: 'Summaries.',
  input: z.object({ session: z.string() }),
  run: async () => {
    throw new Error('Unknown session s99. Use keys from the session list.');
  },
};

function setup(replies: readonly ScriptedReply[], model = MODEL) {
  const scripted = scriptedFetch(replies);
  const agent = createClaudeAgent({
    apiKey: ` ${KEY} `,
    model,
    fetch: scripted.fetch,
    maxRetries: 0,
  });
  return { agent, ...scripted };
}

function request(
  overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    instructions: 'You help a research team.',
    context: 'Project: Hearing at home 2026',
    tools: [searchTool() as AgentTool, readTool as AgentTool],
    conversation: null,
    userMessage: 'Quotes about charging at night?',
    maxIterations: 35,
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    events,
    ...overrides,
  };
}

const usage = (input: number, output: number, read = 0, write = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
});

/** search → read → answer, with thinking before each tool call. */
const threeReplies = (): ScriptedReply[] => [
  {
    message: agentMessage(
      [
        thinkingBlock('sig-1'),
        toolUseBlock('tu_1', 'search_transcripts', { query: 'charg* night' }),
      ],
      { usage: usage(1200, 80, 0, 5000) },
    ),
  },
  {
    message: agentMessage(
      [thinkingBlock('sig-2'), toolUseBlock('tu_2', 'read_transcript', { session: 's3' })],
      { usage: usage(300, 60, 5000, 200) },
    ),
  },
  {
    message: agentMessage(
      [
        thinkingBlock('sig-3'),
        textBlock('People charge them by the bed.\n<quote ref="s3/t1">by the bed</quote>'),
      ],
      { usage: usage(100, 400, 5200, 150) },
    ),
  },
];

async function errorOf(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error('expected a ProviderError');
}

const lastMessage = (body: Record<string, unknown>) => {
  const messages = body.messages as { role: string; content: unknown }[];
  return messages[messages.length - 1]!;
};

describe('createClaudeAgent', () => {
  it('sends the cached system blocks, the tools in order, effort, thinking and the fallback', async () => {
    const { agent, requests } = setup([{ message: agentMessage([textBlock('Hello.')]) }]);
    await agent.run(request());

    const [seen] = requests;
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(seen!.headers.get('anthropic-beta')).toContain(CLAUDE_FALLBACK_BETA);
    const body = seen!.body;
    expect(body).toMatchObject({
      model: MODEL,
      max_tokens: AGENT_MAX_OUTPUT_TOKENS,
      stream: true,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      fallbacks: 'default',
      system: [
        { type: 'text', text: 'You help a research team.', cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: 'Project: Hearing at home 2026',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: 'Quotes about charging at night?' }],
    });
    expect(body).not.toHaveProperty('tool_choice');
    const tools = body.tools as Record<string, unknown>[];
    expect(tools.map((t) => t.name)).toEqual(['search_transcripts', 'read_transcript']);
    expect(tools[0]).toMatchObject({
      description: 'Find turns.',
      eager_input_streaming: true,
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    });
  });

  it('runs search → read → answer: streamed text, tool events, usage and a conversation', async () => {
    const { agent, requests } = setup(threeReplies());
    const req = request();
    const result = await agent.run(req);

    expect(result.stopped).toBe('done');
    expect(result.text).toBe(
      'People charge them by the bed.\n<quote ref="s3/t1">by the bed</quote>',
    );
    expect(result.conversation.model).toBe(MODEL);
    expect(result.usage).toEqual({
      inputTokens: 1600,
      outputTokens: 540,
      cacheReadTokens: 10200,
      cacheWriteTokens: 5350,
    });

    const kinds = req.events.map((e) => e.type);
    expect(kinds.slice(0, 4)).toEqual(['usage', 'tool', 'usage', 'tool']);
    expect(kinds.at(-1)).toBe('usage');
    expect(req.events.filter((e) => e.type === 'tool')).toEqual([
      {
        type: 'tool',
        name: 'search_transcripts',
        activity: 'Searched "charg* night"',
        isError: false,
      },
      { type: 'tool', name: 'read_transcript', activity: 'Read s3', isError: false },
    ]);
    const streamed = req.events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(streamed).toBe(result.text);

    // Each request resends the conversation so far; tool results go back as a user message.
    expect(requests).toHaveLength(3);
    expect(lastMessage(requests[1]!.body)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'hits for charg* night' }],
    });
  });

  it('extends a conversation unchanged, thinking blocks and their signatures included', async () => {
    const { agent, requests } = setup([
      ...threeReplies(),
      { message: agentMessage([textBlock('And in the evening, too.')]) },
    ]);
    const first = await agent.run(request());
    const second = await agent.run(
      request({ conversation: first.conversation, userMessage: 'More?' }),
    );

    const before = requests[2]!.body.messages as unknown[];
    const followUp = requests[3]!.body.messages as unknown[];
    // Everything the third request sent, then the answer exactly as it came, then the new question.
    expect(followUp.slice(0, before.length)).toEqual(before);
    expect(followUp[before.length]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig-3' },
        {
          type: 'text',
          text: 'People charge them by the bed.\n<quote ref="s3/t1">by the bed</quote>',
        },
      ],
    });
    expect(followUp[before.length + 1]).toEqual({ role: 'user', content: 'More?' });
    expect(followUp).toHaveLength(before.length + 2);
    expect((before[1] as { content: unknown[] }).content[0]).toEqual({
      type: 'thinking',
      thinking: '',
      signature: 'sig-1',
    });
    expect(second.text).toBe('And in the evening, too.');
  });

  it('answers parallel tool calls in one message, in the order they were made', async () => {
    const calls: string[] = [];
    const { agent, requests } = setup([
      {
        message: agentMessage([
          toolUseBlock('tu_a', 'search_transcripts', { query: 'charger' }),
          toolUseBlock('tu_b', 'search_transcripts', { query: 'Ladegerät' }),
        ]),
      },
      { message: agentMessage([textBlock('Done.')]) },
    ]);
    await agent.run(request({ tools: [searchTool(calls) as AgentTool] }));

    expect(calls.sort()).toEqual(['Ladegerät', 'charger']);
    expect(requests[1]!.body.messages).toHaveLength(3);
    expect(lastMessage(requests[1]!.body)).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_a', content: 'hits for charger' },
        { type: 'tool_result', tool_use_id: 'tu_b', content: 'hits for Ladegerät' },
      ],
    });
  });

  it('turns a tool that throws into an error result with its message', async () => {
    const { agent, requests } = setup([
      { message: agentMessage([toolUseBlock('tu_1', 'get_summaries', { session: 's99' })]) },
      { message: agentMessage([textBlock('That session does not exist.')]) },
    ]);
    const req = request({ tools: [failingTool as AgentTool] });
    await agent.run(req);

    const message = 'Unknown session s99. Use keys from the session list.';
    expect(lastMessage(requests[1]!.body)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: message, is_error: true }],
    });
    expect(req.events).toContainEqual({
      type: 'tool',
      name: 'get_summaries',
      activity: message,
      isError: true,
    });
  });

  it("rejects input that doesn't match the tool's schema without running the tool", async () => {
    const run = vi.fn();
    const strict: AgentTool = { ...(searchTool() as AgentTool), run };
    const { agent, requests } = setup([
      { message: agentMessage([toolUseBlock('tu_1', 'search_transcripts', { query: 42 })]) },
      { message: agentMessage([textBlock('Sorry.')]) },
    ]);
    const req = request({ tools: [strict] });
    await agent.run(req);

    expect(run).not.toHaveBeenCalled();
    const result = (lastMessage(requests[1]!.body).content as Record<string, unknown>[])[0]!;
    expect(result).toMatchObject({ tool_use_id: 'tu_1', is_error: true });
    expect(String(result.content)).toMatch(/^Invalid input: .*query/s);
    expect(req.events).toContainEqual({
      type: 'tool',
      name: 'search_transcripts',
      activity: 'search_transcripts: invalid input',
      isError: true,
    });
  });

  it("answers a call to a tool it doesn't have with an error result", async () => {
    const { agent, requests } = setup([
      { message: agentMessage([toolUseBlock('tu_1', 'delete_files', {})]) },
      { message: agentMessage([textBlock('OK.')]) },
    ]);
    await agent.run(request());
    expect(lastMessage(requests[1]!.body).content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'tu_1',
        content: 'There is no tool "delete_files".',
        is_error: true,
      },
    ]);
  });

  it('puts a line break between the text of two replies', async () => {
    const { agent } = setup([
      {
        message: agentMessage([
          textBlock('Let me look.'),
          toolUseBlock('tu_1', 'search_transcripts', { query: 'bed' }),
        ]),
      },
      { message: agentMessage([textBlock('By the bed.')]) },
    ]);
    const req = request();
    const result = await agent.run(req);
    expect(result.text).toBe('Let me look.\n\nBy the bed.');
    expect(req.events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('')).toBe(
      result.text,
    );
  });

  it("sends the request again after tool JSON it can't parse, takes back that text, and counts its usage", async () => {
    const calls: string[] = [];
    const { agent, requests } = setup([
      {
        message: agentMessage(
          [textBlock('Let me look.'), brokenToolUseBlock('tu_1', 'search_transcripts')],
          { usage: usage(1000, 40) },
        ),
      },
      {
        message: agentMessage(
          [textBlock('Let me look.'), toolUseBlock('tu_2', 'search_transcripts', { query: 'bed' })],
          { usage: usage(1000, 40) },
        ),
      },
      { message: agentMessage([textBlock('By the bed.')], { usage: usage(200, 30) }) },
    ]);
    const req = request({ tools: [searchTool(calls) as AgentTool] });
    const result = await agent.run(req);

    expect(requests).toHaveLength(3);
    expect(requests[1]!.body.messages).toEqual(requests[0]!.body.messages);
    expect(calls).toEqual(['bed']);
    expect(req.events.filter((e) => e.type === 'retry')).toEqual([
      { type: 'retry', discard: 'Let me look.'.length },
    ]);
    expect(result.text).toBe('Let me look.\n\nBy the bed.');
    expect(streamedText(req.events)).toBe(result.text);
    // The failed attempt's input counts; its output isn't known before `message_delta`.
    expect(result.usage).toMatchObject({ inputTokens: 2200, outputTokens: 70 });
  });

  it('a request sent again after a tool turn puts its line break back', async () => {
    const { agent } = setup([
      {
        message: agentMessage([
          textBlock('Let me look.'),
          toolUseBlock('tu_1', 'search_transcripts', { query: 'bed' }),
        ]),
      },
      {
        message: agentMessage([
          textBlock('Found it.'),
          brokenToolUseBlock('tu_2', 'read_transcript'),
        ]),
      },
      {
        message: agentMessage([
          textBlock('Found it.'),
          toolUseBlock('tu_3', 'read_transcript', { session: 's3' }),
        ]),
      },
      { message: agentMessage([textBlock('By the bed.')]) },
    ]);
    const req = request();
    const result = await agent.run(req);

    expect(req.events.filter((e) => e.type === 'retry')).toEqual([
      { type: 'retry', discard: '\n\nFound it.'.length },
    ]);
    expect(result.text).toBe('Let me look.\n\nFound it.\n\nBy the bed.');
    expect(streamedText(req.events)).toBe(result.text);
  });

  it('gives `bad_output` after two re-sends in a row, with the usage of all three', async () => {
    const broken = (): ScriptedReply => ({
      message: agentMessage([
        textBlock('Let me look.'),
        brokenToolUseBlock('tu_1', 'search_transcripts'),
      ]),
    });
    const { agent, requests } = setup([broken(), broken(), broken()]);
    const req = request();
    const err = await errorOf(agent.run(req));

    expect(err.kind).toBe('bad_output');
    expect(err.opts.detail).toContain('Unable to parse tool parameter JSON');
    expect(requests).toHaveLength(3);
    expect(req.events.filter((e) => e.type === 'retry')).toHaveLength(2);
    const inputTokens = req.events.flatMap((e) =>
      e.type === 'usage' ? [e.usage.inputTokens] : [],
    );
    expect(inputTokens).toEqual([100, 100, 100]);
  });

  it('resumes a paused turn', async () => {
    const { agent, requests } = setup([
      { message: agentMessage([textBlock('Looking')], { stop_reason: 'pause_turn' }) },
      { message: agentMessage([textBlock(' further.')]) },
    ]);
    const result = await agent.run(request());
    expect(requests).toHaveLength(2);
    expect(lastMessage(requests[1]!.body).role).toBe('assistant');
    expect(result.stopped).toBe('done');
  });

  it('leaves out what came before a mid-output fallback, and runs only the calls after it', async () => {
    const calls: string[] = [];
    const { agent, requests } = setup([
      {
        message: agentMessage([
          thinkingBlock('sig-declined'),
          toolUseBlock('tu_old', 'search_transcripts', { query: 'declined' }),
          fallbackBlock(MODEL, 'claude-opus-5-5'),
          textBlock('Searching.'),
          toolUseBlock('tu_new', 'search_transcripts', { query: 'charger' }),
        ]),
      },
      { message: agentMessage([textBlock('Done.')]) },
    ]);
    await agent.run(request({ tools: [searchTool(calls) as AgentTool] }));

    expect(calls).toEqual(['charger']);
    const messages = requests[1]!.body.messages as { content: Record<string, unknown>[] }[];
    expect(messages[1]!.content.map((b) => b.type)).toEqual(['fallback', 'text', 'tool_use']);
    expect(messages[2]!.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_new', content: 'hits for charger' },
    ]);
  });

  it("resumes a saved chat's questions and answers as text, then extends it as usual", async () => {
    const { agent, requests } = setup([{ message: agentMessage([textBlock('Yes, at night.')]) }]);
    const conversation = agent.resume([
      {
        question: 'How do they charge?',
        answer: 'By the bed.\n<quote ref="s3/t1">by the bed</quote>',
      },
      { question: 'Every night?', answer: 'Mostly.' },
    ]);
    expect(conversation.model).toBe(MODEL);

    const result = await agent.run(request({ conversation, userMessage: 'Even on trips?' }));
    expect(requests[0]!.body.messages).toEqual([
      { role: 'user', content: 'How do they charge?' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'By the bed.\n<quote ref="s3/t1">by the bed</quote>' }],
      },
      { role: 'user', content: 'Every night?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Mostly.' }] },
      { role: 'user', content: 'Even on trips?' },
    ]);
    expect(result.text).toBe('Yes, at night.');

    // A resumed conversation keeps its model, as any other.
    const opus = setup([], 'claude-opus-5-5').agent;
    await expect(opus.run(request({ conversation }))).rejects.toThrow("can't continue on");
  });

  it('resumes no history as an empty conversation', async () => {
    const { agent, requests } = setup([{ message: agentMessage([textBlock('Hello.')]) }]);
    await agent.run(request({ conversation: agent.resume([]) }));
    expect(requests[0]!.body.messages).toEqual([
      { role: 'user', content: 'Quotes about charging at night?' },
    ]);
  });

  it("refuses a conversation started on another model, or one it didn't make", async () => {
    const { agent } = setup(threeReplies());
    const { conversation } = await agent.run(request());
    const opus = setup([], 'claude-opus-5-5').agent;
    await expect(opus.run(request({ conversation }))).rejects.toThrow(
      "a conversation started on claude-sonnet-5-5 can't continue on claude-opus-5-5",
    );
    const forged = { model: MODEL } as unknown as AgentConversation;
    await expect(agent.run(request({ conversation: forged }))).rejects.toThrow(
      'unknown conversation',
    );
  });

  it('stops at maxIterations with `limit`, leaving a conversation that a follow-up can extend', async () => {
    const reply = () => ({
      message: agentMessage([toolUseBlock('tu_x', 'search_transcripts', { query: 'more' })]),
    });
    const { agent, requests } = setup([
      reply(),
      reply(),
      { message: agentMessage([textBlock('Ok.')]) },
    ]);
    const result = await agent.run(request({ maxIterations: 2 }));

    expect(result.stopped).toBe('limit');
    expect(requests).toHaveLength(2);
    await agent.run(request({ conversation: result.conversation, userMessage: 'Answer now.' }));
    const messages = requests[2]!.body.messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'user',
    ]);
  });

  it('stops with `limit` when the answer is cut off at max_tokens', async () => {
    const { agent } = setup([
      { message: agentMessage([textBlock('People say')], { stop_reason: 'max_tokens' }) },
    ]);
    const result = await agent.run(request());
    expect(result).toMatchObject({ stopped: 'limit', text: 'People say' });
  });

  it('never runs a tool call cut off at max_tokens', async () => {
    const calls: string[] = [];
    const { agent } = setup([
      {
        message: agentMessage([toolUseBlock('tu_1', 'search_transcripts', { query: 'cha' })], {
          stop_reason: 'max_tokens',
        }),
      },
    ]);
    const err = await errorOf(agent.run(request({ tools: [searchTool(calls) as AgentTool] })));
    expect(err.kind).toBe('bad_output');
    expect(calls).toEqual([]);
  });

  it('maps an abort part-way through the stream to `aborted`', async () => {
    const controller = new AbortController();
    const { agent } = setup([
      heldReply(agentMessage([textBlock('A long answer that never ends.')]), () =>
        controller.abort(),
      ),
    ]);
    expect((await errorOf(agent.run(request({ signal: controller.signal })))).kind).toBe('aborted');
  });

  it('maps a refusal, even one that follows tool calls, to `refused`', async () => {
    const { agent } = setup([
      { message: agentMessage([toolUseBlock('tu_1', 'search_transcripts', { query: 'x' })]) },
      {
        message: agentMessage([textBlock('I')], {
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'bio', explanation: null },
        }),
      },
    ]);
    const err = await errorOf(agent.run(request()));
    expect(err).toMatchObject({ kind: 'refused', retryable: false });
    expect(err.opts.detail).toBe('refusal: bio');
  });

  it.each([
    [401, 'authentication_error', 'auth'],
    [429, 'rate_limit_error', 'rate_limit'],
    [529, 'overloaded_error', 'server'],
  ])('maps HTTP %i to `%s` → %s, without the key', async (status, type, kind) => {
    const { agent } = setup([{ status, body: apiError(type, `bad key ${KEY}`) }]);
    const err = await errorOf(agent.run(request()));
    expect(err.kind).toBe(kind);
    expect(`${err.userMessage} ${err.opts.detail ?? ''}`).not.toContain(KEY);
  });

  it('shows the API reason for a 400 without the key', async () => {
    const { agent } = setup([
      { status: 400, body: apiError('invalid_request_error', `messages: key ${KEY} is wrong`) },
    ]);
    const err = await errorOf(agent.run(request()));
    expect(err.kind).toBe('validation');
    expect(err.userMessage).toContain('[redacted]');
    expect(err.userMessage).not.toContain(KEY);
  });

  it('maps a failed fetch to `network` and a stream that fails part-way to `server`', async () => {
    const offline = setup([() => Promise.reject(new TypeError('Failed to fetch'))]).agent;
    expect((await errorOf(offline.run(request()))).kind).toBe('network');

    const broken = setup([
      {
        message: agentMessage([textBlock('Partial')]),
        error: { type: 'overloaded_error', message: 'Overloaded' },
      },
    ]).agent;
    expect((await errorOf(broken.run(request()))).kind).toBe('server');
  });
});
