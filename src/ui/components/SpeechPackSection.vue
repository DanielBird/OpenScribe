<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef } from 'vue';
import { formatDownloadSize } from '../../domain/filecheck';
import { useSpeechPackStore, type SpeechPackOutcome } from '../../stores/speechPack';
import { useConfirm } from '../composables/useConfirm';
import ConfirmDialog from './ConfirmDialog.vue';
import ErrorDetails from './ErrorDetails.vue';

// Settings' band for the speech models (DECISIONS.md D50, D54), desktop only: SettingsView renders it only when
// `__DESKTOP__` is true. Download, its progress and Cancel, Remove; one state at a time (D13).
const store = useSpeechPackStore();
const { confirm, dialog: confirmDialog } = useConfirm();

const id = useId();
const ids = { heading: `${id}-heading`, progress: `${id}-progress`, size: `${id}-size` };
const action = useTemplateRef<HTMLButtonElement>('action');
const cancelButton = useTemplateRef<HTMLButtonElement>('cancelButton');

type View = 'checking' | 'downloading' | 'missing' | 'outdated' | 'damaged' | 'cpu' | 'ready';

const view = computed<View>(() => {
  const status = store.status;
  if (store.busy === 'downloading' || status?.state === 'downloading') return 'downloading';
  if (!status) return 'checking';
  if (status.state === 'unusable') return status.reason;
  return status.state;
});

/** "340 MB of 0.8 GB" while downloading. */
const progressText = computed(() => {
  const p = store.progress;
  if (!p) return '';
  return `${formatDownloadSize(p.received)} of ${formatDownloadSize(p.total, true)}`;
});

/** For screen readers only: the start and the end, not every tick. A failure is announced by its own alert. */
const announcement = ref('');
const DONE: Partial<Record<SpeechPackOutcome, string>> = {
  installed: 'Speech models installed.',
  cancelled: 'Download cancelled.',
  removed: 'Speech models removed.',
};

onMounted(() => {
  void store.refresh();
});

/** Focus stays here when the button pressed goes away: Cancel while downloading, then the state's own button. */
async function focusAction(): Promise<void> {
  await nextTick();
  (action.value ?? cancelButton.value)?.focus();
}

async function download(): Promise<void> {
  announcement.value = 'Downloading the speech models.';
  const done = store.download();
  await nextTick();
  cancelButton.value?.focus();
  const outcome = await done;
  announcement.value = DONE[outcome] ?? '';
  await focusAction();
}

async function remove(): Promise<void> {
  announcement.value = '';
  const ok = await confirm({
    title: 'Remove the speech models?',
    message: `To transcribe on this computer again, you'll need to download them again (${store.size}).`,
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;
  const outcome = await store.remove();
  announcement.value = DONE[outcome] ?? '';
  await focusAction();
}
</script>

<template>
  <section class="band" :aria-labelledby="ids.heading" :aria-busy="view === 'checking'">
    <h2 :id="ids.heading">Transcribe on this computer</h2>
    <div class="band-content">
      <div v-if="view === 'downloading'" class="downloading">
        <p :id="ids.progress">{{ progressText }}</p>
        <progress
          class="progress"
          :aria-labelledby="ids.progress"
          :value="store.progress?.received ?? 0"
          :max="store.progress?.total || 1"
        />
        <div v-if="store.busy === 'downloading'">
          <button ref="cancelButton" type="button" class="button" @click="store.cancel">
            Cancel
          </button>
        </div>
      </div>

      <template v-else-if="view === 'ready'">
        <p>Speech models are installed.</p>
        <div>
          <button
            ref="action"
            type="button"
            class="button"
            :disabled="store.busy !== null"
            @click="remove"
          >
            Remove
          </button>
        </div>
      </template>

      <template v-else-if="view === 'cpu'">
        <p>This computer can't run the speech models.</p>
      </template>

      <template v-else-if="view !== 'checking'">
        <p v-if="view === 'missing'">
          Transcribes without ElevenLabs, using speech models from NVIDIA.
        </p>
        <p v-else-if="view === 'outdated'">This version of DeScribe needs newer speech models.</p>
        <p v-else>The speech models are damaged.</p>
        <div class="action">
          <button
            ref="action"
            type="button"
            class="button"
            :aria-describedby="ids.size"
            :disabled="store.busy !== null"
            @click="download"
          >
            {{ view === 'damaged' ? 'Download again' : 'Download speech models' }}
          </button>
          <span :id="ids.size" class="hint">{{ store.size }} from huggingface.co</span>
        </div>
      </template>

      <template v-if="store.error && view !== 'downloading'">
        <p class="error" role="alert">{{ store.error.userMessage }}</p>
        <ErrorDetails :error="store.error" />
      </template>
    </div>
    <span class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</span>
    <ConfirmDialog v-bind="confirmDialog" />
  </section>
</template>

<style scoped>
.downloading {
  display: grid;
  gap: var(--space-2);
}

.progress {
  width: min(100%, 30rem);
  height: 0.75rem;
  accent-color: var(--color-accent);
}

.action {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
}

.error {
  color: var(--color-danger);
}
</style>
