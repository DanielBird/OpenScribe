<script setup lang="ts">
import { ref } from 'vue';
import { useTranscriptStore } from '../../stores/transcript';

// Why the Output tab stopped saving a project transcript to its file (PROJECTS.md §5.2), and the way on. The
// transcript is still saved in this browser meanwhile.
const transcript = useTranscriptStore();
const working = ref(false);

async function act(action: () => Promise<void>): Promise<void> {
  if (working.value) return;
  working.value = true;
  try {
    await action();
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div v-if="transcript.folderNotice" class="folder-notice" role="alert">
    <template v-if="transcript.folderNotice.kind === 'conflict'">
      <p>The project's copy of this transcript has changed.</p>
      <div class="actions">
        <button
          type="button"
          class="button"
          :disabled="working"
          @click="act(() => transcript.resolveConflict('reload'))"
        >
          Reload
        </button>
        <button
          type="button"
          class="button"
          :disabled="working"
          @click="act(() => transcript.resolveConflict('keep'))"
        >
          Keep mine
        </button>
      </div>
    </template>
    <template v-else-if="transcript.folderNotice.kind === 'reconnect'">
      <p>DeScribe no longer has access to “{{ transcript.folderNotice.projectName }}”.</p>
      <div class="actions">
        <button
          type="button"
          class="button"
          :disabled="working"
          @click="act(() => transcript.reconnectFolder())"
        >
          Reconnect
        </button>
      </div>
    </template>
    <template v-else-if="transcript.folderNotice.kind === 'retry'">
      <p>{{ transcript.folderNotice.message }}</p>
      <div class="actions">
        <button
          type="button"
          class="button"
          :disabled="working"
          @click="act(() => transcript.retryFolderSave())"
        >
          Try again
        </button>
      </div>
    </template>
    <p v-else>
      Open “{{ transcript.folderNotice.projectName }}” in Analyse mode to save your changes to it.
    </p>
  </div>
</template>

<style scoped>
.folder-notice {
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

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
