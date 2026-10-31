import { describe, expect, it, vi } from 'vitest';
import error400MissingFile from '../../../../fixtures/elevenlabs/error-400-missing-file.json';
import error401Permissions from '../../../../fixtures/elevenlabs/error-401-missing-permissions.json';
import error401 from '../../../../fixtures/elevenlabs/error-401.json';
import error429 from '../../../../fixtures/elevenlabs/error-429.json';
import twoSpeakers from '../../../../fixtures/elevenlabs/two-speakers-short.json';
import { ProviderError } from '../../errors';
import type { TranscriptionInput, TranscriptionProgress } from '../types';
import { ELEVENLABS_LIMITS } from './limits';
import { createElevenLabsProvider } from './provider';
import type { HttpResult, Transport } from './transport';

const SENTINEL_KEY = 'sk_test_SENTINEL_0123456789';

const input = (overrides: Partial<TranscriptionInput> = {}): TranscriptionInput => ({
  file: new File(['0123456789'], 'meeting.wav', { type: 'audio/wav' }),
  apiKey: `  ${SENTINEL_KEY}\n`,
  languageHint: 'auto',
  numSpeakers: null,
  zeroRetention: false,
  keyterms: [],
  ...overrides,
});

type PostArgs = Parameters<Transport['post']>;

/** A transport that records calls, simulates upload progress, and answers with `respond`. */
function fakeTransport(respond: (...args: PostArgs) => Promise<HttpResult>, simulateUpload = true) {
  const calls: { url: string; body: FormData; headers: Record<string, string> }[] = [];
  const transport: Transport = {
    async post(url, body, headers, opts) {
      calls.push({ url, body, headers });
      if (simulateUpload) {
        opts.onUploadProgress?.(5, 10);
        opts.onUploadProgress?.(10, 10);
        opts.onUploadDone?.();
      }
      return respond(url, body, headers, opts);
    },
    get: () => Promise.reject(new Error('not used')),
  };
  return { transport, calls };
}

const ok = (json: unknown) => async () => ({ status: 200, bodyText: JSON.stringify(json) });

async function run(transport: Transport, overrides: Partial<TranscriptionInput> = {}) {
  const progress: TranscriptionProgress[] = [];
  const result = await createElevenLabsProvider(transport).transcribe(input(overrides), {
    signal: new AbortController().signal,
    onProgress: (p) => progress.push(p),
  });
  return { result, progress };
}

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    return err as ProviderError;
  }
  throw new Error('expected a ProviderError');
}

describe('createElevenLabsProvider', () => {
  it('describes itself', () => {
    const provider = createElevenLabsProvider(fakeTransport(ok(twoSpeakers)).transport);
    expect(provider.id).toBe('elevenlabs');
    expect(provider.model).toBe('scribe_v2');
    expect(provider.limits).toEqual(ELEVENLABS_LIMITS);
    expect(provider.verifyKey).toBeTypeOf('function');
  });

  it('uploads, reports progress in order, and returns normalized tokens', async () => {
    const { transport, calls } = fakeTransport(ok(twoSpeakers));
    const { result, progress } = await run(transport);

    expect(progress).toEqual([
      { phase: 'uploading', loaded: 0, total: 10 },
      { phase: 'uploading', loaded: 5, total: 10 },
      { phase: 'uploading', loaded: 10, total: 10 },
      { phase: 'processing' },
    ]);
    expect(result.languageCode).toBe('deu');
    expect(result.tokens).toHaveLength(70);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(calls[0]?.headers).toEqual({ 'xi-api-key': SENTINEL_KEY }); // trimmed, header only
    expect(calls[0]?.body.get('model_id')).toBe('scribe_v2');
  });

  it('uses the zero-retention URL when asked', async () => {
    const { transport, calls } = fakeTransport(ok(twoSpeakers));
    await run(transport, { zeroRetention: true });
    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v1/speech-to-text?enable_logging=false');
  });

  it('still reports processing (once) if the transport never signals the end of the upload', async () => {
    const { transport } = fakeTransport(ok(twoSpeakers), false);
    const { progress } = await run(transport);
    expect(progress).toEqual([
      { phase: 'uploading', loaded: 0, total: 10 },
      { phase: 'processing' },
    ]);
  });

  it('rejects with the mapped error for a non-2xx response', async () => {
    const { transport } = fakeTransport(async () => ({
      status: 429,
      bodyText: JSON.stringify(error429),
    }));
    const err = await failure(run(transport));
    expect(err.kind).toBe('rate_limit');
    expect(err.opts.status).toBe(429);
  });

  it('rejects as aborted when the signal aborts during the request', async () => {
    const { transport } = fakeTransport(
      (_url, _body, _headers, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () =>
            reject(new ProviderError('aborted', 'Transcription cancelled.')),
          );
        }),
    );
    const controller = new AbortController();
    const promise = createElevenLabsProvider(transport).transcribe(input(), {
      signal: controller.signal,
      onProgress: vi.fn(),
    });
    controller.abort();
    expect((await failure(promise)).kind).toBe('aborted');
  });

  it('rejects as aborted if the signal fired just as the response arrived', async () => {
    const controller = new AbortController();
    const { transport } = fakeTransport(async () => {
      controller.abort();
      return { status: 200, bodyText: JSON.stringify(twoSpeakers) };
    });
    const promise = createElevenLabsProvider(transport).transcribe(input(), {
      signal: controller.signal,
      onProgress: vi.fn(),
    });
    expect((await failure(promise)).kind).toBe('aborted');
  });

  it('rejects with bad_output for a 200 that is not JSON', async () => {
    const { transport } = fakeTransport(async () => ({ status: 200, bodyText: '<html>' }));
    expect((await failure(run(transport))).kind).toBe('bad_output');
  });

  it('rejects with bad_output for JSON of the wrong shape', async () => {
    const { transport } = fakeTransport(ok({ transcripts: [] }));
    expect((await failure(run(transport))).kind).toBe('bad_output');
  });

  it('passes transport errors through', async () => {
    const { transport } = fakeTransport(() =>
      Promise.reject(new ProviderError('network', "Couldn't reach ElevenLabs.")),
    );
    expect((await failure(run(transport))).kind).toBe('network');
  });

  it('wraps unexpected exceptions as unknown', async () => {
    const { transport } = fakeTransport(() => Promise.reject(new TypeError('boom')));
    const err = await failure(run(transport));
    expect(err.kind).toBe('unknown');
    expect(err.opts.detail).toBe('boom');
  });

  describe('never leaks the API key', () => {
    const leaks = (err: ProviderError) =>
      [err.message, err.userMessage, err.opts.detail ?? '', String(err)].some((s) =>
        s.includes(SENTINEL_KEY),
      );

    it('when the server echoes it in a validation error', async () => {
      const { transport } = fakeTransport(async () => ({
        status: 422,
        bodyText: JSON.stringify({ detail: `Key ${SENTINEL_KEY} is not valid for this model.` }),
      }));
      const err = await failure(run(transport));
      expect(err.kind).toBe('validation');
      expect(err.userMessage).toContain('[redacted]');
      expect(leaks(err)).toBe(false);
    });

    it('when the server echoes it in an auth error code', async () => {
      const { transport } = fakeTransport(async () => ({
        status: 401,
        bodyText: JSON.stringify({ detail: { status: SENTINEL_KEY, message: SENTINEL_KEY } }),
      }));
      const err = await failure(run(transport));
      expect(err.kind).toBe('auth');
      expect(leaks(err)).toBe(false);
    });

    it('when an unexpected exception mentions it', async () => {
      const { transport } = fakeTransport(() =>
        Promise.reject(new Error(`header xi-api-key: ${SENTINEL_KEY}`)),
      );
      const err = await failure(run(transport));
      expect(leaks(err)).toBe(false);
    });
  });
});

describe('verifyKey (verification log V3)', () => {
  const answer = (status: number, json: unknown) => async () => ({
    status,
    bodyText: JSON.stringify(json),
  });
  const verify = (transport: Transport, key = SENTINEL_KEY, signal?: AbortSignal) => {
    const provider = createElevenLabsProvider(transport);
    if (!provider.verifyKey) throw new Error('verifyKey missing');
    return provider.verifyKey(key, signal);
  };

  it('sends a transcription request with no audio, with the trimmed key in the header only', async () => {
    const { transport, calls } = fakeTransport(answer(400, error400MissingFile), false);
    await verify(transport, `  ${SENTINEL_KEY} `);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(calls[0]?.headers).toEqual({ 'xi-api-key': SENTINEL_KEY });
    expect([...(calls[0]?.body.keys() ?? [])]).toEqual(['model_id']); // no file: nothing is transcribed
  });

  it('accepts the key when the only complaint is the missing audio (seen live)', async () => {
    const { transport } = fakeTransport(answer(400, error400MissingFile), false);
    expect(await verify(transport)).toEqual({
      ok: true,
      message: 'The key works with ElevenLabs Speech-to-Text.',
    });
  });

  it('rejects an unknown key (seen live: 401 invalid_api_key)', async () => {
    const { transport } = fakeTransport(answer(401, error401), false);
    expect(await verify(transport)).toEqual({
      ok: false,
      message: "ElevenLabs doesn't recognise this key. Check that you copied all of it.",
    });
  });

  it('explains a key without Speech-to-Text permission', async () => {
    const { transport } = fakeTransport(answer(401, error401Permissions), false);
    const result = await verify(transport);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("isn't allowed to use Speech-to-Text");
  });

  it('reports other answers with the normal error messages', async () => {
    const busy = fakeTransport(answer(429, error429), false);
    expect(await verify(busy.transport)).toEqual({
      ok: false,
      message: "ElevenLabs is busy or your plan's limit was reached. Try again in a minute.",
    });
    const offline = fakeTransport(
      () => Promise.reject(new ProviderError('network', "Couldn't reach ElevenLabs.")),
      false,
    );
    expect(await verify(offline.transport)).toEqual({
      ok: false,
      message: "Couldn't reach ElevenLabs.",
    });
  });

  it('does not call the API for an empty key', async () => {
    const { transport, calls } = fakeTransport(answer(400, error400MissingFile), false);
    expect(await verify(transport, '   ')).toEqual({ ok: false, message: 'Enter a key first.' });
    expect(calls).toHaveLength(0);
  });

  it('rejects when the check is cancelled', async () => {
    const { transport } = fakeTransport(
      () => Promise.reject(new ProviderError('aborted', 'Transcription cancelled.')),
      false,
    );
    const controller = new AbortController();
    controller.abort();
    expect((await failure(verify(transport, SENTINEL_KEY, controller.signal))).kind).toBe(
      'aborted',
    );
  });

  it('never shows the key, even if the server echoes it', async () => {
    const { transport } = fakeTransport(
      answer(403, {
        detail: { status: 'not_allowed', message: `Key ${SENTINEL_KEY} is blocked.` },
      }),
      false,
    );
    const result = await verify(transport);
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(SENTINEL_KEY);
    expect(result.message).toContain('[redacted]');
  });
});
