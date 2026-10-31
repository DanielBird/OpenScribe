<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useChatStore } from '../../stores/chat';
import { useProjectUi } from '../composables/useProjectUi';
import { PROVIDER_NAMES } from '../providerNames';
import ChatCompaction from './ChatCompaction.vue';
import ChatInput from './ChatInput.vue';
import ChatMessage from './ChatMessage.vue';
import KeyDialog from './KeyDialog.vue';
import SessionSearch from './SessionSearch.vue';

// The project chat (Phase 17, PROJECTS.md §5.5): the conversation, the notices that apply, and the question box. It
// follows a streaming answer unless the user has scrolled up. The store saves the chat in the project folder (D29);
// this pane says so only when a save failed, or when the open chat is a colleague's. The toggle under the box switches
// to the keyword search, which takes the conversation's place (D30). **New chat** is at the top of the Chats tab
// (ChatList); the pane keeps one only in the new-sessions notice. `/compact` in the box summarises the chat (D33).
const chat = useChatStore();
const ui = useProjectUi();
const list = useTemplateRef<HTMLElement>('list');
const input = useTemplateRef<InstanceType<typeof ChatInput>>('input');
const search = useTemplateRef<InstanceType<typeof SessionSearch>>('search');

/** Within this many pixels of the bottom, the list follows new text. */
const FOLLOW_SLACK = 32;
const following = ref(true);

function onScroll(): void {
  const el = list.value;
  if (!el) return;
  following.value = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
}

async function toBottom(): Promise<void> {
  if (!following.value) return;
  await nextTick();
  const el = list.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(() => chat.messages, toBottom, { flush: 'post' });

// --- Chat or Search -------------------------------------------------------------------------------------------

const searching = computed(() => ui.chatPaneMode === 'search');

/** The box of the mode shown: the question, or the search. */
function focusInput(): void {
  if (searching.value) search.value?.focus();
  else input.value?.focus();
}

async function setMode(mode: 'chat' | 'search'): Promise<void> {
  ui.chatPaneMode = mode;
  await nextTick();
  focusInput();
}

// A hidden list can't follow an answer, so it catches up when the chat is shown again.
watch(searching, (now) => {
  if (!now) void toBottom();
});

// --- Sending, with the key dialog when the key is missing -----------------------------------------------------

const keyDialog = ref(false);
let pending: (() => void) | null = null;

function withKey(action: () => void): void {
  if (!chat.needsKey) return action();
  pending = action;
  keyDialog.value = true;
}

function onKeyConfirmed(): void {
  keyDialog.value = false;
  const action = pending;
  pending = null;
  action?.();
  input.value?.focus();
}

function onKeyCancelled(): void {
  keyDialog.value = false;
  pending = null;
  input.value?.focus();
}

function send(text: string): void {
  withKey(() => {
    following.value = true;
    void chat.submit(text);
  });
}

function retry(): void {
  withKey(() => {
    following.value = true;
    void chat.retry();
  });
}

function newChat(): void {
  chat.newChat();
  following.value = true;
  input.value?.focus();
}

// --- Notices and the status for screen readers ----------------------------------------------------------------

const newSessions = computed(() => {
  const n = chat.newSessionCount;
  return n === 1
    ? '1 new session since this chat started.'
    : `${n} new sessions since this chat started.`;
});

/** "Answering…" or "Compacting…", then how it ended. The streamed text itself isn't announced. */
const status = computed(() => {
  if (chat.commandNote) return chat.commandNote;
  const last = chat.messages[chat.messages.length - 1];
  if (last?.role === 'compaction') {
    switch (last.status) {
      case 'running':
        return 'Compacting…';
      case 'done':
        return 'Chat compacted';
      case 'error':
        return last.error?.userMessage ?? '';
    }
  }
  if (last?.role !== 'assistant') return '';
  switch (last.status) {
    case 'streaming':
      return 'Answering…';
    case 'done':
    case 'limit':
      return 'Answer ready';
    case 'stopped':
      return 'Stopped';
    case 'error':
      return last.error?.userMessage ?? '';
  }
  return '';
});

defineExpose({ focusInput });
</script>

<template>
  <section class="chat-pane" aria-labelledby="chat-title">
    <h2 id="chat-title" class="visually-hidden">{{ searching ? 'Search' : 'Chat' }}</h2>

    <!-- Both modes stay mounted, so the chat's place and a search survive a change of mode. -->
    <div v-show="!searching" class="mode-panel">
      <div ref="list" class="messages" @scroll.passive="onScroll">
        <template v-for="m in chat.messages" :key="m.id">
          <ChatCompaction
            v-if="m.role === 'compaction'"
            :message="m"
            :corpus="chat.corpus"
            @retry="retry"
          />
          <ChatMessage v-else :message="m" :corpus="chat.corpus" @retry="retry" />
        </template>
      </div>

      <div v-if="chat.newSessionCount > 0" class="notice">
        <p>{{ newSessions }}</p>
        <button type="button" class="button" @click="newChat">New chat</button>
      </div>
      <p v-if="chat.modelChanged" class="notice">The model change applies to your next chat.</p>
      <!-- The sentence in its own p: a notice is a flex row, which would pull it apart around the kbd. -->
      <div v-if="chat.isLong" class="notice">
        <p>This chat is long. Type <kbd>/compact</kbd> to summarise it, or start a new chat.</p>
      </div>
      <div v-if="chat.saveError" class="notice" role="alert">
        <p>{{ chat.saveError }}</p>
        <button type="button" class="button" @click="chat.saveAgain()">Try again</button>
      </div>
      <p v-if="chat.ownerName" class="owner">
        {{ chat.ownerName }}’s chat. Asking saves a copy as yours.
      </p>
      <p v-if="chat.commandNote" class="note">{{ chat.commandNote }}</p>

      <ChatInput ref="input" :running="chat.running" @send="send" @stop="chat.stop()" />
    </div>
    <!-- Outside the panel, so an answer that ends during a search is still announced. -->
    <p class="visually-hidden" role="status">{{ status }}</p>
    <SessionSearch v-show="searching" ref="search" class="mode-panel" />

    <div class="modes" role="group" aria-label="Mode">
      <button type="button" class="mode" :aria-pressed="!searching" @click="setMode('chat')">
        Chat
      </button>
      <button type="button" class="mode" :aria-pressed="searching" @click="setMode('search')">
        Search
      </button>
    </div>

    <KeyDialog
      :open="keyDialog"
      title="Ask about the project"
      confirm-label="Ask"
      :provider="chat.provider"
      @confirm="onKeyConfirmed"
      @cancel="onKeyCancelled"
    >
      Your question, the project brief and the session summaries are sent to
      {{ PROVIDER_NAMES[chat.provider].company }}, with the transcript passages the agent reads to
      answer.
    </KeyDialog>
  </section>
</template>

<style scoped>
.chat-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
}

/* Chat mode's conversation, notices and box, or Search mode (SessionSearch): each fills the pane above the toggle. */
.mode-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
}

/*
 * Positioned, so the cards' visually hidden status lines stay inside its scroll area. The scroll area reaches
 * --scroll-bleed past the pane's right edge, which ProjectView sets to put the scrollbar at the page's edge.
 */
.messages {
  position: relative;
  display: grid;
  flex: 1;
  gap: var(--space-5);
  align-content: start;
  min-height: 0;
  margin-right: calc(-1 * var(--scroll-bleed, 0px));
  padding-right: var(--scroll-bleed, 0px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

.owner,
.note {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

kbd {
  padding: 0 var(--space-1);
  border: 1px solid currentcolor;
  border-radius: var(--radius-sm);
  font-family: inherit;
}

/*
 * A small version of the sidebar's Sessions | Chats control, close under the box; the shown mode is lifted. ProjectView
 * lowers the pane by this control's height and the space above it: change both together.
 */
.modes {
  display: grid;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  gap: 2px;
  align-self: flex-start;
  margin-top: calc(var(--space-1) - var(--space-3));
  padding: 2px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-text) 7%, var(--color-bg));
}

.mode {
  padding: 0.125rem var(--space-3);
  border: 0;
  border-radius: calc(var(--radius-md) - 2px);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.mode:hover {
  color: var(--color-text);
}

.mode[aria-pressed='true'] {
  background: var(--color-bg);
  color: var(--color-accent);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--color-text) 14%, transparent);
}

.mode:focus-visible {
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .mode {
    transition: none;
  }
}
</style>
