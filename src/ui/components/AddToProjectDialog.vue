<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { needsTranslation, usePipelineStore } from '../../stores/pipeline';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import { useProjectUi } from '../composables/useProjectUi';
import { PROVIDER_NAMES } from '../providerNames';
import ApiKeyField from './ApiKeyField.vue';
import BriefDialog from './BriefDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import ProjectModelSelect from './ProjectModelSelect.vue';

// The choices for **Add to project** (Phase 15): which project (open, create or reconnect one here), the project
// model (the setting the Analyse header shows), its provider's key if it's missing (Claude or Gemini, D26), and where
// the text goes. The work runs after the dialog closes, in the actions row.
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ add: []; cancel: [] }>();

const project = useProjectStore();
const pipeline = usePipelineStore();
const settings = useSettingsStore();
const transcript = useTranscriptStore();
const ui = useProjectUi();
const id = useId();
const loadingId = `${id}-loading`;

/** Decided when the dialog opens, so the field stays while the key is typed. */
const keyNeeded = ref(false);
const keyMissing = computed(() => settings.keyFor(settings.projectProvider).trim() === '');
const names = computed(() => PROVIDER_NAMES[settings.projectProvider]);
const ready = computed(() => project.status === 'ready');

const title = computed(() =>
  ready.value && project.projectName ? `Add to “${project.projectName}”` : 'Add to project',
);
const translates = computed(() => (transcript.doc ? needsTranslation(transcript.doc) : false));
const loadingText = computed(() => {
  const { done, total } = project.progress;
  return total === 0 ? 'Opening the project…' : `Reading ${done} of ${total} sessions`;
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    keyNeeded.value = pipeline.needsKey;
    project.notice = null;
  },
  { immediate: true },
);

// A change of model here can need the other provider's key: show its field, and keep it while the key is typed.
watch(
  () => settings.projectProvider,
  () => {
    if (props.open && pipeline.needsKey) keyNeeded.value = true;
  },
);

// A transcript that turns out to be in the project already is linked to it: there's nothing to add.
watch(
  () => transcript.projectLink,
  (link) => {
    if (props.open && link) emit('cancel');
  },
);

async function openOther(): Promise<void> {
  await project.openProject();
}

async function create(): Promise<void> {
  const result = await project.newProject();
  if (result?.created) ui.briefOpen = true;
}

function onConfirm(): void {
  if (ready.value && !keyMissing.value) emit('add');
}
</script>

<template>
  <ConfirmDialog
    :open="open"
    :title="title"
    confirm-label="Add"
    :confirm-disabled="!ready || keyMissing"
    @confirm="onConfirm"
    @cancel="emit('cancel')"
  >
    <div class="body">
      <div v-if="!ready" class="connect">
        <div v-if="project.status === 'reconnect'" class="actions">
          <button type="button" class="button" @click="project.reconnect()">
            Reconnect “{{ project.projectName }}”
          </button>
          <button type="button" class="button" @click="openOther">Open another project…</button>
          <button type="button" class="button" @click="create">New project…</button>
        </div>
        <template v-else-if="project.status === 'loading'">
          <p :id="loadingId">{{ loadingText }}</p>
          <progress
            class="progress"
            :value="project.progress.done"
            :max="Math.max(project.progress.total, 1)"
            :aria-labelledby="loadingId"
          />
        </template>
        <template v-else-if="project.status === 'error'">
          <p class="notice" role="alert">{{ project.error }}</p>
          <div class="actions">
            <button type="button" class="button" @click="project.retry()">Try again</button>
            <button type="button" class="button" @click="openOther">Open another project…</button>
            <button type="button" class="button" @click="create">New project…</button>
          </div>
        </template>
        <div v-else class="actions">
          <button type="button" class="button" @click="openOther">Open project…</button>
          <button type="button" class="button" @click="create">New project…</button>
        </div>
        <p v-if="project.notice" class="notice" role="alert">{{ project.notice }}</p>
      </div>

      <div class="field">
        <label :for="`${id}-model`" class="label">Model</label>
        <ProjectModelSelect :id="`${id}-model`" class="control" />
      </div>

      <ApiKeyField
        v-if="keyNeeded"
        :key="settings.projectProvider"
        :provider="settings.projectProvider"
        :label="names.keyLabel"
      />

      <p class="data-notice">
        The transcript text is sent to {{ names.company }} to
        {{ translates ? 'translate and summarise' : 'summarise' }}.
      </p>
    </div>
  </ConfirmDialog>
  <BriefDialog :open="open && ui.briefOpen" @close="ui.briefOpen = false" />
</template>

<style scoped>
.body,
.connect {
  display: grid;
  gap: var(--space-4);
}

.field {
  display: grid;
  gap: var(--space-1);
}

.label {
  font-weight: 600;
}

.connect {
  justify-items: start;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}

.notice {
  color: var(--color-danger);
}

.progress {
  width: min(24rem, 100%);
  accent-color: var(--color-accent);
}

.data-notice {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: var(--font-size-sm);
}
</style>
