<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import { formatDownloadSize } from '../../domain/filecheck';
import { cardLabel } from '../../domain/gpuCard';
import { formatTimestamp } from '../../domain/transcript';
import { useJobStore, type LocalRunRecord } from '../../stores/job';
import { useSettingsStore } from '../../stores/settings';
import { useSpeechPackStore, type SpeechPackOutcome } from '../../stores/speechPack';
import { useConfirm } from '../composables/useConfirm';
import ConfirmDialog from './ConfirmDialog.vue';
import ErrorDetails from './ErrorDetails.vue';

// Settings' band for the speech models (DECISIONS.md D50, D54), desktop only: SettingsView renders it only when
// `__DESKTOP__` is true. Download, its progress and Cancel, Remove; one state at a time (D13). With the models ready
// and a graphics card found, where they run (Phase 37).
const store = useSpeechPackStore();
const job = useJobStore();
const settings = useSettingsStore();
const { confirm, dialog: confirmDialog } = useConfirm();

const id = useId();
const ids = {
  heading: `${id}-heading`,
  progress: `${id}-progress`,
  size: `${id}-size`,
  device: `${id}-device`,
};
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

const seconds = (sec: number) => `${sec.toFixed(1)} s`;

/** Settings asks for the graphics cards when the models are ready, never at launch (Phase 37, decision 2). */
watch(
  () => view.value === 'ready',
  (ready) => {
    if (ready) void settings.refreshDevices();
  },
  { immediate: true },
);

/** The choice is offered only when it is one: a card was found (decision 4). */
const showDevices = computed(() => settings.gpuDevices.length > 0);

/**
 * Where a run went: the card, labelled as in **Run on** (audit GPU-6), or the processor with its threads. A record
 * without either was the processor. A run that fell back names the card it didn't use (audit GPU-3).
 */
function ranOn(t: LocalRunRecord['timings']): string {
  if (t.device !== null) return cardLabel(t.device);
  const processor = t.threads === null ? 'Processor' : `Processor (${t.threads} threads)`;
  return t.fellBack ? `${processor}, not ${cardLabel(t.fellBack.device)}` : processor;
}

/** The last run on this computer: what a colleague can expect, and how the work laptop is measured (Phase 36). */
const lastRun = computed(() => {
  const run = job.lastLocalRun;
  if (!run || run.audioSec === null || run.audioSec <= 0) return null;
  const t = run.timings;
  return {
    line: `Last recording: ${formatTimestamp(run.audioSec)} of audio in ${formatTimestamp(t.totalSec)}.`,
    timings: [
      {
        label: 'Speed',
        value: t.totalSec > 0 ? `${(run.audioSec / t.totalSec).toFixed(1)}× real time` : '–',
      },
      { label: 'Reading the audio', value: seconds(t.decodeSec) },
      { label: 'Words', value: seconds(t.wordsSec) },
      { label: 'Speakers', value: seconds(t.speakersSec) },
      { label: 'Total', value: seconds(t.totalSec) },
      { label: 'Ran on', value: ranOn(t) },
      // Why the card wasn't used, for whoever helps (audit GPU-3). Decision 5: no message, only this.
      ...(t.fellBack ? [{ label: 'Why', value: t.fellBack.reason }] : []),
      {
        label: 'Peak memory',
        value:
          t.peakMemoryBytes === null
            ? 'Not measured'
            : `${(t.peakMemoryBytes / 1e9).toFixed(2)} GB`,
      },
    ],
  };
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
        <fieldset v-if="showDevices" class="run-on">
          <legend class="legend">Run on</legend>
          <div class="choices">
            <label v-for="option in settings.deviceOptions" :key="option.id" class="choice">
              <input
                type="radio"
                :name="ids.device"
                :value="option.id"
                :checked="option.id === settings.checkedDevice.id"
                @change="settings.setLocalDevice(option.choice)"
                @click="settings.setLocalDevice(option.choice)"
              />
              {{ option.label }}
            </label>
          </div>
        </fieldset>
        <div v-if="lastRun" class="last-run">
          <p>{{ lastRun.line }}</p>
          <details>
            <summary>Timings</summary>
            <dl class="timings">
              <template v-for="item in lastRun.timings" :key="item.label">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </template>
            </dl>
          </details>
        </div>
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
.run-on {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.legend {
  padding: 0;
  font-weight: 600;
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
}

.choice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}

.choice input {
  margin: 0;
  accent-color: var(--color-accent);
}

.last-run {
  display: grid;
  gap: var(--space-2);
}

.timings {
  display: grid;
  grid-template-columns: max-content auto;
  gap: var(--space-1) var(--space-4);
  margin: var(--space-2) 0 0;
  font-variant-numeric: tabular-nums;
}

.timings dt {
  color: var(--color-text-muted);
}

.timings dd {
  margin: 0;
}

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
