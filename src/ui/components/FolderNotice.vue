<script setup lang="ts">
import { ref } from 'vue';
import { useSummaryEditStore } from '../../stores/summaryEdit';
import { useTranscriptStore } from '../../stores/transcript';

// Why DeScribe stopped saving a project file (PROJECTS.md §5.2), and the way on: the Output tab's transcript (still
// saved in this browser meanwhile), or a summary being edited in Project mode (Phase 39, kept on screen meanwhile).
// Both stores give the same notice and the same actions.
const props = withDefaults(defineProps<{ source?: 'transcript' | 'summary' }>(), {
  source: 'transcript',
});
const store = props.source === 'summary' ? useSummaryEditStore() : useTranscriptStore();
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
  <div v-if="store.folderNotice" class="folder-notice" role="alert">
    <template v-if="store.folderNotice.kind === 'conflict'">
      <p>The project's copy of this {{ source }} has changed.</p>
      <div class="actions">
        <button
          type="button"
          class="button"
          :disabled="working"
          @click="act(() => store.resolveConflict('reload'))"
        >
          Reload
        </button>
        <button
          type="button"
          class="button"
          :disabled="working"
          @click="act(() => store.resolveConflict('keep'))"
        >
          Keep mine
        </button>
      </div>
    </template>
    <template v-else-if="store.folderNotice.kind === 'reconnect'">
      <p>DeScribe no longer has access to “{{ store.folderNotice.projectName }}”.</p>
      <div class="actions">
        <button
          type="button"
          class="button"
          :disabled="working"
          @click="act(() => store.reconnectFolder())"
        >
          Reconnect
        </button>
      </div>
    </template>
    <template v-else-if="store.folderNotice.kind === 'retry'">
      <p>{{ store.folderNotice.message }}</p>
      <div class="actions">
        <button
          type="button"
          class="button"
          :disabled="working"
          @click="act(() => store.retryFolderSave())"
        >
          Try again
        </button>
      </div>
    </template>
    <p v-else>
      Open “{{ store.folderNotice.projectName }}” in Analyse mode to save your changes to it.
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
