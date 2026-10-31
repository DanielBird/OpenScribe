import { describe, expect, it, vi } from 'vitest';
import { z } from '../../lib/zod';
import { claudeSse, type ClaudeSseOptions } from '../../testing/claudeSse';
import { ProviderError } from '../errors';
import {
  CLAUDE_FALLBACK_BETA,
  CLAUDE_MESSAGES,
  createClaudeProvider,
  verifyClaudeKey,
} from './claude';

const KEY = 'test-key-claude-123';
const Schema = z.object({ translations: z.array(z.object({ id: z.string(), text: z.string() })) });
const OUTPUT = { translations: [{ id: 't1', text: 'Hello.' }] };
const TEXT = JSON.stringify(OUTPUT);

interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A streamed reply that ends as `body` does. */
const sse = (body: unknown, opts?: ClaudeSseOptions) =>
  new Response(claudeSse(body, opts), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: TEXT }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  stop_details: null,
  usage: { input_tokens: 10, output_tokens: 20 },
  ...overrides,
});

const FALLBACK = {
  type: 'fallback',
  from: { model: 'claude-opus-5-5' },
  to: { model: 'claude-opus-5' },
};

const apiError = (type: string, msg: string) => ({ type: 'error', error: { type, message: msg } });

/** A provider whose requests are answered by `reply`; returns the requests it saw. */
function setup(
  reply: (seen: Seen, signal: AbortSignal | undefined) => Response | Promise<Response>,
) {
  const seen: Seen[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: Seen = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    };
    seen.push(request);
    return reply(request, init?.signal ?? undefined);
  });
  const provider = createClaudeProvider({
    apiKey: ` ${KEY} `,
    model: 'claude-opus-5-5',
    fetch,
    maxRetries: 0,
  });
  return { provider, seen, fetch };
}

const request = (signal?: AbortSignal) => ({
  system: 'Translate.',
  input: '{"segments":[]}',
  schema: Schema,
  schemaName: 'translation_batch',
  signal,
});

async function errorOf(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    return err as ProviderError;
  }
  throw new Error('expected a ProviderError');
}

describe('createClaudeProvider', () => {
  it('returns the parsed output', async () => {
    const { provider } = setup(() => sse(message()));
    expect(provider.id).toBe('claude');
    expect(provider.model).toBe('claude-opus-5-5');
    await expect(provider.generateStructured(request())).resolves.toEqual(OUTPUT);
  });

  it('streams, with structured output, medium effort and the refusal fallback', async () => {
    const { provider, seen } = setup(() => sse(message()));
    await provider.generateStructured({ ...request(), maxOutputTokens: 4000 });

    const [req] = seen;
    expect(req!.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(req!.headers.get('x-api-key')).toBe(KEY); // trimmed
    expect(req!.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(req!.headers.get('anthropic-beta')).toContain(CLAUDE_FALLBACK_BETA);
    expect(req!.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      stream: true,
      system: 'Translate.',
      messages: [{ role: 'user', content: '{"segments":[]}' }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false } },
      },
      fallbacks: 'default',
    });
    expect(req!.body).not.toHaveProperty('thinking');
    expect(req!.url).not.toContain(KEY);
  });

  it('defaults max_tokens to 16000', async () => {
    const { provider, seen } = setup(() => sse(message()));
    await provider.generateStructured(request());
    expect(seen[0]!.body.max_tokens).toBe(16000);
  });

  it('reads the text after an empty thinking block', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig-1' };
    const { provider } = setup(() =>
      sse(message({ content: [thinking, { type: 'text', text: TEXT }] })),
    );
    await expect(provider.generateStructured(request())).resolves.toEqual(OUTPUT);
  });

  it('reads the text after a fallback block', async () => {
    const { provider } = setup(() =>
      sse(message({ model: 'claude-opus-5', content: [FALLBACK, { type: 'text', text: TEXT }] })),
    );
    await expect(provider.generateStructured(request())).resolves.toEqual(OUTPUT);
  });

  it('joins the text across a fallback part-way through the reply', async () => {
    // The declined part stays, and the fallback model continues it in a new text block.
    const content = [
      { type: 'text', text: TEXT.slice(0, 10) },
      FALLBACK,
      { type: 'text', text: TEXT.slice(10) },
    ];
    const { provider } = setup(() => sse(message({ content })));
    await expect(provider.generateStructured(request())).resolves.toEqual(OUTPUT);
  });

  it.each([
    ['before any output', []],
    ['part-way through the reply', [{ type: 'text', text: TEXT.slice(0, 15) }]],
  ])('maps a refusal %s to `refused` without reading the content', async (_, content) => {
    const { provider } = setup(() =>
      sse(
        message({
          content,
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' },
        }),
      ),
    );
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe('refused');
    expect(err.userMessage).toBe(CLAUDE_MESSAGES.refused);
    expect(err.retryable).toBe(false);
    expect(err.opts.detail).toBe('refusal: cyber');
  });

  it('maps a reply cut off at max_tokens to `bad_output`', async () => {
    const { provider } = setup(() =>
      sse(message({ content: [{ type: 'text', text: '{"transl' }], stop_reason: 'max_tokens' })),
    );
    expect((await errorOf(provider.generateStructured(request()))).kind).toBe('bad_output');
  });

  it.each([
    ['text that is not JSON', 'Here you go'],
    ['JSON of the wrong shape', '{"translations":[{"id":1}]}'],
  ])('maps %s to `bad_output`', async (_, text) => {
    const { provider } = setup(() => sse(message({ content: [{ type: 'text', text }] })));
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe('bad_output');
    expect(err.userMessage).toBe(CLAUDE_MESSAGES.badOutput);
  });

  it.each([
    ['overloaded_error', 'server', CLAUDE_MESSAGES.server],
    ['api_error', 'server', CLAUDE_MESSAGES.server],
    ['rate_limit_error', 'rate_limit', CLAUDE_MESSAGES.rateLimit],
    ['invalid_request_error', 'unknown', CLAUDE_MESSAGES.unexpected],
  ] as const)('maps a stream that fails with `%s` to `%s`', async (type, kind, userMessage) => {
    const partial = message({ content: [{ type: 'text', text: TEXT.slice(0, 15) }] });
    const { provider } = setup(() => sse(partial, { error: { type, message: 'stream failed' } }));
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe(kind);
    expect(err.userMessage).toBe(userMessage);
  });

  it.each([
    [401, apiError('authentication_error', 'invalid x-api-key'), 'auth', CLAUDE_MESSAGES.auth],
    [429, apiError('rate_limit_error', 'slow down'), 'rate_limit', CLAUDE_MESSAGES.rateLimit],
    [500, apiError('api_error', 'boom'), 'server', CLAUDE_MESSAGES.server],
    [529, apiError('overloaded_error', 'overloaded'), 'server', CLAUDE_MESSAGES.server],
    [
      400,
      apiError('billing_error', 'Your credit balance is too low'),
      'quota',
      CLAUDE_MESSAGES.quota,
    ],
  ] as const)('maps HTTP %i to `%s`', async (status, body, kind, userMessage) => {
    const { provider } = setup(() => json(status, body));
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe(kind);
    expect(err.userMessage).toBe(userMessage);
    expect(err.opts.status).toBe(status);
  });

  it("shows Anthropic's reason for a 400 and names the model for a 404", async () => {
    const bad = setup(() => json(400, apiError('invalid_request_error', 'max_tokens: too large.')));
    const badErr = await errorOf(bad.provider.generateStructured(request()));
    expect(badErr.kind).toBe('validation');
    expect(badErr.userMessage).toBe("Claude couldn't process the request: max_tokens: too large.");

    const missing = setup(() => json(404, apiError('not_found_error', 'model: x')));
    const missingErr = await errorOf(missing.provider.generateStructured(request()));
    expect(missingErr.kind).toBe('validation');
    expect(missingErr.userMessage).toContain('"claude-opus-5-5"');
  });

  it('never puts the key in an error', async () => {
    const { provider } = setup(() =>
      json(400, apiError('invalid_request_error', `bad key ${KEY} here`)),
    );
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.userMessage).not.toContain(KEY);
    expect(err.opts.detail ?? '').not.toContain(KEY);
    expect(err.message).not.toContain(KEY);
  });

  it('maps a failed connection to `network`', async () => {
    const { provider } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe('network');
    expect(err.userMessage).toBe(CLAUDE_MESSAGES.network);
  });

  it('maps an abort before the reply to `aborted`', async () => {
    const controller = new AbortController();
    const { provider } = setup(
      () =>
        new Promise<Response>((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
          controller.abort();
        }),
    );
    expect((await errorOf(provider.generateStructured(request(controller.signal)))).kind).toBe(
      'aborted',
    );
  });

  it('maps an abort part-way through the stream to `aborted`', async () => {
    const controller = new AbortController();
    // The reply sends its first events, then waits as a long reply does, until the request is aborted.
    const firstEvents = claudeSse(message()).split('event: content_block_delta')[0]!;
    const { provider } = setup((_, signal) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(firstEvents));
          signal?.addEventListener('abort', () =>
            stream.error(new DOMException('aborted', 'AbortError')),
          );
          setTimeout(() => controller.abort(), 0);
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    expect((await errorOf(provider.generateStructured(request(controller.signal)))).kind).toBe(
      'aborted',
    );
  });
});

describe('verifyClaudeKey', () => {
  const MODELS = { data: [], has_more: false, first_id: null, last_id: null };

  function check(answer: () => Response | Promise<Response>, key = ` ${KEY} `) {
    const seen: { url: string; method: string; headers: Headers }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
      });
      return answer();
    });
    const result = verifyClaudeKey(key, new AbortController().signal, { fetch, maxRetries: 0 });
    return { result, seen };
  }

  it('lists one model with the trimmed key', async () => {
    const { result, seen } = check(() => json(200, MODELS));
    expect(await result).toEqual({ ok: true, message: CLAUDE_MESSAGES.keyOk });
    expect(seen).toHaveLength(1);
    const req = seen[0]!;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(req.headers.get('x-api-key')).toBe(KEY);
  });

  it('asks for a key without calling the API when it is empty', async () => {
    const { result, seen } = check(() => json(200, MODELS), '  ');
    expect(await result).toEqual({ ok: false, message: CLAUDE_MESSAGES.keyEmpty });
    expect(seen).toHaveLength(0);
  });

  it.each([
    [401, apiError('authentication_error', 'invalid x-api-key'), CLAUDE_MESSAGES.keyInvalid],
    [429, apiError('rate_limit_error', 'Slow down.'), CLAUDE_MESSAGES.rateLimit],
    [500, apiError('api_error', 'Oops.'), CLAUDE_MESSAGES.server],
  ])('explains a %i', async (status, body, message) => {
    const { result } = check(() => json(status, body));
    expect(await result).toEqual({ ok: false, message });
  });

  it('says when Claude cannot be reached', async () => {
    const { result } = check(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await result).toEqual({ ok: false, message: CLAUDE_MESSAGES.network });
  });

  it('never puts the key in the message', async () => {
    const { result } = check(() =>
      json(403, apiError('permission_error', `Key ${KEY} may not list models.`)),
    );
    const { ok, message } = await result;
    expect(ok).toBe(false);
    expect(message).not.toContain(KEY);
  });

  it('rejects when cancelled', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
          controller.abort();
        }),
    );
    const result = verifyClaudeKey(KEY, controller.signal, { fetch, maxRetries: 0 });
    expect((await errorOf(result)).kind).toBe('aborted');
  });
});
