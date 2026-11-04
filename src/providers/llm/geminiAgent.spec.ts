import { describe, expect, it } from 'vitest';
import { z } from '../../lib/zod';
import { agentMessage, scriptedFetch, streamedText, textBlock } from '../../testing/agent';
import {
  functionCallPart,
  geminiTurn,
  geminiUsage,
  googleError,
  heldGeminiReply,
  scriptedGeminiFetch,
  textPart,
  thoughtPart,
  type GeminiScriptedReply,
} from '../../testing/geminiAgent';
import { ProviderError } from '../errors';
import { createClaudeAgent } from './claudeAgent';
import { GEMINI_MESSAGES } from './gemini';
import { createGeminiAgent } from './geminiAgent';
import {
  AGENT_MAX_OUTPUT_TOKENS,
  type AgentConversation,
  type AgentEvent,
  type AgentRunRequest,
  type AgentTool,
} from './types';

const KEY = 'test-key-gemini-agent-123';
const MODEL = 'gemini-3.8-flash';

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

function setup(replies: readonly GeminiScriptedReply[], model = MODEL) {
  const scripted = scriptedGeminiFetch(replies);
  const agent = createGeminiAgent({
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

const ANSWER = 'People charge them by the bed.\n<quote ref="s3/t1">by the bed</quote>';

/** search → read → answer, each step's function call carrying its signature, as Gemini 3 and 4 send them. */
const threeReplies = (): GeminiScriptedReply[] => [
  {
    response: geminiTurn(
      [functionCallPart('search_transcripts', { query: 'charg* night' }, { signature: 'sig-1' })],
      { usage: geminiUsage(6200, 80, 0, 300) },
    ),
  },
  {
    response: geminiTurn(
      [functionCallPart('read_transcript', { session: 's3' }, { signature: 'sig-2' })],
      { usage: geminiUsage(6500, 60, 6000, 200) },
    ),
  },
  {
    response: geminiTurn([textPart(ANSWER, 'sig-3')], { usage: geminiUsage(6700, 400, 6400, 150) }),
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

type Contents = { role: string; parts: Record<string, unknown>[] }[];
const contentsOf = (body: Record<string, unknown>) => body.contents as Contents;
const lastContent = (body: Record<string, unknown>) => contentsOf(body).at(-1)!;

describe('createGeminiAgent', () => {
  it('sends the instructions then the context, the tools in order, the thinking level and the output limit', async () => {
    const { agent, requests } = setup([{ response: geminiTurn([textPart('Hello.')]) }]);
    await agent.run(request());

    const [seen] = requests;
    expect(seen!.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`,
    );
    expect(seen!.headers.get('x-goog-api-key')).toBe(KEY);
    const body = seen!.body;
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'You help a research team.' }, { text: 'Project: Hearing at home 2026' }],
    });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Quotes about charging at night?' }] },
    ]);
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'search_transcripts',
            description: 'Find turns.',
            parametersJsonSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false,
            },
          },
          {
            name: 'read_transcript',
            description: 'Read turns.',
            parametersJsonSchema: {
              type: 'object',
              properties: { session: { type: 'string' } },
              required: ['session'],
              additionalProperties: false,
            },
          },
        ],
      },
    ]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
    });
    // Automatic function calling is an SDK setting: nothing of it reaches the API.
    expect(body).not.toHaveProperty('toolConfig');
  });

  it('leaves out an empty context', async () => {
    const { agent, requests } = setup([{ response: geminiTurn([textPart('Hello.')]) }]);
    await agent.run(request({ context: '' }));
    expect(requests[0]!.body.systemInstruction).toEqual({
      parts: [{ text: 'You help a research team.' }],
    });
  });

  it('runs search → read → answer: streamed text, tool events, usage and a conversation', async () => {
    const { agent, requests } = setup(threeReplies());
    const req = request();
    const result = await agent.run(req);

    expect(result.stopped).toBe('done');
    expect(result.text).toBe(ANSWER);
    expect(result.conversation.model).toBe(MODEL);
    // Input is the prompt less what was cached; thinking counts as output.
    expect(result.usage).toEqual({
      inputTokens: 6200 + 500 + 300,
      outputTokens: 80 + 300 + 60 + 200 + 400 + 150,
      cacheReadTokens: 12400,
      cacheWriteTokens: 0,
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
    const deltas = req.events.flatMap((e) => (e.type === 'text' ? [e.delta] : []));
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe(result.text);

    // Each request resends the conversation so far; function responses go back as a user turn.
    expect(requests).toHaveLength(3);
    expect(lastContent(requests[1]!.body)).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'search_transcripts',
            response: { output: 'hits for charg* night' },
          },
        },
      ],
    });
  });

  it('sends the instructions, context and tools unchanged on every request, and on a follow-up', async () => {
    const { agent, requests } = setup([
      ...threeReplies(),
      { response: geminiTurn([textPart('And in the evening, too.')]) },
    ]);
    const first = await agent.run(request());
    await agent.run(request({ conversation: first.conversation, userMessage: 'More?' }));

    const fixed = ({ systemInstruction, tools, generationConfig }: Record<string, unknown>) =>
      JSON.stringify({ systemInstruction, tools, generationConfig });
    expect(new Set(requests.map((r) => fixed(r.body))).size).toBe(1);
  });

  it('extends a conversation unchanged, thought signatures included', async () => {
    const { agent, requests } = setup([
      ...threeReplies(),
      { response: geminiTurn([textPart('And in the evening, too.')]) },
    ]);
    const first = await agent.run(request());
    const second = await agent.run(
      request({ conversation: first.conversation, userMessage: 'More?' }),
    );

    const before = contentsOf(requests[2]!.body);
    const followUp = contentsOf(requests[3]!.body);
    // Everything the third request sent, then the answer's parts exactly as they streamed, then the question.
    expect(followUp.slice(0, before.length)).toEqual(before);
    const answer = followUp[before.length]!;
    expect(answer.role).toBe('model');
    expect(answer.parts.map((p) => p.text ?? '').join('')).toBe(ANSWER);
    expect(answer.parts.filter((p) => p.thoughtSignature)).toEqual([
      { text: expect.any(String), thoughtSignature: 'sig-3' },
    ]);
    expect(followUp[before.length + 1]).toEqual({ role: 'user', parts: [{ text: 'More?' }] });
    expect(followUp).toHaveLength(before.length + 2);
    expect(before[1]!.parts[0]).toEqual({
      functionCall: { name: 'search_transcripts', args: { query: 'charg* night' } },
      thoughtSignature: 'sig-1',
    });
    expect(second.text).toBe('And in the evening, too.');
  });

  it('keeps thought parts in the conversation and never in the text', async () => {
    const { agent, requests } = setup([
      {
        response: geminiTurn([
          thoughtPart('Thinking about chargers.', 'sig-t'),
          functionCallPart('search_transcripts', { query: 'charger' }),
        ]),
      },
      { response: geminiTurn([thoughtPart('Found it.'), textPart('By the bed.')]) },
    ]);
    const req = request();
    const result = await agent.run(req);

    expect(result.text).toBe('By the bed.');
    const deltas = req.events.flatMap((e) => (e.type === 'text' ? [e.delta] : []));
    expect(deltas.join('')).toBe('By the bed.');
    expect(contentsOf(requests[1]!.body)[1]!.parts[0]).toEqual({
      text: 'Thinking about chargers.',
      thought: true,
      thoughtSignature: 'sig-t',
    });
  });

  it('answers parallel calls in one turn, in the order they were made, with their ids', async () => {
    const calls: string[] = [];
    const { agent, requests } = setup([
      {
        response: geminiTurn([
          functionCallPart(
            'search_transcripts',
            { query: 'charger' },
            { id: 'fc_a', signature: 's' },
          ),
          functionCallPart('search_transcripts', { query: 'Ladegerät' }, { id: 'fc_b' }),
        ]),
      },
      { response: geminiTurn([textPart('Done.')]) },
    ]);
    await agent.run(request({ tools: [searchTool(calls) as AgentTool] }));

    expect(calls.sort()).toEqual(['Ladegerät', 'charger']);
    expect(contentsOf(requests[1]!.body)).toHaveLength(3);
    expect(lastContent(requests[1]!.body)).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'fc_a',
            name: 'search_transcripts',
            response: { output: 'hits for charger' },
          },
        },
        {
          functionResponse: {
            id: 'fc_b',
            name: 'search_transcripts',
            response: { output: 'hits for Ladegerät' },
          },
        },
      ],
    });
  });

  it('turns a tool that throws into an error response with its message', async () => {
    const { agent, requests } = setup([
      { response: geminiTurn([functionCallPart('get_summaries', { session: 's99' })]) },
      { response: geminiTurn([textPart('There is no s99.')]) },
    ]);
    const req = request({ tools: [failingTool as AgentTool] });
    await agent.run(req);

    const message = 'Unknown session s99. Use keys from the session list.';
    expect(lastContent(requests[1]!.body).parts[0]).toEqual({
      functionResponse: { name: 'get_summaries', response: { error: message } },
    });
    expect(req.events).toContainEqual({
      type: 'tool',
      name: 'get_summaries',
      activity: message,
      isError: true,
    });
  });

  it("rejects arguments that don't match the tool's schema without running the tool", async () => {
    const calls: string[] = [];
    const { agent, requests } = setup([
      { response: geminiTurn([functionCallPart('search_transcripts', { q: 'charger' })]) },
      { response: geminiTurn([textPart('Sorry.')]) },
    ]);
    const req = request({ tools: [searchTool(calls) as AgentTool] });
    await agent.run(req);

    expect(calls).toEqual([]);
    const part = lastContent(requests[1]!.body).parts[0] as {
      functionResponse: { response: { error: string } };
    };
    expect(part.functionResponse.response.error).toMatch(/^Invalid input: /);
    expect(req.events).toContainEqual({
      type: 'tool',
      name: 'search_transcripts',
      activity: 'search_transcripts: invalid input',
      isError: true,
    });
  });

  it("answers a call to a tool it doesn't have with an error response", async () => {
    const { agent, requests } = setup([
      { response: geminiTurn([functionCallPart('delete_everything', {})]) },
      { response: geminiTurn([textPart('Ok.')]) },
    ]);
    await agent.run(request());
    expect(lastContent(requests[1]!.body).parts[0]).toEqual({
      functionResponse: {
        name: 'delete_everything',
        response: { error: 'There is no tool "delete_everything".' },
      },
    });
  });

  it('puts a line break between the text of two replies', async () => {
    const { agent } = setup([
      {
        response: geminiTurn([
          textPart('Let me look.'),
          functionCallPart('search_transcripts', { query: 'x' }),
        ]),
      },
      { response: geminiTurn([textPart('Found it.')]) },
    ]);
    const req = request();
    const result = await agent.run(req);
    expect(result.text).toBe('Let me look.\n\nFound it.');
    const deltas = req.events.flatMap((e) => (e.type === 'text' ? [e.delta] : []));
    expect(deltas.join('')).toBe(result.text);
  });

  it("resumes a saved chat's questions and answers as text, then extends it as usual", async () => {
    const { agent, requests } = setup([{ response: geminiTurn([textPart('Yes, at night.')]) }]);
    const conversation = agent.resume([
      { question: 'How do they charge?', answer: 'By the bed.' },
      { question: 'Every night?', answer: 'Mostly.' },
    ]);
    expect(conversation.model).toBe(MODEL);

    const result = await agent.run(request({ conversation, userMessage: 'Even on trips?' }));
    expect(contentsOf(requests[0]!.body)).toEqual([
      { role: 'user', parts: [{ text: 'How do they charge?' }] },
      { role: 'model', parts: [{ text: 'By the bed.' }] },
      { role: 'user', parts: [{ text: 'Every night?' }] },
      { role: 'model', parts: [{ text: 'Mostly.' }] },
      { role: 'user', parts: [{ text: 'Even on trips?' }] },
    ]);
    expect(result.text).toBe('Yes, at night.');

    const argon = setup([], 'gemini-4-argon').agent;
    await expect(argon.run(request({ conversation }))).rejects.toThrow("can't continue on");
  });

  it("refuses a conversation started on another model or provider, or one it didn't make", async () => {
    const { agent } = setup(threeReplies());
    const { conversation } = await agent.run(request());
    const argon = setup([], 'gemini-4-argon').agent;
    await expect(argon.run(request({ conversation }))).rejects.toThrow(
      "a conversation started on gemini-3.8-flash can't continue on gemini-4-argon",
    );

    const forged = { model: MODEL } as unknown as AgentConversation;
    await expect(agent.run(request({ conversation: forged }))).rejects.toThrow(
      'unknown conversation',
    );

    const claude = createClaudeAgent({
      apiKey: KEY,
      model: 'claude-sonnet-5-5',
      fetch: scriptedFetch([{ message: agentMessage([textBlock('Hi.')]) }]).fetch,
      maxRetries: 0,
    });
    const fromClaude = await claude.run(request());
    await expect(agent.run(request({ conversation: fromClaude.conversation }))).rejects.toThrow(
      'unknown conversation',
    );
  });

  it('stops at maxIterations with `limit`, leaving a conversation that a follow-up can extend', async () => {
    const reply = () => ({
      response: geminiTurn([functionCallPart('search_transcripts', { query: 'more' })]),
    });
    const { agent, requests } = setup([
      reply(),
      reply(),
      { response: geminiTurn([textPart('Ok.')]) },
    ]);
    const result = await agent.run(request({ maxIterations: 2 }));

    expect(result.stopped).toBe('limit');
    expect(requests).toHaveLength(2);
    await agent.run(request({ conversation: result.conversation, userMessage: 'Answer now.' }));
    expect(contentsOf(requests[2]!.body).map((c) => c.role)).toEqual([
      'user',
      'model',
      'user',
      'model',
      'user',
      'user',
    ]);
  });

  it('stops with `limit` when the answer is cut off at MAX_TOKENS', async () => {
    const { agent } = setup([
      { response: geminiTurn([textPart('People say')], { finishReason: 'MAX_TOKENS' }) },
    ]);
    const result = await agent.run(request());
    expect(result).toMatchObject({ stopped: 'limit', text: 'People say' });
  });

  it('never runs a function call cut off at MAX_TOKENS', async () => {
    const calls: string[] = [];
    const { agent } = setup([
      {
        response: geminiTurn([functionCallPart('search_transcripts', { query: 'cha' })], {
          finishReason: 'MAX_TOKENS',
        }),
      },
    ]);
    const err = await errorOf(agent.run(request({ tools: [searchTool(calls) as AgentTool] })));
    expect(err.kind).toBe('bad_output');
    expect(calls).toEqual([]);
  });

  it.each(['MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL'])(
    'sends a request again once after %s, without keeping the bad turn or its text',
    async (finishReason) => {
      const { agent, requests } = setup([
        { response: geminiTurn([textPart('Let me look.')], { finishReason }) },
        { response: geminiTurn([textPart('By the bed.')]) },
      ]);
      const req = request();
      const result = await agent.run(req);
      expect(result.text).toBe('By the bed.');
      expect(requests[1]!.body.contents).toEqual(requests[0]!.body.contents);
      expect(req.events.filter((e) => e.type === 'retry')).toEqual([
        { type: 'retry', discard: 'Let me look.'.length },
      ]);
      expect(streamedText(req.events)).toBe(result.text);
    },
  );

  it('a request sent again after a function turn puts its line break back', async () => {
    const { agent } = setup([
      {
        response: geminiTurn([
          textPart('Let me look.'),
          functionCallPart('search_transcripts', { query: 'x' }),
        ]),
      },
      {
        response: geminiTurn([textPart('Found it.')], { finishReason: 'MALFORMED_FUNCTION_CALL' }),
      },
      { response: geminiTurn([textPart('Found it.')]) },
    ]);
    const req = request();
    const result = await agent.run(req);
    expect(req.events.filter((e) => e.type === 'retry')).toEqual([
      { type: 'retry', discard: '\n\nFound it.'.length },
    ]);
    expect(result.text).toBe('Let me look.\n\nFound it.');
    expect(streamedText(req.events)).toBe(result.text);
  });

  it('gives `bad_output` after a second malformed function call in a row', async () => {
    const malformed = { response: geminiTurn([], { finishReason: 'MALFORMED_FUNCTION_CALL' }) };
    const { agent, requests } = setup([malformed, malformed]);
    const err = await errorOf(agent.run(request()));
    expect(err.kind).toBe('bad_output');
    expect(err.opts.detail).toBe('finish reason: MALFORMED_FUNCTION_CALL');
    expect(requests).toHaveLength(2);
  });

  it('gives `bad_output` for TOO_MANY_TOOL_CALLS', async () => {
    const { agent } = setup([
      {
        response: geminiTurn([functionCallPart('search_transcripts', { query: 'x' })], {
          finishReason: 'TOO_MANY_TOOL_CALLS',
        }),
      },
    ]);
    expect((await errorOf(agent.run(request()))).kind).toBe('bad_output');
  });

  it.each(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'])(
    'maps the finish reason %s, even after function calls, to `refused`',
    async (finishReason) => {
      const { agent } = setup([
        { response: geminiTurn([functionCallPart('search_transcripts', { query: 'x' })]) },
        { response: geminiTurn([textPart('I')], { finishReason }) },
      ]);
      const err = await errorOf(agent.run(request()));
      expect(err).toMatchObject({ kind: 'refused', retryable: false });
      expect(err.opts.detail).toBe(`finish reason: ${finishReason}`);
    },
  );

  it('maps a blocked prompt to `refused`', async () => {
    const { agent } = setup([
      {
        response: { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: geminiUsage(10, 0) },
      },
    ]);
    const err = await errorOf(agent.run(request()));
    expect(err).toMatchObject({ kind: 'refused', retryable: false });
    expect(err.opts.detail).toBe('prompt blocked: SAFETY');
  });

  it('maps an abort part-way through the stream to `aborted`', async () => {
    const controller = new AbortController();
    const { agent } = setup([
      heldGeminiReply(geminiTurn([textPart('A long answer that never ends.')]), () =>
        controller.abort(),
      ),
    ]);
    expect((await errorOf(agent.run(request({ signal: controller.signal })))).kind).toBe('aborted');
  });

  it('maps an abort while a tool runs to `aborted`, without another request', async () => {
    const controller = new AbortController();
    const slowTool: AgentTool<{ query: string }> = {
      ...searchTool(),
      run: async () => {
        controller.abort();
        return { content: 'late', activity: 'Searched' };
      },
    };
    const { agent, requests } = setup([
      { response: geminiTurn([functionCallPart('search_transcripts', { query: 'x' })]) },
      { response: geminiTurn([textPart('Never sent.')]) },
    ]);
    const err = await errorOf(
      agent.run(request({ signal: controller.signal, tools: [slowTool as AgentTool] })),
    );
    expect(err.kind).toBe('aborted');
    expect(requests).toHaveLength(1);
  });

  it.each([
    [401, 'UNAUTHENTICATED', 'auth'],
    [403, 'PERMISSION_DENIED', 'auth'],
    [402, 'FAILED_PRECONDITION', 'quota'],
    [429, 'RESOURCE_EXHAUSTED', 'rate_limit'],
    [500, 'INTERNAL', 'server'],
    [503, 'UNAVAILABLE', 'server'],
  ])('maps HTTP %i %s to %s, without the key', async (status, code, kind) => {
    const { agent } = setup([{ status, body: googleError(status, code, `bad key ${KEY}`) }]);
    const err = await errorOf(agent.run(request()));
    expect(err.kind).toBe(kind);
    expect(`${err.userMessage} ${err.opts.detail ?? ''}`).not.toContain(KEY);
  });

  it('maps a 400 with API_KEY_INVALID to `auth`, and shows the reason for another 400 without the key', async () => {
    const invalidKey = setup([
      {
        status: 400,
        body: googleError(400, 'INVALID_ARGUMENT', 'API key not valid.', [
          { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
        ]),
      },
    ]).agent;
    expect((await errorOf(invalidKey.run(request()))).kind).toBe('auth');

    const badRequest = setup([
      { status: 400, body: googleError(400, 'INVALID_ARGUMENT', `contents: key ${KEY} is wrong`) },
    ]).agent;
    const err = await errorOf(badRequest.run(request()));
    expect(err.kind).toBe('validation');
    expect(err.userMessage).toContain('[redacted]');
    expect(err.userMessage).not.toContain(KEY);
  });

  it('maps a failed fetch to `network` and a stream that fails part-way to `server`', async () => {
    const offline = setup([() => Promise.reject(new TypeError('Failed to fetch'))]).agent;
    expect((await errorOf(offline.run(request()))).kind).toBe('network');

    const broken = setup([
      {
        response: geminiTurn([textPart('Partial')]),
        error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' },
      },
    ]).agent;
    expect((await errorOf(broken.run(request()))).kind).toBe('server');
  });

  it("maps a TypeError fetch didn't raise to `unknown`, not `network` (audit BUG-10)", async () => {
    const fault = new TypeError("Cannot read properties of undefined (reading 'parts')");
    const { agent } = setup([() => Promise.reject(fault)]);
    const err = await errorOf(agent.run(request()));
    expect(err.kind).toBe('unknown');
    expect(err.userMessage).toBe(GEMINI_MESSAGES.unexpected);
    expect(err.retryable).toBe(false);
  });
});
