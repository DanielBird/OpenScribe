import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, toRaw, watch } from 'vue';
import type { LlmProviderId } from '../domain/transcript';
import { staleTurnIds, type TranslationTexts } from '../domain/translation';
import {
  TranslationError,
  translateTranscript,
  TRANSLATION_MESSAGES,
} from '../features/translation/translate';
import { ProviderError } from '../providers/errors';
import { getLlmProvider } from '../providers/index';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';
import { createUnloadGuard } from './unloadGuard';

export type TranslationStatus = 'idle' | 'running' | 'error' | 'cancelled';

/** What a run translates, and with which provider and model. */
interface RunTarget {
  docId: string;
  providerId: LlmProviderId;
  model: string;
}

const KEY_MISSING: Record<LlmProviderId, string> = {
  claude: 'Enter your Claude API key first.',
  gemini: 'Enter your Gemini API key first.',
};

/** Asks before the page is left or reloaded while a translation would be lost. */
const unloadGuard = createUnloadGuard();

//   idle ──start──▶ running ──done──▶ idle (doc.translations.en saved, view 'en')
//                     │ cancel    │ error
//                     ▼           ▼
//                 cancelled     error ──resume──▶ running (skips the batches already done)
// When some turns changed since the translation (DECISIONS.md D39), start updates it: only their batches are sent.
export const useTranslationStore = defineStore('translation', () => {
  const transcript = useTranscriptStore();
  const settings = useSettingsStore();

  const status = ref<TranslationStatus>('idle');
  const progress = ref<{ batch: number; totalBatches: number } | null>(null);
  const error = shallowRef<ProviderError | null>(null);
  /** Turns translated before an error, and what they were made from, for Resume. Never saved. */
  const partial = shallowRef<TranslationTexts | null>(null);
  /** The current or last run. */
  const target = shallowRef<RunTarget | null>(null);

  const isRunning = computed(() => status.value === 'running');

  let controller: AbortController | null = null;

  function endRun(): void {
    controller = null;
    unloadGuard.release();
  }

  async function run(next: RunTarget, resumeFrom: TranslationTexts | undefined) {
    const doc = transcript.doc;
    if (!doc || doc.id !== next.docId) return;
    target.value = next;
    error.value = null;
    progress.value = null;

    // Read the key now, not at start: Resume after an auth error uses the corrected key.
    const apiKey = settings.keyFor(next.providerId).trim();
    if (apiKey === '') {
      error.value = new ProviderError('validation', KEY_MISSING[next.providerId]);
      status.value = 'error';
      return;
    }

    const ctrl = new AbortController();
    controller = ctrl;
    status.value = 'running';
    unloadGuard.hold();
    // Cancel, a newer run or another transcript makes this run stale: its results are ignored.
    const isCurrent = () => controller === ctrl && !ctrl.signal.aborted;

    try {
      const provider = getLlmProvider(next.providerId, apiKey, next.model);
      const result = await translateTranscript(toRaw(doc), provider, {
        signal: ctrl.signal,
        resumeFrom,
        onProgress: (p) => {
          if (isCurrent()) progress.value = p;
        },
      });
      if (!isCurrent()) return;
      endRun();
      const saved = transcript.setTranslation(next.docId, {
        provider: next.providerId,
        model: next.model,
        createdAt: new Date().toISOString(),
        ...result,
      });
      status.value = 'idle';
      progress.value = null;
      partial.value = null;
      await saved;
    } catch (err) {
      if (!isCurrent()) return;
      endRun();
      if (err instanceof TranslationError) {
        error.value = err.cause;
        partial.value = err.completed;
      } else {
        error.value = new ProviderError('unknown', TRANSLATION_MESSAGES.unexpected, {
          detail: err instanceof Error ? err.message : undefined,
        });
      }
      status.value = 'error';
    }
  }

  /** The translation to update, when some turns changed since it was made (**Update English**). */
  function toUpdate(): TranslationTexts | undefined {
    const doc = transcript.doc;
    return doc && staleTurnIds(doc).length > 0 ? doc.translations.en : undefined;
  }

  /**
   * Translates the current transcript: only the turns changed since its translation, if there are any, otherwise
   * all of them. Does nothing while a translation runs.
   */
  function start(providerId: LlmProviderId, model: string): Promise<void> {
    const doc = transcript.doc;
    if (isRunning.value || !doc) return Promise.resolve();
    settings.translationProvider = providerId;
    settings.translationModel = model;
    partial.value = null;
    return run({ docId: doc.id, providerId, model }, toUpdate());
  }

  /** Continues a failed translation from the batch that failed. */
  function resume(): Promise<void> {
    if (status.value !== 'error' || !target.value) return Promise.resolve();
    return run(target.value, partial.value ?? toUpdate());
  }

  /** Aborts the request. Nothing is saved, and a late reply is ignored. */
  function cancel(): void {
    if (!isRunning.value) return;
    controller?.abort();
    endRun();
    status.value = 'cancelled';
    progress.value = null;
    partial.value = null;
  }

  /** Back to idle after an error or a cancel. */
  function dismiss(): void {
    if (status.value !== 'error' && status.value !== 'cancelled') return;
    status.value = 'idle';
    error.value = null;
    partial.value = null;
  }

  // A run, an error and its partial result belong to the transcript they were made for.
  watch(
    () => transcript.doc?.id,
    (id) => {
      if (!target.value || id === target.value.docId) return;
      controller?.abort();
      endRun();
      status.value = 'idle';
      progress.value = null;
      error.value = null;
      partial.value = null;
      target.value = null;
    },
  );

  onScopeDispose(() => {
    controller?.abort();
    endRun();
  });

  return {
    status,
    progress,
    error,
    partial,
    target,
    isRunning,
    start,
    resume,
    cancel,
    dismiss,
  };
});
