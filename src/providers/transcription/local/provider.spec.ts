import { describe, expect, it } from 'vitest';
import { ProviderError, technicalDetails } from '../../errors';
import type { TranscriptionInput, TranscriptionProgress } from '../types';
import {
  LOCAL_ERROR_KINDS,
  LocalSttError,
  type LocalSttBridge,
  type LocalSttResult,
} from './bridge';
import { createLocalProvider } from './provider';

const RESULT: LocalSttResult = {
  language: null,
  durationSec: 5,
  words: [
    { text: 'Um', start: 0.1, end: 0.2, confidence: 1 },
    { text: 'hello', start: 0.3, end: 0.6, confidence: 1 },
    { text: 'there.', start: 0.7, end: 1.0, confidence: 1 },
    { text: 'Hi.', start: 2.0, end: 2.3, confidence: 1 },
  ],
  speakerSegments: [
    { speaker: 0, start: 0, end: 1.2 },
    { speaker: 1, start: 1.8, end: 2.5 },
  ],
  timings: {
    decodeSec: 0.1,
    wordsSec: 1,
    speakersSec: 0.5,
    totalSec: 1.1,
    threads: 8,
    peakMemoryBytes: 900_000_000,
  },
};

const input = (overrides: Partial<TranscriptionInput> = {}): TranscriptionInput => ({
  file: new File(['RIFF'], 'interview.m4a', { type: 'audio/mp4' }),
  apiKey: '',
  languageHint: 'en',
  numSpeakers: null,
  zeroRetention: false,
  keyterms: [],
  cleanUp: true,
  ...overrides,
});

/** A bridge that reports `progress`, then gives `outcome` (a result, or an error to throw). */
function fakeBridge(
  outcome: LocalSttResult | unknown = RESULT,
  progress: TranscriptionProgress[] = [],
): LocalSttBridge & { calls: { file: File; languageHint: string }[] } {
  const calls: { file: File; languageHint: string }[] = [];
  return {
    calls,
    status: async () => ({
      state: 'ready',
      pack: { id: 'p', version: '1', languages: ['en'], maxSpeakers: 8, downloadBytes: 1 },
    }),
    async transcribe(file, options, { onProgress, signal }) {
      calls.push({ file, languageHint: options.languageHint });
      for (const p of progress) onProgress(p);
      if (signal.aborted) throw new LocalSttError('cancelled', 'cancelled');
      if (outcome === RESULT) return RESULT;
      throw outcome;
    },
    download: () => Promise.reject(new Error('unused')),
    removeModels: () => Promise.reject(new Error('unused')),
  };
}

const opts = (onProgress: (p: TranscriptionProgress) => void = () => {}) => ({
  signal: new AbortController().signal,
  onProgress,
});

describe('createLocalProvider', () => {
  it('declares what it takes: no key, no glossary, no zero retention, no number of speakers', () => {
    const provider = createLocalProvider(fakeBridge());
    expect(provider).toMatchObject({
      id: 'local',
      model: 'nvidia-parakeet-nemotron-1',
      needsKey: false,
      supports: { keyterms: false, zeroRetention: false, numSpeakers: false, autoDetect: false },
    });
    expect(provider.limits.maxSpeakers).toBe(8);
    expect(provider.limits.maxDurationSec).toBe(Number.POSITIVE_INFINITY);
    expect(provider.languages).toContain('de');
    expect(provider.languages).toHaveLength(25);
  });

  it('maps the engine’s result to tokens, cleaned up, with its timings', async () => {
    const run = await createLocalProvider(fakeBridge()).transcribe(input(), opts());
    expect(run.tokens.filter((t) => t.kind === 'word').map((t) => t.text)).toEqual([
      'Hello',
      'there.',
      'Hi.',
    ]);
    expect(run).toMatchObject({
      providerTranscriptId: null,
      languageCode: '',
      audioDurationSec: 5,
      timings: RESULT.timings,
    });
  });

  it('keeps the verbatim text when the clean-up is off', async () => {
    const run = await createLocalProvider(fakeBridge()).transcribe(
      input({ cleanUp: false }),
      opts(),
    );
    expect(run.tokens.find((t) => t.kind === 'word')?.text).toBe('Um');
  });

  it('reports preparing at once, then the engine’s progress', async () => {
    const seen: TranscriptionProgress[] = [];
    const progress: TranscriptionProgress[] = [
      { phase: 'transcribing', doneSec: 0, totalSec: 5 },
      { phase: 'transcribing', doneSec: 2.5, totalSec: 5 },
    ];
    const provider = createLocalProvider(fakeBridge(RESULT, progress));
    const done = provider.transcribe(
      input(),
      opts((p) => seen.push(p)),
    );
    expect(seen[0]).toEqual({ phase: 'preparing' });
    await done;
    expect(seen.slice(1)).toEqual(progress);
  });

  it('is cancelled by its signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await createLocalProvider(fakeBridge())
      .transcribe(input(), { signal: controller.signal, onProgress: () => {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('aborted');
  });

  it.each(LOCAL_ERROR_KINDS)(
    'shows its own message for %s, with the detail behind it',
    async (kind) => {
      const error = (await createLocalProvider(fakeBridge(new LocalSttError(kind, 'the detail')))
        .transcribe(input(), opts())
        .catch((e: unknown) => e)) as ProviderError;
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.userMessage.length).toBeGreaterThan(10);
      expect(technicalDetails(error)).toContain(`${kind}: the detail`);
      const canTryAgain = !['auth', 'validation'].includes(error.kind);
      const shouldTryAgain = [
        'out-of-memory',
        'engine',
        'busy',
        'downloading',
        'cancelled',
      ].includes(kind);
      expect(canTryAgain).toBe(shouldTryAgain);
    },
  );

  it('gives every kind a different message', async () => {
    const messages = new Set<string>();
    for (const kind of LOCAL_ERROR_KINDS) {
      const error = (await createLocalProvider(fakeBridge(new LocalSttError(kind, '')))
        .transcribe(input(), opts())
        .catch((e: unknown) => e)) as ProviderError;
      messages.add(error.userMessage);
    }
    expect(messages.size).toBe(LOCAL_ERROR_KINDS.length);
  });

  it('names Ogg Opus when it can’t read one', async () => {
    const error = (await createLocalProvider(
      fakeBridge(new LocalSttError('unreadable', '0xC00D36C4')),
    )
      .transcribe(input({ file: new File(['x'], 'voice note.opus') }), opts())
      .catch((e: unknown) => e)) as ProviderError;
    expect(error.userMessage).toContain('Ogg Opus');
    expect(error.userMessage).toContain('ElevenLabs');
  });

  it('turns anything unexpected into an engine failure, keeping no secrets', async () => {
    const error = (await createLocalProvider(fakeBridge({ weird: true }))
      .transcribe(input(), opts())
      .catch((e: unknown) => e)) as ProviderError;
    expect(error.kind).toBe('server');
    expect(technicalDetails(error)).toContain('engine:');
    expect(JSON.stringify(error)).not.toContain('test-key');
  });
});
