import { describe, expect, it, vi } from 'vitest';
import { createCorpusReader } from '../../features/agent/corpus';
import { createAgentTools, createBudget } from '../../features/agent/tools';
import { SummaryOutputSchema } from '../../features/summary/schema';
import { z } from '../../lib/zod';
import { geminiSseEvents, type GeminiSseOptions } from '../../testing/geminiSse';
import { ProviderError } from '../errors';
import { createGeminiProvider, GEMINI_MESSAGES, toGeminiSchema, verifyGeminiKey } from './gemini';

const KEY = 'test-key-gemini-123';
const Schema = z.object({ translations: z.array(z.object({ id: z.string(), text: z.string() })) });
const OUTPUT = { translations: [{ id: 't1', text: 'Hello.' }] };

interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const reply = (text: string, finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
});

/** A streamed reply as Google sends it: each event in its own network read. */
function sse(response: unknown, opts?: GeminiSseOptions, events = geminiSseEvents(response, opts)) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const quotaFailure = (quotaId: string) => ({
  '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
  violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_requests', quotaId }],
});

const googleError = (
  code: number,
  status: string,
  message: string,
  reason?: string,
  details: readonly unknown[] = [],
) => ({
  error: {
    code,
    message,
    status,
    ...(reason || details.length > 0
      ? {
          details: [
            ...(reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] : []),
            ...details,
          ],
        }
      : {}),
  },
});

function setup(answer: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: Seen = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      signal: init?.signal ?? undefined,
    };
    seen.push(request);
    return answer(request);
  });
  const provider = createGeminiProvider({
    apiKey: ` ${KEY} `,
    model: 'gemini-3.8-flash',
    fetch,
    maxRetries: 0,
  });
  return { provider, seen };
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

describe('createGeminiProvider', () => {
  it('returns the parsed output', async () => {
    const { provider } = setup(() => sse(reply(JSON.stringify(OUTPUT))));
    expect(provider.id).toBe('gemini');
    await expect(provider.generateStructured(request())).resolves.toEqual(OUTPUT);
  });

  it('joins a reply streamed in several chunks, leaving out thought parts', async () => {
    const long = {
      translations: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, text: 'Ä'.repeat(50) })),
    };
    const { provider } = setup(() =>
      sse({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'Planning the reply…', thought: true },
                { text: JSON.stringify(long) },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 90, thoughtsTokenCount: 5 },
      }),
    );
    await expect(provider.generateStructured(request())).resolves.toEqual(long);
  });

  it('streams, asking for JSON matching the schema at the set thinking level, with the key in a header', async () => {
    const { provider, seen } = setup(() => sse(reply(JSON.stringify(OUTPUT))));
    await provider.generateStructured(request());

    const [req] = seen;
    expect(req!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
    );
    expect(req!.headers.get('x-goog-api-key')).toBe(KEY);
    expect(req!.url).not.toContain(KEY);
    expect(req!.body).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: '{"segments":[]}' }] }],
      systemInstruction: { parts: [{ text: 'Translate.' }] },
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: toGeminiSchema(Schema),
        maxOutputTokens: 16000,
        thinkingConfig: { thinkingLevel: 'MEDIUM' },
      },
    });
  });

  it('sends JSON Schema without `$schema`', () => {
    const schema = toGeminiSchema(Schema);
    expect(schema).not.toHaveProperty('$schema');
    expect(schema).toMatchObject({ type: 'object', required: ['translations'] });
  });

  it('sends the summary schema in a form Gemini documents: no $schema/$ref/$defs, null as a type', () => {
    const text = JSON.stringify(toGeminiSchema(SummaryOutputSchema));
    expect(text).not.toMatch(/"\$(schema|ref|defs)"/);
    expect(text).not.toContain('"anyOf"');
    const respondents = toGeminiSchema(SummaryOutputSchema).properties as Record<
      string,
      { items: { properties: Record<string, unknown> } }
    >;
    expect(respondents.respondents!.items.properties.speakerId).toMatchObject({
      type: ['string', 'null'],
      description: expect.stringContaining('null for someone who is only mentioned'),
    });
  });

  it('writes exclusive bounds as inclusive ones on integers, and drops them on numbers', () => {
    const schema = toGeminiSchema(
      z.object({ page: z.number().int().positive(), score: z.number().positive().lt(1) }),
    );
    const text = JSON.stringify(schema);
    expect(text).not.toContain('exclusive');
    const { page, score } = schema.properties as Record<string, Record<string, unknown>>;
    expect(page).toMatchObject({ type: 'integer', minimum: 1 });
    expect(score).toEqual({ type: 'number' });
  });

  it('sends the project agent tools without exclusive bounds', () => {
    const tools = createAgentTools(createCorpusReader([], new Map()), createBudget());
    const text = JSON.stringify(tools.map((t) => toGeminiSchema(t.input)));
    expect(text).not.toMatch(/"\$(schema|ref|defs)"|exclusive/);
  });

  it('maps a blocked prompt to `refused`', async () => {
    const { provider } = setup(() => sse({ promptFeedback: { blockReason: 'SAFETY' } }));
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe('refused');
    expect(err.userMessage).toBe(GEMINI_MESSAGES.refused);
    expect(err.retryable).toBe(false);
  });

  it.each(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'])(
    'maps a %s finish to `refused`',
    async (finish) => {
      const { provider } = setup(() => sse(reply('', finish)));
      expect((await errorOf(provider.generateStructured(request()))).kind).toBe('refused');
    },
  );

  it('maps a reply cut off at MAX_TOKENS to `bad_output`', async () => {
    const { provider } = setup(() => sse(reply('{"transl', 'MAX_TOKENS')));
    expect((await errorOf(provider.generateStructured(request()))).kind).toBe('bad_output');
  });

  it.each([
    ['text that is not JSON', 'Here you go'],
    ['JSON of the wrong shape', '{"translations":[{"id":1}]}'],
  ])('maps %s to `bad_output`', async (_, text) => {
    const { provider } = setup(() => sse(reply(text)));
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe('bad_output');
    expect(err.userMessage).toBe(GEMINI_MESSAGES.badOutput);
  });

  it('maps a stream event it cannot read to `bad_output`', async () => {
    const { provider } = setup(() => sse(null, undefined, ['data: {"candidates": [\r\n\r\n']));
    expect((await errorOf(provider.generateStructured(request()))).kind).toBe('bad_output');
  });

  it.each([
    [400, googleError(400, 'INVALID_ARGUMENT', 'API key not valid.', 'API_KEY_INVALID'), 'auth'],
    [403, googleError(403, 'PERMISSION_DENIED', 'Denied.'), 'auth'],
    [402, googleError(402, 'PAYMENT_REQUIRED', 'Prepay credits depleted.'), 'quota'],
    [429, googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded.'), 'rate_limit'],
    [500, googleError(500, 'INTERNAL', 'Boom.'), 'server'],
    [404, googleError(404, 'NOT_FOUND', 'No such model.'), 'validation'],
  ] as const)('maps HTTP %i to `%s`', async (status, body, kind) => {
    const { provider } = setup(() => json(status, body));
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe(kind);
    expect(err.opts.status).toBe(status);
  });

  it.each([
    ['a daily quota', [quotaFailure('GenerateRequestsPerDayPerProjectPerModel')], 'quota'],
    [
      'a per-minute limit',
      [quotaFailure('GenerateRequestsPerMinutePerProjectPerModel')],
      'rate_limit',
    ],
  ] as const)('maps a 429 for %s to `%s`', async (_, details, kind) => {
    const { provider } = setup(() =>
      json(429, googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded.', undefined, details)),
    );
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe(kind);
    if (kind === 'quota') expect(err.userMessage).toBe(GEMINI_MESSAGES.quota);
  });

  it('maps a 429 with the code `quota_exceeded` to `quota`', async () => {
    const { provider } = setup(() =>
      json(429, {
        error: { code: 'quota_exceeded', message: 'You have exceeded your daily quota.' },
      }),
    );
    expect((await errorOf(provider.generateStructured(request()))).kind).toBe('quota');
  });

  it.each([
    ['a rate limit', [], 'rate_limit'],
    ['a daily quota', [quotaFailure('GenerateRequestsPerDayPerProjectPerModel')], 'quota'],
  ] as const)('maps %s inside the stream to `%s`, without the key', async (_, details, kind) => {
    const { provider } = setup(() =>
      sse(reply('{"translations":'), {
        error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: `Slow down, ${KEY}.`, details },
      }),
    );
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe(kind);
    expect(err.opts.status).toBe(429);
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(err.opts.detail ?? '').not.toContain(KEY);
  });

  it("shows Google's reason for another 400, without the key", async () => {
    const { provider } = setup(() =>
      json(400, googleError(400, 'INVALID_ARGUMENT', `Bad field near ${KEY}.`)),
    );
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe('validation');
    expect(err.userMessage).toMatch(/^Gemini couldn't process the request: Bad field near/);
    expect(err.userMessage).not.toContain(KEY);
    expect(err.opts.detail ?? '').not.toContain(KEY);
  });

  it('maps a failed connection to `network`', async () => {
    const { provider } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe('network');
    expect(err.userMessage).toBe(GEMINI_MESSAGES.network);
    expect(err.retryable).toBe(true);
  });

  it('maps a connection lost part-way through the stream to `network`', async () => {
    const [first] = geminiSseEvents(reply('{"translations":'));
    const { provider } = setup(() => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(first));
          // What Chromium's body reader rejects with when the connection drops.
          setTimeout(() => stream.error(new TypeError('network error')), 0);
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe('network');
    expect(err.userMessage).toBe(GEMINI_MESSAGES.network);
  });

  // Audit BUG-10: fetch's failures are TypeErrors, but so is a fault in the SDK or the adapter.
  it("maps a TypeError fetch didn't raise to `unknown`, which isn't retried", async () => {
    // `parts` isn't a list, so reading the chunk throws a TypeError.
    const chunk = { candidates: [{ content: { role: 'model', parts: { text: 'Hi' } } }] };
    const { provider } = setup(() => sse({}, {}, [`data: ${JSON.stringify(chunk)}\r\n\r\n`]));
    const err = await errorOf(provider.generateStructured(request()));
    expect(err.kind).toBe('unknown');
    expect(err.userMessage).toBe(GEMINI_MESSAGES.unexpected);
    expect(err.retryable).toBe(false);
    expect(err.opts.detail).toMatch(/iterable|not a function/);
  });

  it('maps any TypeError to `network` while the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    try {
      const { provider } = setup(() => Promise.reject(new TypeError('Load failed')));
      const err = await errorOf(provider.generateStructured(request()));
      expect(err.kind).toBe('network');
      expect(err.userMessage).toBe(GEMINI_MESSAGES.network);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('maps an abort to `aborted`', async () => {
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
    const [first] = geminiSseEvents(reply('{"translations":'));
    const { provider } = setup((seen) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(first));
          // The rest never comes; the abort ends the stream, as fetch does.
          seen.signal?.addEventListener('abort', () =>
            stream.error(new DOMException('aborted', 'AbortError')),
          );
          setTimeout(() => controller.abort(), 0);
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    expect((await errorOf(provider.generateStructured(request(controller.signal)))).kind).toBe(
      'aborted',
    );
  });
});

describe('verifyGeminiKey', () => {
  const MODELS = { models: [{ name: 'models/gemini-3.8-flash' }] };

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
    const result = verifyGeminiKey(key, new AbortController().signal, { fetch, maxRetries: 0 });
    return { result, seen };
  }

  it('lists one model with the trimmed key, which stays out of the URL', async () => {
    const { result, seen } = check(() => json(200, MODELS));
    expect(await result).toEqual({ ok: true, message: GEMINI_MESSAGES.keyOk });
    expect(seen).toHaveLength(1);
    const req = seen[0]!;
    expect(req.method).toBe('GET');
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models',
    );
    expect(url.searchParams.get('pageSize')).toBe('1');
    expect(req.url).not.toContain(KEY);
    expect(req.headers.get('x-goog-api-key')).toBe(KEY);
  });

  it('asks for a key without calling the API when it is empty', async () => {
    const { result, seen } = check(() => json(200, MODELS), '  ');
    expect(await result).toEqual({ ok: false, message: GEMINI_MESSAGES.keyEmpty });
    expect(seen).toHaveLength(0);
  });

  it.each([
    [
      400,
      googleError(400, 'INVALID_ARGUMENT', 'API key not valid.', 'API_KEY_INVALID'),
      GEMINI_MESSAGES.keyInvalid,
    ],
    [403, googleError(403, 'PERMISSION_DENIED', 'Denied.'), GEMINI_MESSAGES.keyInvalid],
    [429, googleError(429, 'RESOURCE_EXHAUSTED', 'Slow down.'), GEMINI_MESSAGES.rateLimit],
    [500, googleError(500, 'INTERNAL', 'Oops.'), GEMINI_MESSAGES.server],
  ])('explains a %i', async (status, body, message) => {
    const { result } = check(() => json(status, body));
    expect(await result).toEqual({ ok: false, message });
  });

  it('says when Gemini cannot be reached', async () => {
    const { result } = check(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await result).toEqual({ ok: false, message: GEMINI_MESSAGES.network });
  });

  it('never puts the key in the message', async () => {
    const { result } = check(() =>
      json(400, googleError(400, 'INVALID_ARGUMENT', `Bad request for ${KEY}.`)),
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
    const result = verifyGeminiKey(KEY, controller.signal, { fetch, maxRetries: 0 });
    expect((await errorOf(result)).kind).toBe('aborted');
  });
});
