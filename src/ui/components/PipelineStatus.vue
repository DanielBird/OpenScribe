<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { usePipelineStore, type PipelineJob } from '../../stores/pipeline';
import { useProjectStore } from '../../stores/project';

// The pipeline's progress, Cancel, and an error with Resume (PROJECTS.md §5.3), as translation shows its own
// (DECISIONS.md D14). For one session (Output's actions row, a summary's notice), or for the whole queue (the foot of
// the sessions list). It emits `needKey` when Resume needs the Claude key first.
const props = withDefaults(
  defineProps<{
    /** One session's job and failure; leave it out for the whole queue. */
    sessionId?: string | null;
    /** Show a failure with Resume (Output). The summary pane shows failures itself. */
    showFailure?: boolean;
  }>(),
  { sessionId: null, showFailure: true },
);
const emit = defineEmits<{ needKey: [] }>();

const pipeline = usePipelineStore();
const project = useProjectStore();
const statusLine = useTemplateRef<HTMLElement>('statusLine');
const resumeButton = useTemplateRef<HTMLButtonElement>('resumeButton');

const job = computed<PipelineJob | null>(() =>
  props.sessionId ? pipeline.jobFor(props.sessionId) : pipeline.current,
);
const failure = computed(() =>
  props.sessionId && props.showFailure && !job.value ? pipeline.failureFor(props.sessionId) : null,
);
/** "Summarising 3 of 12" while the queue holds more than one session. */
const ofQueue = computed(() => {
  const { done, total } = pipeline.queueProgress;
  return !props.sessionId && total > 1 ? { done, total } : null;
});

function stepText(j: PipelineJob): string {
  if (j.current === 'translate') {
    const p = j.progress;
    return p && p.totalBatches > 1
      ? `translating, batch ${p.batch} of ${p.totalBatches}`
      : 'translating…';
  }
  if (j.current === 'summarise') return 'summarising…';
  return 'saving…';
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const line = computed(() => {
  const j = job.value;
  if (!j) return '';
  if (ofQueue.value) return `Summarising ${ofQueue.value.done + 1} of ${ofQueue.value.total}`;
  if (j.status === 'queued') {
    return j.kind === 'add' ? 'Waiting to add to the project' : 'Waiting to be summarised';
  }
  return j.kind === 'add' ? `Adding to project · ${stepText(j)}` : capitalise(stepText(j));
});

/** The bar: batches while translating one session, sessions for the queue. */
const bar = computed(() => {
  if (ofQueue.value) return { value: ofQueue.value.done, max: ofQueue.value.total };
  const p = job.value?.status === 'running' ? job.value.progress : null;
  return p && p.totalBatches > 1 ? { value: p.batch - 1, max: p.totalBatches } : null;
});

// Screen readers hear the start and the end; the error is announced by its own alert.
const announcement = ref('');
/** Set by Cancel, so the end is announced as cancelled. */
let cancelled = false;
let lastKind: PipelineJob['kind'] | null = null;

function doneText(): string {
  if (cancelled) return 'Cancelled.';
  if (!props.sessionId) return 'Summaries done.';
  return lastKind === 'add' ? 'Added to the project.' : 'Summary ready.';
}

watch(
  () => job.value?.status ?? null,
  (status, before) => {
    if (job.value) lastKind = job.value.kind;
    if (status === 'running' && before !== 'running') announcement.value = line.value;
    else if (status === null && before && !failure.value) announcement.value = doneText();
    if (status === null) cancelled = false;
  },
);

function cancel(): void {
  cancelled = true;
  pipeline.cancel();
}

async function resume(): Promise<void> {
  const f = failure.value;
  if (!f) return;
  if (f.reconnect && !(await project.reconnect())) return;
  if (pipeline.needsKey) {
    emit('needKey');
    return;
  }
  void pipeline.resume(f.sessionId);
}

/** Keeps focus here when the focused control goes away: the status line while working, else Resume. */
async function focus(): Promise<boolean> {
  await nextTick();
  if (job.value) statusLine.value?.focus();
  else if (failure.value) resumeButton.value?.focus();
  else return false;
  return true;
}

defineExpose({ focus });
</script>

<template>
  <div v-if="job || failure" class="pipeline-status">
    <div v-if="job" class="running">
      <span class="spinner" aria-hidden="true" />
      <p ref="statusLine" class="status-line" tabindex="-1">{{ line }}</p>
      <progress
        v-if="bar"
        class="progress"
        :aria-label="ofQueue ? 'Sessions summarised' : 'Translation progress'"
        :value="bar.value"
        :max="bar.max"
      />
      <button type="button" class="button" @click="cancel">Cancel</button>
    </div>

    <div v-else-if="failure" class="failed">
      <p class="error" role="alert">{{ failure.error.userMessage }}</p>
      <button ref="resumeButton" type="button" class="button" @click="resume">
        {{ failure.reconnect ? 'Reconnect' : 'Resume' }}
      </button>
    </div>
  </div>
  <span class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</span>
</template>

<style scoped>
.pipeline-status,
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
