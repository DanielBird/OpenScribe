<script setup lang="ts">
import { formatDateTime } from '../../domain/transcript';
import { useJobStore } from '../../stores/job';
import { useNavStore } from '../../stores/nav';
import { useTranscriptStore } from '../../stores/transcript';

// Offers the autosaved transcript (DECISIONS.md D10). Hidden while a new run is active.
const transcript = useTranscriptStore();
const job = useJobStore();
const nav = useNavStore();

// A failed or cancelled run hides the transcript on Output; opening it clears that run.
function open(): void {
  job.dismiss();
  nav.goTo('output');
}
</script>

<template>
  <div v-if="transcript.autosaveInfo && !job.isActive" class="last-transcript">
    <p>
      Last transcript: <span class="name">{{ transcript.autosaveInfo.fileName }}</span> ·
      {{ formatDateTime(transcript.autosaveInfo.createdAt) }}
    </p>
    <button type="button" class="button" @click="open">Open</button>
  </div>
</template>

<style scoped>
/* One quiet line under the recording, with Open right after it. */
.last-transcript {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  color: var(--color-text-muted);
}

.name {
  color: var(--color-text);
  font-weight: 600;
  overflow-wrap: anywhere;
}
</style>
