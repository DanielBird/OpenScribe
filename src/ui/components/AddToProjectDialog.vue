<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue';
import { useChatStore } from '../../stores/chat';
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

// The choices for **Add to project** (Phase 15): which project (a recent one, D49, or open, create or reconnect one
// here), the project model (the setting the Analyse header shows), its provider's key if it's missing (Claude or
// Gemini, D26), and where the text goes. The work runs after the dialog closes, in the actions row.
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ add: []; cancel: [] }>();

const project = useProjectStore();
const pipeline = usePipelineStore();
const chat = useChatStore();
const settings = useSettingsStore();
const transcript = useTranscriptStore();
const ui = useProjectUi();
const id = useId();
const loadingId = `${id}-loading`;
const body = useTemplateRef<HTMLElement>('body');
const projectSelect = useTemplateRef<HTMLSelectElement>('projectSelect');

/** Decided when the dialog opens, so the field stays while the key is typed. */
const keyNeeded = ref(false);
const keyMissing = computed(() => settings.keyFor(settings.projectProvider).trim() === '');
const names = computed(() => PROVIDER_NAMES[settings.projectProvider]);
const ready = computed(() => project.status === 'ready');
const loading = computed(() => project.status === 'loading');

/** The project in use is first in the recent list. */
const currentId = computed(() => project.recentProjects[0]?.id ?? null);
/** The dropdown's choice. Only **Add** opens it, so **Cancel** changes nothing. */
const chosenId = ref<string | null>(null);
const other = computed(() => chosenId.value !== null && chosenId.value !== currentId.value);
/** **Add** is opening the chosen project. */
const opening = ref(false);
/** A transcript in a project, or with a failed job, is here only for the key: its project is settled. */
const canChoose = computed(() => {
  const doc = transcript.doc;
  return !transcript.projectLink && !(doc && pipeline.failureFor(doc.id));
});
/** Changing project cancels this work: the pipeline and the chat belong to the project they started in. */
const locked = computed(() => pipeline.isBusy || chat.running);
const showSelect = computed(() => canChoose.value && project.recentProjects.length > 1);
const canAdd = computed(() => {
  if (keyMissing.value || opening.value || loading.value) return false;
  return other.value ? !locked.value : ready.value;
});

const title = computed(() =>
  !showSelect.value && ready.value && project.projectName
    ? `Add to ${project.projectName}`
    : 'Add to project',
);
const translates = computed(() => (transcript.doc ? needsTranslation(transcript.doc) : false));
const announcement = ref('');
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
    announcement.value = '';
  },
  { immediate: true },
);

// Back to the project in use when the dialog opens, when another project opens, or when a chosen folder turns out to
// be gone.
watch(
  [() => props.open, () => project.recentProjects],
  ([open]) => {
    if (open) chosenId.value = currentId.value;
  },
  { immediate: true },
);

const firstControl = () =>
  body.value?.querySelector<HTMLElement>(
    'select:not(:disabled), button:not(:disabled), input:not(:disabled)',
  );

/** A load replaces the button that started it: if that had focus, focus stays in the dialog. */
async function keepFocus(): Promise<void> {
  await nextTick();
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected) firstControl()?.focus();
}

watch(
  () => project.status,
  (now, before) => {
    if (!props.open) return;
    if (now === 'loading') {
      announcement.value = 'Opening the project…';
    } else if (before === 'loading') {
      if (now === 'ready') announcement.value = `${project.projectName ?? 'The project'} is open.`;
      void keepFocus();
    }
  },
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

async function onConfirm(): Promise<void> {
  if (!canAdd.value) return;
  if (other.value && chosenId.value !== null) {
    opening.value = true;
    // Straight from the click, as the browser may ask for access.
    const opened = await project.openRecent(chosenId.value);
    opening.value = false;
    if (!opened) {
      await nextTick();
      (projectSelect.value ?? firstControl())?.focus();
      return;
    }
    // Cancelled while it opened, or the transcript turned out to be in that project: nothing to add.
    if (!props.open || transcript.projectLink) return;
  }
  emit('add');
}
</script>

<template>
  <ConfirmDialog
    :open="open"
    :title="title"
    confirm-label="Add"
    :confirm-disabled="!canAdd"
    @confirm="onConfirm"
    @cancel="emit('cancel')"
  >
    <div ref="body" class="body">
      <p class="visually-hidden" role="status">{{ announcement }}</p>

      <div v-if="showSelect" class="field">
        <label :for="`${id}-project`" class="label">Project</label>
        <select
          :id="`${id}-project`"
          ref="projectSelect"
          v-model="chosenId"
          class="control list-select"
          :disabled="locked || opening || loading"
          @change="project.notice = null"
        >
          <option v-for="p in project.recentProjects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
      </div>

      <div v-if="!ready || canChoose" class="connect">
        <template v-if="loading">
          <p :id="loadingId">{{ loadingText }}</p>
          <progress
            class="progress"
            :value="project.progress.done"
            :max="Math.max(project.progress.total, 1)"
            :aria-labelledby="loadingId"
          />
        </template>
        <div v-else-if="ready || other" class="actions">
          <button type="button" class="button" :disabled="locked || opening" @click="openOther">
            Open another project…
          </button>
          <button type="button" class="button" :disabled="locked || opening" @click="create">
            New project…
          </button>
        </div>
        <div v-else-if="project.status === 'reconnect'" class="actions">
          <button type="button" class="button" @click="project.reconnect()">
            Reconnect “{{ project.projectName }}”
          </button>
          <button type="button" class="button" @click="openOther">Open another project…</button>
          <button type="button" class="button" @click="create">New project…</button>
        </div>
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
        <p v-if="canChoose && locked && (ready || other)" class="hint">
          You can choose another project once the work in this one has finished.
        </p>
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
