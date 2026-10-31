import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import { buildTranscriptDoc } from '../domain/buildTranscriptDoc';
import type { SourceInfo, TranscriptionRequestInfo } from '../domain/transcript';
import { ProviderError } from '../providers/errors';
import { getTranscriptionProvider } from '../providers/index';
import type { TranscriptionInput, TranscriptionProvider } from '../providers/transcription/types';
import { useGlossaryStore } from './glossary';
import { usePlaybackStore } from './playback';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';

export type JobStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error' | 'cancelled';

/** Everything a run needs, captured when it starts, so Try again repeats exactly the same request. */
interface RunSnapshot {
  provider: TranscriptionProvider;
  input: TranscriptionInput;
  source: SourceInfo;
  request: TranscriptionRequestInfo;
}

const MESSAGES = {
  noFile: 'Choose a recording on the Setup tab first.',
  unexpected: 'Something went wrong while transcribing. Try again.',
} as const;

/** Keeps the browser's "Leave site?" confirmation up while a run would be lost (Chromium 119+). */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
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
    window.removeEventListener('beforeunload', onBeforeUnload);
  }

  function snapshot(): RunSnapshot | null {
    const settings = useSettingsStore();
    const file = settings.file;
    if (!file) return null;
    const provider = getTranscriptionProvider();
    const keyterms = [...useGlossaryStore().validTerms];
    return {
      provider,
      input: {
        file,
        apiKey: settings.elevenLabsKey,
        languageHint: settings.languageHint,
        numSpeakers: settings.numSpeakers,
        zeroRetention: settings.zeroRetention,
        keyterms,
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
        numSpeakers: settings.numSpeakers,
        zeroRetention: settings.zeroRetention,
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
    stopTicker();
    window.addEventListener('beforeunload', onBeforeUnload);

    // Cancel (or a newer run) makes this run stale: whatever it produces afterwards is ignored.
    const isCurrent = () => controller === ctrl && !ctrl.signal.aborted;

    try {
      const result = await snap.provider.transcribe(snap.input, {
        signal: ctrl.signal,
        onProgress: (p) => {
          if (!isCurrent()) return;
          if (p.phase === 'uploading') {
            progress.value = { loaded: p.loaded, total: p.total };
          } else if (status.value === 'uploading') {
            status.value = 'processing';
            uploadDoneAt.value = Date.now();
            ticker = setInterval(updateElapsed, 1000);
          }
        },
      });
      if (!isCurrent()) return;
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

  /** Repeats the last run with the same file, key, options and terms. */
  function retry(): Promise<void> {
    if (isActive.value) return Promise.resolve();
    return lastSnapshot ? run(lastSnapshot) : start();
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
    start,
    cancel,
    retry,
    dismiss,
  };
});
