<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useNavStore } from '../../stores/nav';
import { usePipelineStore } from '../../stores/pipeline';
import { useProjectStore } from '../../stores/project';
import { useTranscriptStore } from '../../stores/transcript';
import { useTranslationStore } from '../../stores/translation';
import { useProjectUi } from '../composables/useProjectUi';
import AddToProjectDialog from './AddToProjectDialog.vue';
import PipelineStatus from './PipelineStatus.vue';

// **Add to project** in the Output actions row (PROJECTS.md §5.3, A14) and, while it works, its progress there, as
// translation shows its own (DECISIONS.md D14). The row's primary button, last. Once the transcript is in a project
// (the header says which) and its summary is made, **Open summary** takes its place: it shows that summary in Analyse
// mode, where the chat is.
const transcript = useTranscriptStore();
const translation = useTranslationStore();
const pipeline = usePipelineStore();
const project = useProjectStore();
const nav = useNavStore();
const ui = useProjectUi();

const choosing = ref(false);
const mainButton = useTemplateRef<HTMLButtonElement>('mainButton');
const summaryButton = useTemplateRef<HTMLButtonElement>('summaryButton');
const status = useTemplateRef<InstanceType<typeof PipelineStatus>>('status');

const docId = computed(() => transcript.doc?.id ?? null);
const available = computed(
  () => (transcript.doc?.turns.length ?? 0) > 0 && project.status !== 'unsupported',
);
const busy = computed(() =>
  docId.value
    ? pipeline.jobFor(docId.value) !== null || pipeline.failureFor(docId.value) !== null
    : false,
);
const showButton = computed(
  () => available.value && !transcript.projectLink && !translation.isRunning && !busy.value,
);
/** In the open project, with a summary (up to date or not), and nothing running for it. */
const showSummary = computed(() => {
  const link = transcript.projectLink;
  if (!available.value || !link || busy.value || !docId.value) return false;
  if (project.status !== 'ready' || project.project?.id !== link.projectId) return false;
  return project.session(docId.value)?.summary != null;
});

/**
 * When the focused control disappears (Add to project, Cancel, Resume), keep focus here, not at the top of the
 * page. After a modal closes, Chromium can leave focus inside the closed dialog: that counts as lost.
 */
async function keepFocus(): Promise<void> {
  await nextTick();
  const active = document.activeElement;
  const lost =
    !active ||
    active === document.body ||
    !active.isConnected ||
    active.closest('dialog:not([open])') !== null;
  if (!lost) return;
  if (await status.value?.focus()) return;
  const button = mainButton.value ?? summaryButton.value;
  if (button) button.focus();
  // Added: the button is gone for good. The view's heading, as after a run (OutputView).
  else document.getElementById('output-title')?.focus();
}

watch(
  () => (docId.value ? pipeline.statusOf(docId.value) : null),
  () => void keepFocus(),
);

/** Shows this session's summary in Analyse mode, in place of the chat. */
function openSummary(): void {
  if (!docId.value) return;
  ui.choosing = false;
  ui.selected = docId.value;
  nav.enter('project');
}

function onAdd(): void {
  choosing.value = false;
  void pipeline.addCurrentTranscript();
  void keepFocus();
}
</script>

<template>
  <div v-if="available" class="add-to-project">
    <button
      v-if="showButton"
      ref="mainButton"
      type="button"
      class="button button-primary"
      @click="choosing = true"
    >
      Add to project…
    </button>
    <button
      v-else-if="showSummary"
      ref="summaryButton"
      type="button"
      class="button"
      @click="openSummary"
    >
      Open summary
    </button>
    <PipelineStatus ref="status" :session-id="docId" @need-key="choosing = true" />
    <AddToProjectDialog :open="choosing" @add="onAdd" @cancel="choosing = false" />
  </div>
</template>

<style scoped>
/* Its button and status sit in the actions row like the others. */
.add-to-project {
  display: contents;
}
</style>
