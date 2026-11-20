import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import twoSpeakers from '../../fixtures/elevenlabs/two-speakers-short.json';
import { ProviderError, type ProviderErrorKind } from '../providers/errors';
import { setTranscriptionProviderForTests } from '../providers/index';
import { ELEVENLABS_LIMITS } from '../providers/transcription/elevenlabs/limits';
import { toNormalized } from '../providers/transcription/elevenlabs/mapper';
import type {
  NormalizedTranscription,
  TranscriptionInput,
  TranscriptionProgress,
  TranscriptionProvider,
} from '../providers/transcription/types';
import { useGlossaryStore } from './glossary';
import { useJobStore } from './job';
import { useNavStore } from './nav';
import { usePlaybackStore } from './playback';
import { TEST_PACK } from '../testing/localBridge';
import { useSettingsStore } from './settings';
import { useSpeechPackStore } from './speechPack';
import { useTranscriptStore } from './transcript';

vi.mock('../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
  clearLastTranscript: vi.fn(() => Promise.resolve()),
}));

interface Call {
  input: TranscriptionInput;
  signal: AbortSignal;
  onProgress: (p: TranscriptionProgress) => void;
  resolve: (r: NormalizedTranscription) => void;
  reject: (e: unknown) => void;
}

/** A provider whose every transcribe() call waits until the test settles it. */
function fakeProvider() {
  const calls: Call[] = [];
  const provider: TranscriptionProvider = {
    id: 'elevenlabs',
    model: 'scribe_v2',
    needsKey: true,
    supports: { keyterms: true, zeroRetention: true, numSpeakers: true, autoDetect: true },
    limits: ELEVENLABS_LIMITS,
    languages: ['de', 'en', 'fr'],
    transcribe: (input, { signal, onProgress }) =>
      new Promise((resolve, reject) => {
        calls.push({ input, signal, onProgress, resolve, reject });
      }),
  };
  return { provider, calls };
}

const RESULT = toNormalized(twoSpeakers);
const FILE = new File(['0123456789'], 'interview.wav', { type: 'audio/wav', lastModified: 1000 });

function makeReady() {
  const settings = useSettingsStore();
  settings.elevenLabsKey = 'test-key';
  settings.file = FILE;
  settings.fileDurationSec = 17.5;
  settings.languageHint = 'de';
  settings.numSpeakers = 2;
  settings.zeroRetention = true;
  useGlossaryStore().addFromText('Oticon\nFoo [bar]'); // the second term is invalid and not sent
  return settings;
}

const beforeUnloadPrevented = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('job store', () => {
  let fake: ReturnType<typeof fakeProvider>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
    fake = fakeProvider();
    setTranscriptionProviderForTests(fake.provider);
  });

  afterEach(() => {
    useJobStore().$dispose();
    setTranscriptionProviderForTests(null);
    vi.useRealTimers();
  });

  const call = (i = 0) => fake.calls[i]!;

  describe('start', () => {
    it('leaves idle synchronously, so Output can be entered straight away', () => {
      makeReady();
      const job = useJobStore();
      void job.start();
      expect(job.status).toBe('uploading');
      expect(job.isActive).toBe(true);
      expect(job.progress).toEqual({ loaded: 0, total: FILE.size });
      expect(useNavStore().goTo('output')).toBe(true);
    });

    it('sends the settings and only the valid glossary terms', () => {
      makeReady();
      void useJobStore().start();
      expect(fake.calls).toHaveLength(1);
      expect(call().input).toEqual({
        file: FILE,
        apiKey: 'test-key',
        languageHint: 'de',
        numSpeakers: 2,
        zeroRetention: true,
        keyterms: ['Oticon'],
        cleanUp: true,
        device: null,
      });
    });

    it('builds the transcript with the source and request info, and saves it', async () => {
      makeReady();
      const job = useJobStore();
      const done = job.start();
      call().resolve(RESULT);
      await done;

      expect(job.status).toBe('done');
      expect(job.isActive).toBe(false);
      const doc = useTranscriptStore().doc!;
      expect(doc.source).toEqual({
        fileName: 'interview.wav',
        fileSize: FILE.size,
        mimeType: 'audio/wav',
        lastModified: 1000,
        durationSec: 17.5,
      });
      expect(doc.request).toEqual({
        provider: 'elevenlabs',
        model: 'scribe_v2',
        languageHint: 'de',
        numSpeakers: 2,
        zeroRetention: true,
        keyterms: ['Oticon'],
      });
      expect(doc.speakers).toHaveLength(2);
      expect(doc.turns).toHaveLength(5);
      expect(doc.result.languageCode).toBe('deu');
    });

    it("attaches the run's file for playback", async () => {
      const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:run');
      makeReady();
      const done = useJobStore().start();
      call().resolve(RESULT);
      await done;

      const playback = usePlaybackStore();
      expect(createUrl).toHaveBeenCalledExactlyOnceWith(FILE);
      expect(playback.audioUrl).toBe('blob:run');
      expect(playback.sourceMatch).toBe('same-run');
      createUrl.mockRestore();
    });

    it('attaches nothing when the run fails', async () => {
      const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:run');
      makeReady();
      const done = useJobStore().start();
      call().reject(new ProviderError('network', 'offline'));
      await done;

      expect(createUrl).not.toHaveBeenCalled();
      expect(usePlaybackStore().audioUrl).toBeNull();
      createUrl.mockRestore();
    });

    it('does nothing while a run is active', () => {
      makeReady();
      const job = useJobStore();
      void job.start();
      void job.start();
      void job.retry();
      expect(fake.calls).toHaveLength(1);
    });

    it('fails clearly without a file', () => {
      const job = useJobStore();
      void job.start();
      expect(job.status).toBe('error');
      expect(job.error?.kind).toBe('validation');
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe('progress and the elapsed timer', () => {
    it('reports upload progress, then ticks once a second while processing', async () => {
      vi.useFakeTimers({ now: 0 });
      makeReady();
      const job = useJobStore();
      const done = job.start();

      call().onProgress({ phase: 'uploading', loaded: 4, total: 10 });
      expect(job.progress).toEqual({ loaded: 4, total: 10 });
      expect(job.startedAt).toBe(0);

      vi.advanceTimersByTime(2000);
      call().onProgress({ phase: 'processing' });
      expect(job.status).toBe('processing');
      expect(job.uploadDoneAt).toBe(2000);
      expect(job.elapsedSec).toBe(0);

      vi.advanceTimersByTime(3000);
      expect(job.elapsedSec).toBe(3);

      call().resolve(RESULT);
      await done;
      vi.advanceTimersByTime(5000);
      expect(job.elapsedSec).toBe(3); // the ticker stopped
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('errors', () => {
    const KINDS: ProviderErrorKind[] = [
      'auth',
      'quota',
      'validation',
      'rate_limit',
      'server',
      'network',
      'refused',
      'bad_output',
      'unknown',
    ];

    it.each(KINDS)('keeps a %s error as it is', async (kind) => {
      makeReady();
      const job = useJobStore();
      const done = job.start();
      const err = new ProviderError(kind, `message for ${kind}`);
      call().reject(err);
      await done;
      expect(job.status).toBe('error');
      expect(job.error).toBe(err);
      expect(useTranscriptStore().doc).toBeNull();
    });

    it('turns anything else into an unknown error', async () => {
      makeReady();
      const job = useJobStore();
      const done = job.start();
      call().reject(new TypeError('boom'));
      await done;
      expect(job.status).toBe('error');
      expect(job.error).toBeInstanceOf(ProviderError);
      expect(job.error?.kind).toBe('unknown');
      expect(job.error?.userMessage).toBe('Something went wrong while transcribing. Try again.');
    });

    it('turns a response the app cannot use into an unknown error', async () => {
      makeReady();
      const job = useJobStore();
      const done = job.start();
      call().resolve({ ...RESULT, tokens: null } as unknown as NormalizedTranscription);
      await done;
      expect(job.status).toBe('error');
      expect(job.error?.kind).toBe('unknown');
    });
  });

  describe('cancel', () => {
    it.each(['uploading', 'processing'] as const)(
      'aborts while %s and ignores a late response',
      async (phase) => {
        makeReady();
        const job = useJobStore();
        const done = job.start();
        if (phase === 'processing') call().onProgress({ phase: 'processing' });
        expect(job.status).toBe(phase);

        job.cancel();
        expect(job.status).toBe('cancelled');
        expect(call().signal.aborted).toBe(true);

        call().onProgress({ phase: 'uploading', loaded: 9, total: 10 });
        call().resolve(RESULT);
        await done;
        expect(job.status).toBe('cancelled');
        expect(job.progress?.loaded).not.toBe(9);
        expect(useTranscriptStore().doc).toBeNull();
      },
    );

    it('ignores a late error', async () => {
      makeReady();
      const job = useJobStore();
      const done = job.start();
      job.cancel();
      call().reject(new ProviderError('aborted', 'Transcription cancelled.'));
      await done;
      expect(job.status).toBe('cancelled');
      expect(job.error).toBeNull();
    });

    it('does nothing when no run is active', () => {
      const job = useJobStore();
      job.cancel();
      expect(job.status).toBe('idle');
    });
  });

  describe('retry', () => {
    it('repeats the same request with the current key, even after the settings changed', async () => {
      const settings = makeReady();
      const job = useJobStore();
      const first = job.start();
      call(0).reject(new ProviderError('quota', 'no credits'));
      await first;

      settings.elevenLabsKey = 'other-key';
      settings.languageHint = 'fr';
      useGlossaryStore().clear();

      const second = job.retry();
      expect(job.status).toBe('uploading');
      expect(job.error).toBeNull();
      expect(call(1).input).toEqual({ ...call(0).input, apiKey: 'other-key' });
      call(1).resolve(RESULT);
      await second;
      expect(job.status).toBe('done');
      expect(useTranscriptStore().doc?.request.languageHint).toBe('de');
    });

    it('starts again after a cancel, with the current key', () => {
      const settings = makeReady();
      const job = useJobStore();
      void job.start();
      job.cancel();
      settings.elevenLabsKey = 'other-key';
      void job.retry();
      expect(job.status).toBe('uploading');
      expect(fake.calls).toHaveLength(2);
      expect(call(1).signal.aborted).toBe(false);
      expect(call(1).input.apiKey).toBe('other-key');
    });

    it('fails with a validation error and sends nothing when the key was removed', async () => {
      const settings = makeReady();
      const job = useJobStore();
      const first = job.start();
      call(0).reject(new ProviderError('rate_limit', 'busy'));
      await first;

      settings.elevenLabsKey = '  ';
      await job.retry();
      expect(job.status).toBe('error');
      expect(job.error?.kind).toBe('validation');
      expect(job.error?.userMessage).toBe('Add your ElevenLabs API key in Settings.');
      expect(fake.calls).toHaveLength(1);
      expect(beforeUnloadPrevented()).toBe(false);
    });

    it('starts a new run when there was none', () => {
      makeReady();
      const job = useJobStore();
      void job.retry();
      expect(fake.calls).toHaveLength(1);
    });
  });

  describe('leave-page confirmation', () => {
    it('is on while uploading and processing, and off once done', async () => {
      makeReady();
      const job = useJobStore();
      expect(beforeUnloadPrevented()).toBe(false);
      const done = job.start();
      expect(beforeUnloadPrevented()).toBe(true);
      call().onProgress({ phase: 'processing' });
      expect(beforeUnloadPrevented()).toBe(true);
      call().resolve(RESULT);
      await done;
      expect(beforeUnloadPrevented()).toBe(false);
    });

    it('is off after an error or a cancel', async () => {
      makeReady();
      const job = useJobStore();
      const first = job.start();
      call(0).reject(new ProviderError('server', 'oops'));
      await first;
      expect(beforeUnloadPrevented()).toBe(false);

      void job.retry();
      expect(beforeUnloadPrevented()).toBe(true);
      job.cancel();
      expect(beforeUnloadPrevented()).toBe(false);
    });
  });

  describe('dismiss', () => {
    it('clears a run that has ended, and leaves an active one alone', async () => {
      makeReady();
      const job = useJobStore();
      const done = job.start();
      job.dismiss();
      expect(job.status).toBe('uploading');

      job.cancel();
      call(0).reject(new ProviderError('aborted', 'Transcription cancelled.'));
      job.dismiss();
      expect(job.status).toBe('idle');
      expect(job.progress).toBeNull();

      const again = job.start();
      call(1).reject(new ProviderError('server', 'oops'));
      await Promise.all([done, again]);
      job.dismiss();
      expect(job.status).toBe('idle');
      expect(job.error).toBeNull();
    });

    it('clears a finished run', async () => {
      makeReady();
      const job = useJobStore();
      const done = job.start();
      call(0).resolve(RESULT);
      await done;
      expect(job.status).toBe('done');
      job.dismiss();
      expect(job.status).toBe('idle');
    });
  });

  describe('on this computer (a provider that needs no key)', () => {
    const TIMINGS = {
      decodeSec: 0.5,
      wordsSec: 10,
      speakersSec: 8,
      totalSec: 10.2,
      threads: 8,
      device: null,
      peakMemoryBytes: 950_000_000,
      fellBack: null,
    };
    let local: ReturnType<typeof fakeProvider>;

    beforeEach(() => {
      local = fakeProvider();
      Object.assign(local.provider, {
        id: 'local',
        model: 'nvidia-parakeet-nemotron-1',
        needsKey: false,
        supports: { keyterms: false, zeroRetention: false, numSpeakers: false, autoDetect: false },
      });
      setTranscriptionProviderForTests(local.provider, 'local');
      vi.stubGlobal('__DESKTOP__', true);
    });

    afterEach(() => {
      setTranscriptionProviderForTests(null, 'local');
      vi.unstubAllGlobals();
    });

    function makeLocalReady() {
      const settings = makeReady();
      settings.elevenLabsKey = '';
      useSpeechPackStore().status = { state: 'ready', pack: TEST_PACK };
      settings.setTranscriptionEngine('local');
      return settings;
    }

    it('runs without a key and sends none of ElevenLabs’ options', () => {
      makeLocalReady();
      void useJobStore().start();
      expect(fake.calls).toHaveLength(0);
      expect(local.calls[0]!.input).toMatchObject({
        apiKey: '',
        keyterms: [],
        zeroRetention: false,
        numSpeakers: null,
        languageHint: 'de',
        cleanUp: true,
        device: null,
      });
    });

    describe('on a graphics card (Phase 37)', () => {
      const CARD = { name: 'AMD Radeon 740M Graphics', nth: 0 };
      const gpuFailure = () =>
        new ProviderError('server', 'The graphics card stopped while transcribing.', {
          retryOn: 'processor',
        });

      it('sends the saved card, even one Settings doesn’t list', () => {
        const settings = makeLocalReady();
        settings.setLocalDevice(CARD);
        expect(settings.gpuDevices).toEqual([]);
        void useJobStore().start();
        expect(local.calls[0]!.input.device).toEqual(CARD);
      });

      it('sends none to ElevenLabs', () => {
        const settings = makeReady();
        settings.setLocalDevice(CARD);
        void useJobStore().start();
        expect(fake.calls[0]!.input.device).toBeNull();
      });

      it('runs the same job once on the processor, and keeps the card chosen', async () => {
        const settings = makeLocalReady();
        settings.setLocalDevice(CARD);
        const job = useJobStore();
        const done = job.start();
        local.calls[0]!.reject(gpuFailure());
        await done;
        expect(job.status).toBe('error');
        const second = job.retryOnProcessor();
        expect(local.calls).toHaveLength(2);
        expect(local.calls[1]!.input).toEqual({ ...local.calls[0]!.input, device: null });
        expect(settings.localDevice).toEqual(CARD);
        // Try again repeats that run; a new start uses Settings again.
        local.calls[1]!.reject(new ProviderError('server', 'stopped'));
        await second;
        void job.retry();
        expect(local.calls[2]!.input.device).toBeNull();
        job.cancel();
        void job.start();
        expect(local.calls[3]!.input.device).toEqual(CARD);
      });

      it('does nothing on the processor while a run is active', () => {
        makeLocalReady();
        const job = useJobStore();
        void job.start();
        void job.retryOnProcessor();
        expect(local.calls).toHaveLength(1);
      });

      it('does nothing on the processor after an ElevenLabs run', async () => {
        makeReady();
        const job = useJobStore();
        const done = job.start();
        fake.calls[0]!.reject(new ProviderError('server', 'busy'));
        await done;
        void job.retryOnProcessor();
        expect(fake.calls).toHaveLength(1);
        expect(local.calls).toHaveLength(0);
      });

      it('remembers where the last run ran, and reads an older record as the processor', async () => {
        makeLocalReady();
        const job = useJobStore();
        const done = job.start();
        // The second of two identical cards stays the second (audit GPU-6).
        const onCard = { ...TIMINGS, threads: null, device: { ...CARD, nth: 1 } };
        local.calls[0]!.resolve({ ...RESULT, timings: onCard } as NormalizedTranscription);
        await done;
        setActivePinia(createPinia());
        expect(useJobStore().lastLocalRun?.timings).toEqual(onCard);
        const { device: _device, fellBack: _fellBack, ...before } = TIMINGS;
        localStorage.setItem(
          'describe.v1.lastLocalRun',
          JSON.stringify({ at: '2026-11-17T10:00:00.000Z', audioSec: 60, timings: before }),
        );
        setActivePinia(createPinia());
        expect(useJobStore().lastLocalRun?.timings).toEqual({
          ...before,
          device: null,
          fellBack: null,
        });
      });

      it('remembers a run that fell back to the processor, and why (audit GPU-3)', async () => {
        makeLocalReady();
        const job = useJobStore();
        const done = job.start();
        const fellBack = {
          ...TIMINGS,
          fellBack: { device: CARD, reason: 'the Vulkan engine found no graphics card' },
        };
        local.calls[0]!.resolve({ ...RESULT, timings: fellBack } as NormalizedTranscription);
        await done;
        setActivePinia(createPinia());
        expect(useJobStore().lastLocalRun?.timings).toEqual(fellBack);
      });

      it('reads a card saved by name alone as the first with that name (before audit GPU-6)', () => {
        const reason = 'the Vulkan engine found no graphics card';
        localStorage.setItem(
          'describe.v1.lastLocalRun',
          JSON.stringify({
            at: '2026-11-19T10:00:00.000Z',
            audioSec: 60,
            timings: { ...TIMINGS, threads: null, device: CARD.name },
          }),
        );
        expect(useJobStore().lastLocalRun?.timings.device).toEqual(CARD);
        localStorage.setItem(
          'describe.v1.lastLocalRun',
          JSON.stringify({
            at: '2026-11-19T10:00:00.000Z',
            audioSec: 60,
            timings: { ...TIMINGS, fellBack: { device: CARD.name, reason } },
          }),
        );
        setActivePinia(createPinia());
        expect(useJobStore().lastLocalRun?.timings.fellBack).toEqual({ device: CARD, reason });
      });
    });

    it('shows the processing state from the start, with the seconds done', () => {
      makeLocalReady();
      const job = useJobStore();
      void job.start();
      local.calls[0]!.onProgress({ phase: 'preparing' });
      expect(job.status).toBe('processing');
      local.calls[0]!.onProgress({ phase: 'transcribing', doneSec: 12, totalSec: 60 });
      expect(job.localProgress).toEqual({ doneSec: 12, totalSec: 60 });
    });

    it('records the engine and pack, and keeps the run’s timings outside the doc', async () => {
      makeLocalReady();
      const job = useJobStore();
      const done = job.start();
      local.calls[0]!.resolve({ ...RESULT, timings: TIMINGS } as NormalizedTranscription);
      await done;
      const doc = useTranscriptStore().doc!;
      expect(doc.request).toEqual({
        provider: 'local',
        model: 'nvidia-parakeet-nemotron-1',
        languageHint: 'de',
        numSpeakers: null,
        zeroRetention: false,
        keyterms: [],
      });
      expect(JSON.stringify(doc)).not.toContain('peakMemoryBytes');
      expect(job.lastLocalRun).toMatchObject({ timings: TIMINGS });
      // It survives a restart, and Clear saved data forgets it.
      setActivePinia(createPinia());
      expect(useJobStore().lastLocalRun).toMatchObject({ timings: TIMINGS });
      useJobStore().clearLastLocalRun();
      setActivePinia(createPinia());
      expect(useJobStore().lastLocalRun).toBeNull();
    });

    it('tries again without asking for a key', async () => {
      makeLocalReady();
      const job = useJobStore();
      const done = job.start();
      local.calls[0]!.reject(new ProviderError('server', 'stopped'));
      await done;
      void job.retry();
      expect(local.calls).toHaveLength(2);
      expect(job.status).not.toBe('error');
    });
  });
});
