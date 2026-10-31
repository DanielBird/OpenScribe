<script setup lang="ts">
import { ref, useId, useTemplateRef } from 'vue';

// The question box (Phase 17). Enter sends and Shift+Enter starts a new line. While an answer is written the box
// stays usable, but nothing is sent until it finishes: **Send** is **Stop** then.
const props = defineProps<{ running: boolean }>();
const emit = defineEmits<{ send: [question: string]; stop: [] }>();

const id = useId();
const draft = ref('');
const box = useTemplateRef<HTMLTextAreaElement>('box');

function send(): void {
  if (props.running || draft.value.trim() === '') return;
  emit('send', draft.value.trim());
  draft.value = '';
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  send();
}

/** **Stop** while an answer runs; otherwise the button submits the form (**Send**). */
function onButton(event: MouseEvent): void {
  if (!props.running) return;
  event.preventDefault();
  emit('stop');
}

function focus(): void {
  box.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <form class="chat-input" @submit.prevent="send">
    <label :for="`${id}-question`" class="visually-hidden">Question</label>
    <textarea
      :id="`${id}-question`"
      ref="box"
      v-model="draft"
      class="control box"
      rows="1"
      placeholder="Ask about the project…"
      @keydown="onKeydown"
    />
    <!-- One button, so focus stays on it when Send turns into Stop and back. -->
    <button
      :type="running ? 'button' : 'submit'"
      class="button"
      :class="{ 'button-primary': !running }"
      :aria-label="running ? 'Stop' : 'Send'"
      @click="onButton"
    >
      <svg
        class="icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect v-if="running" x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
        <path v-else d="M8 13V3M4 7l4-4 4 4" />
      </svg>
    </button>
  </form>
</template>

<style scoped>
.chat-input {
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
}

.box {
  flex: 1;
  min-width: 0;
  max-height: calc(8lh + 2 * var(--space-2));
  resize: none;
  field-sizing: content;
}

/* A square as tall as the box's first line (line, padding and border), so Send and Stop share one size. */
.button {
  flex: none;
  justify-content: center;
  width: calc(var(--line-height) * 1em + 2 * var(--space-2) + 2px);
  height: calc(var(--line-height) * 1em + 2 * var(--space-2) + 2px);
  padding: 0;
}

.icon {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
