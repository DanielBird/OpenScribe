import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmProviderId } from '../domain/transcript';
import { ProviderError } from '../providers/errors';
import { setLlmProviderFactoryForTests } from '../providers/index';
import type { LlmProvider, StructuredRequest } from '../providers/llm/types';
import { saveLastTranscript } from '../storage/idb';
import { makeDoc, makeLargeDoc } from '../testing/transcriptDoc';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';
import { useTranslationStore } from './translation';

vi.mock('../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));
const save = vi.mocked(saveLastTranscript);

interface Call {
  segments: string[];
  signal: AbortSignal | undefined;
  answer: (reply?: unknown) => void;
  fail: (err: unknown) => void;
}

/**
 * Providers whose requests wait until the test answers them (`calls[n].answer()` translates every
 * segment as "EN <id>"). `created` records the arguments each provider was made with.
 */
function fakeProviders() {
  const calls: Call[] = [];
  const created: { id: LlmProviderId; apiKey: string; model: string }[] = [];
  setLlmProviderFactoryForTests((id, apiKey, model): LlmProvider => {
    created.push({ id, apiKey, model });
    return {
      id,
      model,
      generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
        const segments = (JSON.parse(req.input) as { segments: { id: string }[] }).segments.map(
          (s) => s.id,
        );
        return new Promise<T>((resolve, reject) => {
          calls.push({
            segments,
            signal: req.signal,
            answer: (reply) =>
              resolve(
                (reply ?? {
                  translations: segments.map((id) => ({ id, text: `EN ${id}` })),
                }) as T,
              ),
            fail: reject,
          });
        });
      },
    };
  });
  return { calls, created };
}

/** Answers every request as it arrives until the run ends. */
async function answerAll(calls: Call[], from = 0) {
  for (let i = from; i < 20; i++) {
    await flushPromises();
    if (!calls[i]) return;
    calls[i]!.answer();
  }
}

async function withDoc(doc = makeDoc()) {
  await useTranscriptStore().setDoc(doc);
  save.mockClear();
  return doc;
}

const beforeUnloadPrevented = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('translation store', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
    useSettingsStore().claudeKey = ' test-key ';
  });

  afterEach(() => {
    useTranslationStore().$dispose();
    useTranscriptStore().$dispose();
    setLlmProviderFactoryForTests(null);
    vi.restoreAllMocks();
  });

  it('translates, saves the English version and shows it', async () => {
    const { calls, created } = fakeProviders();
    const doc = await withDoc();
    const store = useTranslationStore();

    const running = store.start('claude', 'claude-sonnet-5-5');
    expect(store.status).toBe('running'); // synchronously
    expect(store.isRunning).toBe(true);
    await answerAll(calls);
    await running;

    expect(created).toEqual([{ id: 'claude', apiKey: 'test-key', model: 'claude-sonnet-5-5' }]);
    const transcript = useTranscriptStore();
    const en = transcript.doc?.translations.en;
    expect(en).toMatchObject({ provider: 'claude', model: 'claude-sonnet-5-5' });
    expect(en?.texts).toEqual(Object.fromEntries(doc.turns.map((t) => [t.id, `EN ${t.id}`])));
    expect(new Date(en!.createdAt).toISOString()).toBe(en!.createdAt);
    expect(transcript.view).toBe('en');
    expect(save).toHaveBeenCalledOnce();
    expect(store.status).toBe('idle');
    expect(store.progress).toBeNull();
    expect(store.error).toBeNull();
  });

  it('remembers the provider and model for next time', async () => {
    const { calls } = fakeProviders();
    useSettingsStore().geminiKey = 'test-key';
    await withDoc();
    const store = useTranslationStore();
    const running = store.start('gemini', 'gemini-3.6-flash');
    const settings = useSettingsStore();
    expect(settings.translationProvider).toBe('gemini');
    expect(settings.translationModel).toBe('gemini-3.6-flash');
    await answerAll(calls);
    await running;
  });

  it('reports progress batch by batch', async () => {
    const { calls } = fakeProviders();
    await withDoc(makeLargeDoc(130));
    const store = useTranslationStore();
    const running = store.start('claude', 'claude-opus-5-5');

    await flushPromises();
    expect(store.progress).toEqual({ batch: 1, totalBatches: 3 });
    calls[0]!.answer();
    await flushPromises();
    expect(store.progress).toEqual({ batch: 2, totalBatches: 3 });
    await answerAll(calls, 1);
    await running;
    expect(store.progress).toBeNull();
  });

  it('asks for the key when it is missing, without calling the provider', async () => {
    const { created } = fakeProviders();
    useSettingsStore().claudeKey = '';
    await withDoc();
    const store = useTranslationStore();
    await store.start('claude', 'claude-opus-5-5');

    expect(store.status).toBe('error');
    expect(store.error?.kind).toBe('validation');
    expect(store.error?.userMessage).toBe('Enter your Claude API key first.');
    expect(created).toEqual([]);
  });

  it('keeps the finished turns after an error and resumes from the failed batch', async () => {
    const { calls, created } = fakeProviders();
    await withDoc(makeLargeDoc(130));
    const store = useTranslationStore();
    const running = store.start('claude', 'claude-opus-5-5');

    await flushPromises();
    calls[0]!.answer();
    await flushPromises();
    calls[1]!.fail(new ProviderError('auth', 'Bad key.'));
    await running;

    expect(store.status).toBe('error');
    expect(store.error?.kind).toBe('auth');
    expect(Object.keys(store.partial ?? {})).toHaveLength(60);
    expect(useTranscriptStore().doc?.translations.en).toBeUndefined();
    expect(save).not.toHaveBeenCalled();

    // The key is fixed on Setup, then Resume.
    useSettingsStore().claudeKey = 'new-key';
    const resumed = store.resume();
    expect(store.status).toBe('running');
    await answerAll(calls, 2);
    await resumed;

    expect(created.at(-1)).toEqual({ id: 'claude', apiKey: 'new-key', model: 'claude-opus-5-5' });
    expect(calls.map((c) => c.segments[0])).toEqual(['t1', 't61', 't61', 't121']);
    expect(Object.keys(useTranscriptStore().doc?.translations.en?.texts ?? {})).toHaveLength(130);
    expect(store.status).toBe('idle');
    expect(store.partial).toBeNull();
  });

  it('cancel aborts the request, saves nothing and ignores a late reply', async () => {
    const { calls } = fakeProviders();
    await withDoc();
    const store = useTranslationStore();
    const running = store.start('claude', 'claude-opus-5-5');
    await flushPromises();

    store.cancel();
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(store.status).toBe('cancelled');
    calls[0]!.answer();
    await running;

    expect(store.status).toBe('cancelled');
    expect(store.partial).toBeNull();
    expect(useTranscriptStore().doc?.translations.en).toBeUndefined();
    expect(save).not.toHaveBeenCalled();

    store.dismiss();
    expect(store.status).toBe('idle');
  });

  it('stops when another transcript replaces the doc', async () => {
    const { calls } = fakeProviders();
    await withDoc();
    const store = useTranslationStore();
    const running = store.start('claude', 'claude-opus-5-5');
    await flushPromises();

    await useTranscriptStore().setDoc(makeDoc({ id: 'next' }));
    await flushPromises();
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(store.status).toBe('idle');
    calls[0]!.answer();
    await running;
    expect(useTranscriptStore().doc?.translations.en).toBeUndefined();
  });

  it('clears an error that belongs to a replaced doc', async () => {
    const { calls } = fakeProviders();
    await withDoc();
    const store = useTranslationStore();
    const running = store.start('claude', 'claude-opus-5-5');
    await flushPromises();
    calls[0]!.fail(new ProviderError('server', 'Down.'));
    await running;
    expect(store.status).toBe('error');

    await useTranscriptStore().setDoc(makeDoc({ id: 'next' }));
    await flushPromises();
    expect(store.status).toBe('idle');
    expect(store.error).toBeNull();
    expect(store.partial).toBeNull();
  });

  it('ignores start while running, and resume unless there was an error', async () => {
    const { calls, created } = fakeProviders();
    await withDoc();
    const store = useTranslationStore();
    await store.resume();
    expect(created).toHaveLength(0);

    const running = store.start('claude', 'claude-opus-5-5');
    await store.start('gemini', 'gemini-3.8-flash');
    expect(created).toHaveLength(1);
    await answerAll(calls);
    await running;
  });

  it('does nothing without a doc', async () => {
    const { created } = fakeProviders();
    const store = useTranslationStore();
    await store.start('claude', 'claude-opus-5-5');
    expect(store.status).toBe('idle');
    expect(created).toHaveLength(0);
  });

  it('turns an unexpected failure into an error', async () => {
    setLlmProviderFactoryForTests(() => {
      throw new Error('boom');
    });
    await withDoc();
    const store = useTranslationStore();
    await store.start('claude', 'claude-opus-5-5');
    expect(store.status).toBe('error');
    expect(store.error?.kind).toBe('unknown');
  });

  it("keeps the browser's leave-page warning up only while running", async () => {
    const { calls } = fakeProviders();
    await withDoc();
    const store = useTranslationStore();
    expect(beforeUnloadPrevented()).toBe(false);
    const running = store.start('claude', 'claude-opus-5-5');
    expect(beforeUnloadPrevented()).toBe(true);
    await answerAll(calls);
    await running;
    expect(beforeUnloadPrevented()).toBe(false);

    const again = store.start('claude', 'claude-opus-5-5');
    await flushPromises();
    store.cancel();
    expect(beforeUnloadPrevented()).toBe(false);
    calls.at(-1)!.answer();
    await again;
  });
});
