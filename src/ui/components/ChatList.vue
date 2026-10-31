<script setup lang="ts">
import { computed, useId, useTemplateRef } from 'vue';
import { formatDateTime } from '../../domain/transcript';
import { useChatStore } from '../../stores/chat';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { useProjectUi } from '../composables/useProjectUi';
import { useRovingListbox } from '../composables/useRovingListbox';

// The project's saved chats (DECISIONS.md D29), yours and colleagues', the last one added to first. Selecting one
// opens it in the chat pane, in place of a summary. One Tab stop (`useRovingListbox`), as in SessionList. The
// sidebar's Chats tab shows the count, so the heading is for screen readers only. **New chat** at the top clears the
// chat pane, closing a summary or a search, and ProjectView puts focus in its question box.
const emit = defineEmits<{ new: [] }>();
const project = useProjectStore();
const chat = useChatStore();
const settings = useSettingsStore();
const ui = useProjectUi();
const id = useId();
const listEl = useTemplateRef<HTMLElement>('list');

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const rows = computed(() =>
  project.chats.map((entry) => {
    const { file } = entry;
    return {
      id: file.id,
      entry,
      title: file.title,
      who: file.author.id === settings.chatAuthor.id ? 'You' : file.author.name,
      when: formatDateTime(file.updatedAt),
    };
  }),
);

function select(chatId: string): void {
  const row = rows.value.find((r) => r.id === chatId);
  if (!row) return;
  ui.selected = null;
  ui.chatPaneMode = 'chat';
  chat.open(row.entry);
}

const { focusId, tabStop, onKeydown } = useRovingListbox({
  ids: () => rows.value.map((r) => r.id),
  selected: () => chat.chatId,
  list: listEl,
  select,
});

function onClick(chatId: string): void {
  focusId.value = chatId;
  select(chatId);
}

function newChat(): void {
  ui.selected = null;
  ui.chatPaneMode = 'chat';
  chat.newChat();
  emit('new');
}
</script>

<template>
  <section class="chat-list" :aria-labelledby="`${id}-title`">
    <h2 :id="`${id}-title`" class="visually-hidden">Chats {{ project.chats.length }}</h2>

    <button type="button" class="new-chat" @click="newChat">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
      New chat
    </button>

    <ul
      v-if="rows.length > 0"
      ref="list"
      class="chats"
      role="listbox"
      :aria-labelledby="`${id}-title`"
    >
      <li
        v-for="(row, index) in rows"
        :key="row.id"
        class="chat"
        :class="{ selected: chat.chatId === row.id }"
        role="option"
        :aria-selected="chat.chatId === row.id"
        :tabindex="tabStop === row.id ? 0 : -1"
        :data-item-id="row.id"
        @click="onClick(row.id)"
        @focus="focusId = row.id"
        @keydown="onKeydown($event, index, row.id)"
      >
        <span class="title">{{ row.title }}</span>
        <span class="meta" aria-hidden="true">
          <span class="who">{{ row.who }}</span>
          <span class="when">{{ row.when }}</span>
        </span>
        <span class="visually-hidden">{{ row.who }}, {{ row.when }}.</span>
      </li>
    </ul>
    <p v-else-if="project.chatsLoaded" class="empty">No chats yet.</p>

    <details v-if="project.chatProblems.length > 0" class="problems">
      <summary>{{ plural(project.chatProblems.length, 'file', 'files') }} couldn't be read</summary>
      <ul>
        <li v-for="p in project.chatProblems" :key="p.file">
          <span class="file">{{ p.file }}</span
          >: {{ p.message }}
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
/*
 * Drawn like SessionList, for the tinted sidebar: no lines, one line per chat. The open chat is lifted onto white and
 * shows its whole title, who saved it and when.
 */
.chat-list {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-2);
}

/* A row like the chats', in the accent colour, so it reads as the list's first action. */
.new-chat {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.4375rem var(--space-2);
  border: 0;
  border-radius: calc(var(--radius-md) - 2px);
  background: transparent;
  color: var(--color-accent);
  font: inherit;
  font-weight: 600;
  text-align: start;
  cursor: pointer;
  transition: background-color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.new-chat:hover {
  background: color-mix(in srgb, var(--color-bg) 70%, transparent);
}

.new-chat:focus-visible {
  outline-offset: -2px;
}

.new-chat svg {
  flex: none;
}

.chats {
  display: grid;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  padding: 0.4375rem var(--space-2);
  border-radius: calc(var(--radius-md) - 2px);
  cursor: pointer;
  transition:
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.chat:hover {
  background: color-mix(in srgb, var(--color-bg) 70%, transparent);
}

.chat.selected {
  row-gap: 2px;
  padding-block: var(--space-2);
  background: var(--color-bg);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--color-text) 10%, transparent);
}

/* Inside the row, so the scrolling pane doesn't clip the ring. */
.chat:focus-visible {
  outline-offset: -2px;
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat.selected .title {
  color: var(--color-accent);
  overflow-wrap: anywhere;
  white-space: normal;
}

/* Who saved it and when, on one line: a long name gives way to the date. */
.meta {
  display: none;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.chat.selected .meta {
  display: flex;
}

.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.when {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.empty {
  padding-inline: var(--space-2);
  color: var(--color-text-muted);
}

.problems {
  padding-inline: var(--space-2);
}

/* Chevron drawn like SessionList's: down when closed, up when open. */
.problems summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-warning);
  font-weight: 600;
  cursor: pointer;
}

.problems summary::after {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid;
  border-bottom: 1.5px solid;
  content: '';
  transform: translateY(-25%) rotate(45deg);
  transition: transform 0.2s ease-out;
}

.problems[open] summary::after {
  transform: translateY(25%) rotate(-135deg);
}

.problems ul {
  display: grid;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  list-style: none;
}

.file {
  color: var(--color-text);
  overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
  .new-chat,
  .chat,
  .problems summary::after {
    transition: none;
  }
}
</style>
