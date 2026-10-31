<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { normalizeLanguage, type LlmProviderId } from '../../domain/transcript';
import { useTranscriptStore } from '../../stores/transcript';
import { useTranslationStore } from '../../stores/translation';
import TranslateDialog from './TranslateDialog.vue';

// "Translate to English" and, while it runs, its progress in the actions row (DECISIONS.md D14).
// Hidden for English transcripts: there is nothing to translate (D13: hidden rather than disabled).
const transcript = useTranscriptStore();
const translation = useTranslationStore();

const choosing = ref(false);
const mainButton = useTemplateRef<HTMLButtonElement>('mainButton');
const statusLine = useTemplateRef<HTMLElement>('statusLine');
const resumeButton = useTemplateRef<HTMLButtonElement>('resumeButton');

const available = computed(() => {
  const doc = transcript.doc;
  return (
    doc !== null && doc.turns.length > 0 && normalizeLanguage(doc.result.languageCode) !== 'en'
  );
});
const hasTranslation = computed(() => transcript.doc?.translations.en !== undefined);

/** "batch 3 of 12" when there is more than one; a single batch just shows the spinner. */
const batches = computed(() => {
  const p = translation.progress;
  return p && p.totalBatches > 1 ? p : null;
});

// Screen readers hear the phase; the error is announced by its own alert.
const announcement = ref('');
watch(
  () => translation.status,
  (status, before) => {
    if (status === 'running') announcement.value = 'Translating';
    else if (status === 'cancelled') announcement.value = 'Translation cancelled.';
    else if (status === 'idle' && before === 'running' && hasTranslation.value) {
      announcement.value = 'English translation ready.';
    } else announcement.value = '';
  },
);

/**
 * When the focused control disappears (Translate, Cancel), keep focus here, not at the top of the page.
 * After a modal closes, Chromium can leave focus on a button inside the closed dialog: that counts as lost.
 */
function keepFocus(): void {
  const active = document.activeElement;
  const lost =
    !active ||
    active === document.body ||
    !active.isConnected ||
    active.closest('dialog:not([open])') !== null;
  if (!lost) return;
  if (translation.isRunning) statusLine.value?.focus();
  else if (translation.status === 'error') resumeButton.value?.focus();
  else mainButton.value?.focus();
}

watch(
  () => translation.status,
  async () => {
    await nextTick();
    keepFocus();
  },
);

async function onTranslate(provider: LlmProviderId, model: string): Promise<void> {
  choosing.value = false;
  const started = translation.start(provider, model);
  // The dialog closes after this render; its trigger is gone by then.
  await nextTick();
  keepFocus();
  await started;
}
</script>

<template>
  <div v-if="available" class="translate">
    <button
      v-if="!translation.isRunning"
      ref="mainButton"
      type="button"
      class="button"
      @click="choosing = true"
    >
      {{ hasTranslation ? 'Re-translate…' : 'Translate to English' }}
    </button>

    <div v-if="translation.isRunning" class="running">
      <span class="spinner" aria-hidden="true" />
      <p ref="statusLine" class="status-line" tabindex="-1">
        Translating…<template v-if="batches">{{
          ` batch ${batches.batch} of ${batches.totalBatches}`
        }}</template>
      </p>
      <progress
        v-if="batches"
        class="progress"
        aria-label="Translation progress"
        :value="batches.batch - 1"
        :max="batches.totalBatches"
      />
      <button type="button" class="button" @click="translation.cancel()">Cancel</button>
    </div>

    <div v-if="translation.status === 'error'" class="failed">
      <p class="error" role="alert">{{ translation.error?.userMessage }}</p>
      <button ref="resumeButton" type="button" class="button" @click="translation.resume()">
        Resume
      </button>
    </div>

    <span class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</span>

    <TranslateDialog
      :open="choosing"
      :replaces="hasTranslation"
      @translate="onTranslate"
      @cancel="choosing = false"
    />
  </div>
</template>

<style scoped>
.translate,
.running,
.failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.spinner {
  width: 1em;
  height: 1em;
  border-width: 2px;
}

.status-line {
  font-variant-numeric: tabular-nums;
}

.progress {
  width: 8rem;
  height: 0.75rem;
  accent-color: var(--color-accent);
}

.error {
  color: var(--color-danger);
}
</style>
