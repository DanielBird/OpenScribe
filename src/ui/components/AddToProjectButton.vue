<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useNavStore } from '../../stores/nav';
import { needsTranslation, usePipelineStore } from '../../stores/pipeline';
import { useProjectStore } from '../../stores/project';
import { useTranscriptStore } from '../../stores/transcript';
import { useTranslationStore } from '../../stores/translation';
import { useProjectUi } from '../composables/useProjectUi';
import IconAdd from '../icons/IconAdd.vue';
import IconSummarise from '../icons/IconSummarise.vue';
import AddToProjectDialog from './AddToProjectDialog.vue';
import PipelineStatus from './PipelineStatus.vue';
import SummariseDialog from './SummariseDialog.vue';

// **Add to project** in the Output actions row (PROJECTS.md §5.3, A14) and, while it works, its progress there, as
// translation shows its own (DECISIONS.md D14). The row's primary button, last. Once the transcript is in a project
// (the header says which), **Open summary** takes its place when its summary is made: it shows that summary in Analyse
// mode, where the chat is. Added without one (D62), **Summarise** makes it.
const transcript = useTranscriptStore();
const translation = useTranslationStore();
const pipeline = usePipelineStore();
const project = useProjectStore();
const nav = useNavStore();
const ui = useProjectUi();

const choosing = ref(false);
/** **Summarise** (or Resume of a failed summary) needs the key first. */
const keyDialog = ref(false);
const mainButton = useTemplateRef<HTMLButtonElement>('mainButton');
const summaryButton = useTemplateRef<HTMLButtonElement>('summaryButton');
const summariseButton = useTemplateRef<HTMLButtonElement>('summariseButton');
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
/** This session in the open project, with nothing running for it; null otherwise. */
const session = computed(() => {
  const link = transcript.projectLink;
  if (!available.value || !link || busy.value || !docId.value) return null;
  if (project.status !== 'ready' || project.project?.id !== link.projectId) return null;
  return project.session(docId.value);
});
/** With a summary, up to date or not. */
const showSummary = computed(() => session.value?.summary != null);
/** Added without a summary (D62). Not while a translation runs: the summary would read the English it changes. */
const showSummarise = computed(
  () => session.value != null && session.value.summary == null && !translation.isRunning,
);
const translates = computed(() => (transcript.doc ? needsTranslation(transcript.doc) : false));

/**
 * When the focused control disappears (Add to project, Summarise, Cancel, Resume), keep focus here, not at the top of
 * the page. After a modal closes, Chromium can leave focus inside the closed dialog: that counts as lost.
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
  const button = mainButton.value ?? summaryButton.value ?? summariseButton.value;
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

function onAdd(options: { summarise: boolean }): void {
  choosing.value = false;
  void pipeline.addCurrentTranscript(options);
  void keepFocus();
}

function summarise(): void {
  if (!docId.value) return;
  if (pipeline.needsKey) {
    keyDialog.value = true;
    return;
  }
  void pipeline.summarise([docId.value]);
}

/** Resume asked for the key: a failed summary asks as Summarise does, a failed add as Add to project. */
function onNeedKey(): void {
  const failure = docId.value ? pipeline.failureFor(docId.value) : null;
  if (failure?.kind === 'summarise') keyDialog.value = true;
  else choosing.value = true;
}

function onKeyConfirmed(): void {
  keyDialog.value = false;
  // Resumes a failed summary, or starts one.
  if (docId.value) void pipeline.summarise([docId.value]);
  void keepFocus();
}
</script>

<template>
  <div v-if="available" class="add-to-project">
    <button
      v-if="showButton"
      ref="mainButton"
      type="button"
      class="button button-primary button-icon"
      aria-label="Add to project…"
      @click="choosing = true"
    >
      <IconAdd />
      <span class="icon-tip" aria-hidden="true">Add to project…</span>
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
    <button
      v-else-if="showSummarise"
      ref="summariseButton"
      type="button"
      class="button button-icon"
      aria-label="Summarise"
      @click="summarise"
    >
      <IconSummarise />
      <span class="icon-tip" aria-hidden="true">Summarise</span>
    </button>
    <PipelineStatus ref="status" :session-id="docId" @need-key="onNeedKey" />
    <AddToProjectDialog :open="choosing" @add="onAdd" @cancel="choosing = false" />
    <SummariseDialog
      :open="keyDialog"
      title="Summarise"
      message=""
      confirm-label="Summarise"
      :translates="translates"
      @confirm="onKeyConfirmed"
      @cancel="keyDialog = false"
    />
  </div>
</template>

<style scoped>
/* Its button and status sit in the actions row like the others. */
.add-to-project {
  display: contents;
}
</style>
