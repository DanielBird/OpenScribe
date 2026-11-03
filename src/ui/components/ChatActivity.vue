<script setup lang="ts">
import { computed } from 'vue';
import { plural } from '../../domain/text';
import type { ChatActivity } from '../../stores/chat';

// What the agent did for one answer, collapsed (A10): "6 searches · 5 reads · ≈ $0.40", opening to one line per tool
// call. Nothing shows when there was no tool call and the cost is unknown.
const props = defineProps<{ activity: readonly ChatActivity[]; costUsd: number | null }>();

const READS = new Set(['read_transcript', 'get_summaries']);

function formatCost(usd: number): string {
  return usd < 0.01 ? '< $0.01' : `≈ $${usd.toFixed(2)}`;
}

const summary = computed(() => {
  const searches = props.activity.filter((a) => a.tool === 'search_transcripts').length;
  const reads = props.activity.filter((a) => READS.has(a.tool)).length;
  return [
    searches > 0 ? plural(searches, 'search', 'searches') : null,
    reads > 0 ? plural(reads, 'read', 'reads') : null,
    searches + reads === 0 && props.activity.length > 0
      ? plural(props.activity.length, 'step', 'steps')
      : null,
    props.costUsd === null ? null : formatCost(props.costUsd),
  ]
    .filter(Boolean)
    .join(' · ');
});
</script>

<template>
  <details v-if="activity.length > 0" class="chat-activity">
    <summary>{{ summary }}</summary>
    <ul class="lines">
      <li v-for="(a, i) in activity" :key="i" :class="{ failed: a.isError }">
        {{ a.line }}<template v-if="a.isError"> (failed)</template>
      </li>
    </ul>
  </details>
  <p v-else-if="costUsd !== null" class="chat-activity">{{ summary }}</p>
</template>

<style scoped>
.chat-activity {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

summary {
  width: fit-content;
  cursor: pointer;
}

.lines {
  display: grid;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding-left: var(--space-5);
}

.lines li {
  overflow-wrap: anywhere;
}

.failed {
  color: var(--color-danger);
}
</style>
