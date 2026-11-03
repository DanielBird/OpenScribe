<script setup lang="ts">
import type { CorpusReader } from '../../features/agent/corpus';
import type { ChatAssistantMessage, ChatUserMessage } from '../../stores/chat';
import AnswerBlocks from './AnswerBlocks.vue';
import ChatActivity from './ChatActivity.vue';
import ErrorDetails from './ErrorDetails.vue';

// One message of the project chat: a question as plain text, or an answer with its quotes and what the agent did.
// A compaction is a ChatCompaction.
defineProps<{ message: ChatUserMessage | ChatAssistantMessage; corpus: CorpusReader | null }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="message.role === 'user'" class="chat-message question">{{ message.text }}</div>
  <div v-else class="chat-message answer" :aria-busy="message.status === 'streaming'">
    <AnswerBlocks v-if="message.blocks.length > 0" :blocks="message.blocks" :corpus="corpus" />
    <span
      v-else-if="message.status === 'streaming'"
      class="spinner"
      role="presentation"
      aria-hidden="true"
    />
    <p v-if="message.status === 'stopped'" class="status">Stopped</p>
    <p v-else-if="message.status === 'limit'" class="status">
      Stopped at a limit. The answer may be incomplete.
    </p>
    <div v-else-if="message.status === 'error' && message.error" class="error">
      <p>{{ message.error.userMessage }}</p>
      <button type="button" class="button" @click="emit('retry')">Try again</button>
      <ErrorDetails :error="message.error" />
    </div>
    <ChatActivity :activity="message.activity" :cost-usd="message.costUsd" />
  </div>
</template>

<style scoped>
.chat-message {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.question {
  justify-self: end;
  max-width: min(36rem, 90%);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.status {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
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
