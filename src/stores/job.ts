import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import { buildTranscriptDoc } from '../domain/buildTranscriptDoc';
import type { SourceInfo, TranscriptionRequestInfo } from '../domain/transcript';
import { z } from '../lib/zod';
import { ProviderError } from '../providers/errors';
import { getTranscriptionProvider } from '../providers/index';
import type {
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionTimings,
} from '../providers/transcription/types';
import { readJson, removeKey, writeJson } from '../storage/local';
import { useGlossaryStore } from './glossary';
import { usePlaybackStore } from './playback';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';
import { createUnloadGuard } from './unloadGuard';

export type JobStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error' | 'cancelled';

/** Everything a run needs, captured when it starts, so Try again repeats the same request (with the current key). */
interface RunSnapshot {
  provider: TranscriptionProvider;
  input: TranscriptionInput;
  source: SourceInfo;
  request: TranscriptionRequestInfo;
}

const MESSAGES = {
  noFile: 'Choose a recording on the Setup tab first.',
  noKey: 'Add your ElevenLabs API key in Settings.',
  unexpected: 'Something went wrong while transcribing. Try again.',
} as const;

/** Asks before the page is left or reloaded while a run would be lost. */
const unloadGuard = createUnloadGuard();

/** The last run on this computer: what Settings will show (Phase 36), and how the work laptop is measured. */
export interface LocalRunRecord {
  at: string; // ISO
  audioSec: number | null;
  timings: TranscriptionTimings;
}

const LAST_LOCAL_RUN_KEY = 'lastLocalRun';

const LocalRunSchema = z.object({
  at: z.string(),
  audioSec: z.number().nullable(),
  timings: z.object({
    decodeSec: z.number(),
    wordsSec: z.number(),
    speakersSec: z.number(),
    totalSec: z.number(),
    threads: z.number(),
    peakMemoryBytes: z.number().nullable(),
  }),
});

function loadLastLocalRun(): LocalRunRecord | null {
  const parsed = LocalRunSchema.safeParse(readJson<unknown>('local', LAST_LOCAL_RUN_KEY, null));
  return parsed.success ? parsed.data : null;
}

//   idle ──start──▶ uploading ──upload done──▶ processing ──200──▶ done
//                     │ cancel/error              │ cancel/error
//                     ▼                           ▼
//                   cancelled / error ──retry──▶ uploading
export const useJobStore = defineStore('job', () => {
  const status = ref<JobStatus>('idle');
  const progress = ref<{ loaded: number; total: number } | null>(null);
  const error = shallowRef<ProviderError | null>(null);
  const startedAt = ref<number | null>(null);
  const uploadDoneAt = ref<number | null>(null);
  /** Seconds since the upload finished; ticks once a second while processing. */
  const elapsedSec = ref(0);

  const isActive = computed(() => status.value === 'uploading' || status.value === 'processing');
  /** On this computer: seconds of audio done, out of the total if known. Phase 36 shows it. */
  const localProgress = ref<{ doneSec: number; totalSec: number | null } | null>(null);
  const lastLocalRun = shallowRef<LocalRunRecord | null>(loadLastLocalRun());

  let controller: AbortController | null = null;
  let lastSnapshot: RunSnapshot | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;

  function updateElapsed(): void {
    if (uploadDoneAt.value !== null) {
      elapsedSec.value = Math.max(0, Math.floor((Date.now() - uploadDoneAt.value) / 1000));
    }
  }

  function stopTicker(): void {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
  }

  /** Stops what only an active run needs. */
  function endRun(): void {
    controller = null;
    stopTicker();
    unloadGuard.release();
  }

  function snapshot(): RunSnapshot | null {
    const settings = useSettingsStore();
    const file = settings.file;
    if (!file) return null;
    const provider = getTranscriptionProvider(settings.transcriptionEngine);
    // A provider that can't take an option is sent none, and the doc says none was used.
    const keyterms = provider.supports.keyterms ? [...useGlossaryStore().validTerms] : [];
    const zeroRetention = provider.supports.zeroRetention && settings.zeroRetention;
    const numSpeakers = provider.supports.numSpeakers ? settings.numSpeakers : null;
    return {
      provider,
      input: {
        file,
        apiKey: provider.needsKey ? settings.elevenLabsKey : '',
        languageHint: settings.languageHint,
        numSpeakers,
        zeroRetention,
        keyterms,
        cleanUp: settings.localTextCleanUp,
      },
      source: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        lastModified: file.lastModified,
        durationSec: settings.fileDurationSec,
      },
      request: {
        provider: provider.id,
        model: provider.model,
        languageHint: settings.languageHint,
        numSpeakers,
        zeroRetention,
        keyterms: [...keyterms],
      },
    };
  }

  async function run(snap: RunSnapshot): Promise<void> {
    // Everything up to the first await runs synchronously: callers rely on `status` having left
    // `idle` when start() returns (the nav guard only opens Output then).
    lastSnapshot = snap;
    const ctrl = new AbortController();
    controller = ctrl;
    status.value = 'uploading';
    progress.value = { loaded: 0, total: snap.input.file.size };
    error.value = null;
    startedAt.value = Date.now();
    uploadDoneAt.value = null;
    elapsedSec.value = 0;
    localProgress.value = null;
    stopTicker();
    unloadGuard.hold();

    // Cancel (or a newer run) makes this run stale: whatever it produces afterwards is ignored.
    const isCurrent = () => controller === ctrl && !ctrl.signal.aborted;

    try {
      const result = await snap.provider.transcribe(snap.input, {
        signal: ctrl.signal,
        onProgress: (p) => {
          if (!isCurrent()) return;
          if (p.phase === 'uploading') {
            progress.value = { loaded: p.loaded, total: p.total };
            return;
          }
          // Nothing is uploaded on this computer: its first event ('preparing') arrives before start() returns,
          // so a local run shows the processing state from the beginning.
          if (status.value === 'uploading') {
            status.value = 'processing';
            uploadDoneAt.value = Date.now();
            ticker = setInterval(updateElapsed, 1000);
          }
          if (p.phase === 'transcribing') {
            localProgress.value = { doneSec: p.doneSec, totalSec: p.totalSec };
          }
        },
      });
      if (!isCurrent()) return;
      if (result.timings) {
        const record = {
          at: new Date().toISOString(),
          audioSec: result.audioDurationSec,
          timings: result.timings,
        };
        lastLocalRun.value = record;
        writeJson('local', LAST_LOCAL_RUN_KEY, record);
      }
      const saved = useTranscriptStore().setDoc(
        buildTranscriptDoc(result, snap.source, snap.request),
      );
      usePlaybackStore().attachFromRunFile(snap.input.file);
      status.value = 'done';
      endRun();
      await saved;
    } catch (err) {
      if (!isCurrent()) return;
      error.value =
        err instanceof ProviderError
          ? err
          : new ProviderError('unknown', MESSAGES.unexpected, {
              detail: err instanceof Error ? err.message : undefined,
            });
      status.value = 'error';
      endRun();
    }
  }

  /** Starts a run with the current settings and glossary. Does nothing while a run is active. */
  function start(): Promise<void> {
    if (isActive.value) return Promise.resolve();
    const snap = snapshot();
    if (!snap) {
      error.value = new ProviderError('validation', MESSAGES.noFile);
      status.value = 'error';
      return Promise.resolve();
    }
    return run(snap);
  }

  /** Aborts the request. A response that still arrives is ignored. */
  function cancel(): void {
    if (!isActive.value) return;
    controller?.abort();
    status.value = 'cancelled';
    endRun();
  }

  /** Repeats the last run with the same file, options and terms, and the key as it is now. */
  function retry(): Promise<void> {
    if (isActive.value) return Promise.resolve();
    if (!lastSnapshot) return start();
    // Read the key now, not at start: after a quota or rate-limit error, a key changed in Settings is used.
    if (!lastSnapshot.provider.needsKey) return run(lastSnapshot);
    const apiKey = useSettingsStore().elevenLabsKey;
    if (apiKey.trim() === '') {
      error.value = new ProviderError('validation', MESSAGES.noKey);
      status.value = 'error';
      return Promise.resolve();
    }
    return run({ ...lastSnapshot, input: { ...lastSnapshot.input, apiKey } });
  }

  /**
   * Clears a run that has ended (done, failed or cancelled): Output shows the transcript again, and
   * after "Clear saved data" Output can't be entered. An active run is left alone.
   */
  function dismiss(): void {
    if (isActive.value || status.value === 'idle') return;
    status.value = 'idle';
    error.value = null;
    progress.value = null;
  }

  /** Forgets the last local run's timings (Clear saved data). */
  function clearLastLocalRun(): void {
    lastLocalRun.value = null;
    removeKey('local', LAST_LOCAL_RUN_KEY);
  }

  onScopeDispose(() => {
    controller?.abort();
    endRun();
  });

  return {
    status,
    progress,
    error,
    startedAt,
    uploadDoneAt,
    elapsedSec,
    isActive,
    localProgress,
    lastLocalRun,
    clearLastLocalRun,
    start,
    cancel,
    retry,
    dismiss,
  };
});
