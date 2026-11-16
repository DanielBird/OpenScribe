import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptionProgress } from '../types';

// The bridge talks to Rust only through these two modules: both are faked here.
const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>();
let channelListener: ((message: unknown) => void) | null = null;
vi.mock('../../../desktop/ipc', () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invoke(command, args),
  openChannel: (listener: (message: unknown) => void) => {
    channelListener = listener;
    return { id: 1 };
  },
}));
const token = vi.fn<(file: File) => string | null>();
vi.mock('../../../desktop/recordings', () => ({ tokenOf: (file: File) => token(file) }));

const { createTauriSttBridge, LocalSttError, SpeechPackError, toLocalError, toSpeechPackError } =
  await import('./bridge');

const PACK = { id: 'p', version: '1', languages: ['en'], maxSpeakers: 8, downloadBytes: 10 };
const RESULT = {
  language: null,
  durationSec: 5,
  words: [{ text: 'Hi.', start: 0.1, end: 0.4, confidence: 1 }],
  speakerSegments: [{ speaker: 0, start: 0, end: 1 }],
  timings: {
    decodeSec: 0.1,
    wordsSec: 1,
    speakersSec: 1,
    totalSec: 1.2,
    threads: 8,
    peakMemoryBytes: null,
  },
};
const FILE = new File(['x'], 'a.m4a');
const run = (onProgress: (p: TranscriptionProgress) => void = () => {}, signal?: AbortSignal) =>
  createTauriSttBridge().transcribe(
    FILE,
    { languageHint: 'auto', numSpeakers: null },
    { signal: signal ?? new AbortController().signal, onProgress },
  );

beforeEach(() => {
  invoke.mockReset();
  token.mockReset();
  token.mockReturnValue('0'.repeat(32));
  channelListener = null;
});

describe('the bridge', () => {
  it('reads each status', async () => {
    for (const reply of [
      { state: 'ready', pack: PACK },
      { state: 'missing', pack: PACK },
      { state: 'unusable', pack: PACK, reason: 'cpu' },
      { state: 'downloading', pack: PACK, receivedBytes: 3, totalBytes: 10 },
    ]) {
      invoke.mockResolvedValueOnce(reply);
      await expect(createTauriSttBridge().status()).resolves.toEqual(reply);
    }
  });

  it('refuses a malformed status', async () => {
    for (const reply of [
      null,
      { state: 'ready' },
      { state: 'downloading', pack: PACK },
      { state: 'downloading', pack: PACK, receivedBytes: -1, totalBytes: 10 },
      { state: 'unusable', pack: PACK, reason: 'bored' },
      { state: 'ready', pack: { ...PACK, maxSpeakers: -1 } },
    ]) {
      invoke.mockResolvedValueOnce(reply);
      await expect(createTauriSttBridge().status()).rejects.toBeInstanceOf(LocalSttError);
    }
  });

  it('starts the run with the recording’s token and passes progress on', async () => {
    const seen: TranscriptionProgress[] = [];
    invoke.mockImplementation(async (command) => {
      if (command !== 'stt_start') return null;
      channelListener?.({ phase: 'preparing' });
      channelListener?.({ phase: 'transcribing', doneSec: 2, totalSec: 5 });
      channelListener?.({ phase: 'transcribing', doneSec: 'lots' }); // ignored
      return RESULT;
    });
    await expect(run((p) => seen.push(p))).resolves.toEqual(RESULT);
    expect(invoke).toHaveBeenCalledWith('stt_start', {
      token: '0'.repeat(32),
      runId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      onProgress: { id: 1 },
    });
    expect(seen).toEqual([
      { phase: 'preparing' },
      { phase: 'transcribing', doneSec: 2, totalSec: 5 },
    ]);
  });

  it('refuses a File the app didn’t choose', async () => {
    token.mockReturnValue(null);
    await expect(run()).rejects.toMatchObject({ kind: 'recording' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses a malformed result', async () => {
    for (const reply of [
      null,
      { ...RESULT, words: [{ text: 'x', start: Number.NaN, end: 1, confidence: null }] },
      { ...RESULT, speakerSegments: [{ speaker: 1.5, start: 0, end: 1 }] },
      { ...RESULT, timings: { ...RESULT.timings, threads: 0 } },
      { ...RESULT, durationSec: -1 },
    ]) {
      invoke.mockResolvedValueOnce(reply);
      await expect(run()).rejects.toMatchObject({ kind: 'engine' });
    }
  });

  it('cancels the run in Rust when its signal aborts', async () => {
    const controller = new AbortController();
    let finish: (value: unknown) => void = () => {};
    invoke.mockImplementation((command) =>
      command === 'stt_start'
        ? new Promise((resolve) => (finish = resolve))
        : Promise.resolve(null),
    );
    const done = run(undefined, controller.signal);
    controller.abort();
    // The cancel names the run, so Rust keeps one that arrives before the run has begun.
    const runId = invoke.mock.calls.find(([command]) => command === 'stt_start')?.[1]?.runId;
    expect(runId).toEqual(expect.any(String));
    expect(invoke).toHaveBeenCalledWith('stt_cancel', { runId });
    finish(null);
    await expect(done).rejects.toBeInstanceOf(LocalSttError);
  });

  it('names each run apart', async () => {
    invoke.mockResolvedValue(RESULT);
    await run();
    await run();
    const ids = invoke.mock.calls.map(([, args]) => args?.runId);
    expect(new Set(ids).size).toBe(2);
  });

  it('reads Rust’s errors, and makes anything else an engine failure', () => {
    expect(toLocalError({ kind: 'pack-damaged', detail: 'hash' })).toMatchObject({
      kind: 'pack-damaged',
      detail: 'hash',
    });
    expect(toLocalError({ kind: 'surprise', detail: 'x' }).kind).toBe('engine');
    expect(toLocalError('IPC said no').detail).toBe('IPC said no');
    expect(toLocalError(new Error('boom')).kind).toBe('engine');
  });

  describe('the download', () => {
    const download = (
      onProgress: (r: number, t: number) => void = () => {},
      signal = new AbortController().signal,
    ) => createTauriSttBridge().download({ signal, onProgress });

    it('starts it with nothing but its id and a channel, and passes progress on', async () => {
      const seen: [number, number][] = [];
      invoke.mockImplementation(async (command) => {
        if (command !== 'stt_download') return null;
        channelListener?.({ receivedBytes: 4, totalBytes: 10 });
        channelListener?.({ receivedBytes: 'four', totalBytes: 10 }); // ignored
        return null;
      });
      await expect(download((r, t) => seen.push([r, t]))).resolves.toBeUndefined();
      expect(invoke).toHaveBeenCalledWith('stt_download', {
        downloadId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        onProgress: { id: 1 },
      });
      expect(seen).toEqual([[4, 10]]);
    });

    it('cancels it in Rust when its signal aborts', async () => {
      const controller = new AbortController();
      let fail: (reason: unknown) => void = () => {};
      invoke.mockImplementation((command) =>
        command === 'stt_download'
          ? new Promise((_, reject) => (fail = reject))
          : Promise.resolve(null),
      );
      const done = download(undefined, controller.signal);
      controller.abort();
      const downloadId = invoke.mock.calls.find(([command]) => command === 'stt_download')?.[1]
        ?.downloadId;
      expect(downloadId).toEqual(expect.any(String));
      expect(invoke).toHaveBeenCalledWith('stt_download_cancel', { downloadId });
      fail({ kind: 'cancelled', detail: 'cancelled' });
      await expect(done).rejects.toMatchObject({ kind: 'cancelled' });
    });

    it('rejects with each failure Rust reports', async () => {
      for (const kind of [
        'blocked',
        'offline',
        'busy',
        'disk',
        'write',
        'mismatch',
        'gone',
        'in-use',
      ]) {
        invoke.mockRejectedValueOnce({ kind, detail: 'huggingface.co 403' });
        const error = await download().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SpeechPackError);
        expect(error).toMatchObject({ kind, detail: 'huggingface.co 403' });
      }
    });

    it('removes the models, and reads a failure to', async () => {
      invoke.mockResolvedValueOnce(null);
      await expect(createTauriSttBridge().removeModels()).resolves.toBeUndefined();
      expect(invoke).toHaveBeenCalledWith('stt_remove_models', undefined);
      invoke.mockRejectedValueOnce({ kind: 'in-use', detail: 'a transcription is running' });
      await expect(createTauriSttBridge().removeModels()).rejects.toMatchObject({ kind: 'in-use' });
    });

    it('makes anything unexpected an offline failure', () => {
      expect(toSpeechPackError({ kind: 'surprise', detail: 'x' }).kind).toBe('offline');
      expect(toSpeechPackError('IPC said no').detail).toBe('IPC said no');
      expect(toSpeechPackError(new Error('boom'))).toBeInstanceOf(SpeechPackError);
    });
  });
});
