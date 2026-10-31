<script setup lang="ts">
import type { CorpusReader } from '../../features/agent/corpus';
import type { ChatCompactionMessage } from '../../stores/chat';
import AnswerBlocks from './AnswerBlocks.vue';
import ChatActivity from './ChatActivity.vue';

// A `/compact` in the project chat (Phase 22, D33): a divider, since the agent now remembers only its summary of the
// messages above it. The summary and its cost open under it; opening moves nothing already shown.
defineProps<{ message: ChatCompactionMessage; corpus: CorpusReader | null }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="chat-compaction" :aria-busy="message.status === 'running'">
    <details v-if="message.status === 'done'">
      <summary>Earlier messages summarised</summary>
      <div class="summary">
        <AnswerBlocks :blocks="message.blocks" :corpus="corpus" />
        <ChatActivity :activity="[]" :cost-usd="message.costUsd" />
      </div>
    </details>
    <p v-else-if="message.status === 'running'" class="running">
      <span class="spinner" role="presentation" aria-hidden="true" />
      Compacting…
    </p>
    <div v-else-if="message.error" class="error">
      <p>{{ message.error.userMessage }}</p>
      <button type="button" class="button" @click="emit('retry')">Try again</button>
    </div>
  </div>
</template>

<style scoped>
.chat-compaction {
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

summary,
.running {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

summary {
  width: fit-content;
  cursor: pointer;
}

.summary {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.running {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.running .spinner {
  width: 1rem;
  height: 1rem;
  border-width: 2px;
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.error p {
  color: var(--color-danger);
}
</style>
