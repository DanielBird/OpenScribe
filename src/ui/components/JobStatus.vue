<script setup lang="ts">
import { computed } from 'vue';
import { formatBytes } from '../../domain/filecheck';
import { formatTimestamp } from '../../domain/transcript';
import { useJobStore } from '../../stores/job';
import ErrorDetails from './ErrorDetails.vue';

// Progress, error and cancelled states of a transcription run. Only the phase is announced (the
// status line); the changing percentage and the timer are not, so screen readers aren't flooded.
const job = useJobStore();

/** Errors that a retry of the same request can't fix: the key or the request must change first. */
const NEEDS_SETUP_CHANGE = new Set(['auth', 'validation']);

const phaseText = computed(() => {
  switch (job.status) {
    case 'uploading':
      return 'Uploading';
    case 'processing':
      return 'Transcribing…';
    case 'error':
      return job.error?.userMessage ?? 'The transcription failed.';
    case 'cancelled':
      return 'Transcription cancelled.';
    default:
      return '';
  }
});

const upload = computed(() => {
  const p = job.progress;
  if (!p || p.total <= 0) return null;
  const loaded = Math.min(p.loaded, p.total);
  const percent = Math.floor((loaded / p.total) * 100);
  return {
    loaded,
    total: p.total,
    text: `${percent}% (${formatBytes(loaded)} of ${formatBytes(p.total)})`,
  };
});

const canRetry = computed(
  () => job.status === 'error' && !NEEDS_SETUP_CHANGE.has(job.error?.kind ?? ''),
);
</script>

<template>
  <div class="job-status" :class="`is-${job.status}`" data-testid="job-status">
    <div class="line">
      <span v-if="job.isActive" class="spinner" aria-hidden="true" />
      <svg
        v-else-if="job.status === 'error'"
        class="icon"
        viewBox="0 0 16 16"
        width="20"
        height="20"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <rect x="7.1" y="3.5" width="1.8" height="6" rx="0.9" fill="var(--color-bg)" />
        <circle cx="8" cy="11.9" r="1.1" fill="var(--color-bg)" />
      </svg>
      <p class="text">
        <span role="status" aria-live="polite">{{ phaseText }}</span>
        <!-- Explicit spaces: the template compiler drops leading whitespace here. -->
        <template v-if="job.status === 'uploading' && upload">{{ ` ${upload.text}` }}</template>
        <span v-if="job.status === 'processing'" role="timer">{{
          ` ${formatTimestamp(job.elapsedSec)}`
        }}</span>
      </p>
    </div>
    <ErrorDetails v-if="job.status === 'error'" :error="job.error" />

    <progress
      v-if="job.status === 'uploading'"
      class="progress"
      aria-label="Upload progress"
      :value="upload?.loaded ?? 0"
      :max="upload?.total ?? 1"
    />
    <p v-if="job.status === 'processing'" class="hint">
      Long recordings take several minutes. Keep this tab open.
    </p>

    <div v-if="job.isActive || canRetry || job.status === 'cancelled'" class="actions">
      <button v-if="job.isActive" type="button" class="button" @click="job.cancel()">Cancel</button>
      <button v-if="canRetry" type="button" class="button button-primary" @click="job.retry()">
        Try again
      </button>
      <button
        v-if="job.status === 'cancelled'"
        type="button"
        class="button button-primary"
        @click="job.retry()"
      >
        Start again
      </button>
    </div>
  </div>
</template>

<style scoped>
.job-status {
  display: grid;
  justify-items: start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  --color-button: var(--color-bg);
}

.job-status.is-error {
  border-color: var(--color-danger);
}

.line {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.text {
  font-weight: 600;
}

.is-error .text {
  font-weight: normal;
}

.icon {
  flex: none;
  color: var(--color-danger);
}

.progress {
  width: min(100%, 30rem);
  height: 0.75rem;
  accent-color: var(--color-accent);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
