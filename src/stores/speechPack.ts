import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { formatDownloadSize } from '../domain/filecheck';
import type { ProviderError } from '../providers/errors';
import { getLocalSttBridge } from '../providers';
import { toSpeechPackError, type LocalSttStatus } from '../providers/transcription/local/bridge';
import {
  toDownloadProviderError,
  toRemoveProviderError,
} from '../providers/transcription/local/downloadErrors';

/** How a download or removal ended, for the section's announcement. */
export type SpeechPackOutcome = 'installed' | 'cancelled' | 'removed' | 'failed' | 'refused';

// The speech models for transcribing on this computer (DECISIONS.md D50, D54): their status, the download and its
// progress, and removal. Desktop only: every action returns at once in the web build. The store outlives Settings, so
// a download keeps going when the user leaves it, and the section shows it on return. Phase 36's Setup reads `status`.
export const useSpeechPackStore = defineStore('speechPack', () => {
  /** What Rust last said, or null before the first answer. */
  const status = shallowRef<LocalSttStatus | null>(null);
  /** Bytes of the whole download so far, while one runs. */
  const progress = ref<{ received: number; total: number } | null>(null);
  /** The last download's or removal's failure, until the next attempt. */
  const error = shallowRef<ProviderError | null>(null);
  const busy = ref<'downloading' | 'removing' | null>(null);
  let controller: AbortController | null = null;
  let checking: Promise<void> | null = null;

  /** The download's size as shown beside its button: from pack.json, through Rust, never typed by hand. */
  const size = computed(() =>
    status.value ? formatDownloadSize(status.value.pack.downloadBytes, true) : '',
  );

  /** Asks Rust for the status. The first time it hashes the files, which takes about a second. */
  function refresh(): Promise<void> {
    if (!__DESKTOP__) return Promise.resolve();
    const bridge = getLocalSttBridge();
    if (!bridge) return Promise.resolve();
    checking ??= bridge
      .status()
      .then((next) => {
        status.value = next;
        if (next.state === 'downloading' && !controller) {
          progress.value = { received: next.receivedBytes, total: next.totalBytes };
        }
      })
      .catch((cause: unknown) => {
        console.warn('DeScribe: the speech models’ status is unreadable', cause);
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  }

  /** Downloads the models. Resolves with how it ended; a failure is in `error`. */
  async function download(): Promise<SpeechPackOutcome> {
    const bridge = __DESKTOP__ ? getLocalSttBridge() : null;
    if (!bridge || busy.value) return 'refused';
    error.value = null;
    busy.value = 'downloading';
    controller = new AbortController();
    const total = status.value?.pack.downloadBytes ?? 0;
    progress.value = { received: 0, total };
    let outcome: SpeechPackOutcome = 'installed';
    try {
      await bridge.download({
        signal: controller.signal,
        onProgress: (received, totalBytes) => {
          progress.value = { received, total: totalBytes };
        },
      });
    } catch (cause) {
      const failure = toSpeechPackError(cause);
      if (failure.kind === 'cancelled') outcome = 'cancelled';
      else {
        outcome = 'failed';
        error.value = toDownloadProviderError(failure, size.value);
      }
    } finally {
      controller = null;
      busy.value = null;
      progress.value = null;
    }
    await refresh();
    return outcome;
  }

  /** Stops the download. The part already on disk is kept for the next one. */
  function cancel(): void {
    controller?.abort();
  }

  /** Deletes the models (Settings asks first). */
  async function remove(): Promise<SpeechPackOutcome> {
    const bridge = __DESKTOP__ ? getLocalSttBridge() : null;
    if (!bridge || busy.value) return 'refused';
    error.value = null;
    busy.value = 'removing';
    let outcome: SpeechPackOutcome = 'removed';
    try {
      await bridge.removeModels();
    } catch (cause) {
      outcome = 'failed';
      error.value = toRemoveProviderError(toSpeechPackError(cause));
    } finally {
      busy.value = null;
    }
    await refresh();
    return outcome;
  }

  return { status, progress, error, busy, size, refresh, download, cancel, remove };
});
