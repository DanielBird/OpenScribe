import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../providers/errors';
import type { LlmProvider, StructuredRequest } from '../../providers/llm/types';
import { makeDoc, makeLargeDoc } from '../../testing/transcriptDoc';
import { makeBatches } from './batching';
import {
  checkReply,
  TranslationError,
  translateTranscript,
  TRANSLATION_MESSAGES,
} from './translate';

interface Input {
  glossary: string[];
  context: { speaker: string; text: string }[];
  segments: { id: string; speaker: string; text: string }[];
}

type Reply = (input: Input, call: number) => unknown;

/** Translates every segment as "EN <id>" unless `reply` says otherwise. Records each request. */
function fakeProvider(reply?: Reply) {
  const requests: (StructuredRequest<unknown> & { parsed: Input })[] = [];
  const provider: LlmProvider = {
    id: 'claude',
    model: 'claude-opus-5-5',
    async generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
      const parsed = JSON.parse(req.input) as Input;
      requests.push({ ...(req as StructuredRequest<unknown>), parsed });
      const out = reply?.(parsed, requests.length - 1) ?? {
        translations: parsed.segments.map((s) => ({ id: s.id, text: `EN ${s.id}` })),
      };
      if (out instanceof Error) throw out;
      return out as T;
    },
  };
  return { provider, requests };
}

const allEnglish = (count: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`t${i + 1}`, `EN t${i + 1}`]));

/** 130 turns → batches of 60, 60 and 10. */
const bigDoc = () => makeLargeDoc(130);

async function translationError(p: Promise<unknown>): Promise<TranslationError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(TranslationError);
    return err as TranslationError;
  }
  throw new Error('expected a TranslationError');
}

describe('translateTranscript', () => {
  it('translates every turn, batch by batch, and reports progress', async () => {
    const { provider, requests } = fakeProvider();
    const onProgress = vi.fn();
    const texts = await translateTranscript(bigDoc(), provider, { onProgress });

    expect(texts).toEqual(allEnglish(130));
    expect(requests.map((r) => r.parsed.segments.length)).toEqual([60, 60, 10]);
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([
      { batch: 1, totalBatches: 3 },
      { batch: 2, totalBatches: 3 },
      { batch: 3, totalBatches: 3 },
    ]);
    expect(requests[0]!.schemaName).toBe('translation_batch');
  });

  it('sends the glossary, the source language and the current speaker names', async () => {
    const doc = makeDoc();
    const renamed = {
      ...doc,
      request: { ...doc.request, keyterms: ['Demant', 'Describe'] },
      speakers: doc.speakers.map((s, i) => (i === 0 ? { ...s, label: 'Interviewer' } : s)),
    };
    const { provider, requests } = fakeProvider();
    await translateTranscript(renamed, provider);

    expect(requests[0]!.system).toContain('from German into natural, faithful English.');
    expect(requests[0]!.parsed.glossary).toEqual(['Demant', 'Describe']);
    expect(requests[0]!.parsed.segments[0]).toEqual({
      id: 't1',
      speaker: 'Interviewer',
      text: doc.turns[0]!.text,
    });
  });

  it('returns trimmed texts', async () => {
    const { provider } = fakeProvider((input) => ({
      translations: input.segments.map((s) => ({ id: s.id, text: `  EN ${s.id}\n` })),
    }));
    const texts = await translateTranscript(makeDoc(), provider);
    expect(texts.t1).toBe('EN t1');
  });

  it('retries a batch once when an id is missing', async () => {
    const { provider, requests } = fakeProvider((input, call) =>
      call === 0
        ? { translations: input.segments.slice(1).map((s) => ({ id: s.id, text: 'x' })) }
        : undefined,
    );
    const texts = await translateTranscript(makeDoc(), provider);
    expect(requests).toHaveLength(2);
    expect(texts).toEqual(allEnglish(5));
  });

  it('retries a batch once when the reply is unreadable', async () => {
    const { provider, requests } = fakeProvider((_, call) =>
      call === 0 ? new ProviderError('bad_output', 'Unreadable.') : undefined,
    );
    await expect(translateTranscript(makeDoc(), provider)).resolves.toEqual(allEnglish(5));
    expect(requests).toHaveLength(2);
  });

  it('stops after a second failure with what was completed', async () => {
    // Batch 2 (calls 1 and 2) leaves out its first id both times.
    const { provider, requests } = fakeProvider((input, call) =>
      call === 1 || call === 2
        ? { translations: input.segments.slice(1).map((s) => ({ id: s.id, text: 'x' })) }
        : undefined,
    );
    const err = await translationError(translateTranscript(bigDoc(), provider));

    expect(requests).toHaveLength(3);
    expect(err.failedBatchIndex).toBe(1);
    expect(err.cause.kind).toBe('bad_output');
    expect(err.message).toBe(TRANSLATION_MESSAGES.incomplete);
    expect(err.cause.opts.detail).toBe('batch 2: missing id t61');
    expect(err.completed).toEqual(allEnglish(60));
  });

  it('resumes without repeating the batches already done', async () => {
    const done = allEnglish(60);
    const { provider, requests } = fakeProvider();
    const onProgress = vi.fn();
    const texts = await translateTranscript(bigDoc(), provider, { resumeFrom: done, onProgress });

    expect(texts).toEqual(allEnglish(130));
    expect(requests.map((r) => r.parsed.segments[0]!.id)).toEqual(['t61', 't121']);
    expect(onProgress.mock.calls.map(([p]) => p.batch)).toEqual([2, 3]);
  });

  it('translates a batch again when it was only partly done', async () => {
    const { provider, requests } = fakeProvider();
    await translateTranscript(makeDoc(), provider, { resumeFrom: { t1: 'Old.' } });
    expect(requests).toHaveLength(1);
  });

  it('stops at once, without a retry, on a provider error other than bad output', async () => {
    const limited = new ProviderError('rate_limit', 'Busy.');
    const { provider, requests } = fakeProvider((_, call) => (call === 1 ? limited : undefined));
    const err = await translationError(translateTranscript(bigDoc(), provider));

    expect(requests).toHaveLength(2);
    expect(err.cause).toBe(limited);
    expect(err.message).toBe('Busy.');
    expect(err.failedBatchIndex).toBe(1);
    expect(err.completed).toEqual(allEnglish(60));
  });

  it('wraps an unexpected error', async () => {
    const { provider } = fakeProvider(() => new Error('boom'));
    const err = await translationError(translateTranscript(makeDoc(), provider));
    expect(err.cause.kind).toBe('unknown');
    expect(err.cause.opts.detail).toBe('boom');
  });

  it('stops when the signal aborts during a request, and is not retried', async () => {
    const controller = new AbortController();
    const { provider, requests } = fakeProvider((_, call) => {
      if (call === 1) {
        controller.abort();
        return new ProviderError('aborted', 'Cancelled.');
      }
      return undefined;
    });
    const err = await translationError(
      translateTranscript(bigDoc(), provider, { signal: controller.signal }),
    );
    expect(requests).toHaveLength(2);
    expect(err.cause.kind).toBe('aborted');
    expect(err.completed).toEqual(allEnglish(60));
  });

  it('sends nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { provider, requests } = fakeProvider();
    const err = await translationError(
      translateTranscript(makeDoc(), provider, { signal: controller.signal }),
    );
    expect(requests).toHaveLength(0);
    expect(err.cause.kind).toBe('aborted');
  });

  it('passes the signal to the provider', async () => {
    const controller = new AbortController();
    const { provider, requests } = fakeProvider();
    await translateTranscript(makeDoc(), provider, { signal: controller.signal });
    expect(requests[0]!.signal).toBe(controller.signal);
  });

  it('returns an empty map for a transcript without turns', async () => {
    const { provider, requests } = fakeProvider();
    await expect(translateTranscript(makeDoc({ turns: [] }), provider)).resolves.toEqual({});
    expect(requests).toHaveLength(0);
  });
});

describe('checkReply', () => {
  const [batch] = makeBatches(makeDoc().turns.slice(0, 2)); // t1, t2

  it('accepts exactly the requested ids', () => {
    const reply = {
      translations: [
        { id: 't2', text: 'B' },
        { id: 't1', text: 'A' },
      ],
    };
    expect(checkReply(batch!, reply)).toEqual({ t1: 'A', t2: 'B' });
  });

  it.each([
    ['a missing id', [{ id: 't1', text: 'A' }], 'missing id t2'],
    [
      'an extra id',
      [
        { id: 't1', text: 'A' },
        { id: 't2', text: 'B' },
        { id: 't3', text: 'C' },
      ],
      'unexpected id t3',
    ],
    [
      'a duplicate id',
      [
        { id: 't1', text: 'A' },
        { id: 't1', text: 'A' },
        { id: 't2', text: 'B' },
      ],
      'duplicate id t1',
    ],
    [
      'an empty text',
      [
        { id: 't1', text: ' ' },
        { id: 't2', text: 'B' },
      ],
      'empty text for t1',
    ],
  ])('rejects %s', (_, translations, detail) => {
    try {
      checkReply(batch!, { translations });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind).toBe('bad_output');
      expect((err as ProviderError).opts.detail).toBe(`batch 1: ${detail}`);
    }
  });
});
