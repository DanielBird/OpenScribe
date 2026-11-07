<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue';
import type { FileStat } from '../../storage/folder';
import { useProjectStore } from '../../stores/project';
import { useModalDialog } from '../composables/useModalDialog';

// The project brief (PROJECTS.md §5.6): the name, the research questions, the context and the respondent details
// that guide every summary. Saving checks that nobody changed the brief since the dialog opened; if someone did,
// it says so and offers Reload instead of overwriting their version.
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const project = useProjectStore();
const id = useId();
const ids = {
  name: `${id}-name`,
  questions: `${id}-questions`,
  questionsHint: `${id}-questions-hint`,
  context: `${id}-context`,
  contextHint: `${id}-context-hint`,
  fields: `${id}-fields`,
  fieldsHint: `${id}-fields-hint`,
};
const dialogEl = useTemplateRef<HTMLDialogElement>('dialog');
const nameInput = useTemplateRef<HTMLInputElement>('nameInput');

const name = ref('');
const questions = ref('');
const context = ref('');
const fields = ref('');
/** The project file's stat when editing started: what Save checks against. */
let base: FileStat | null = null;
const message = ref('');
const conflict = ref(false);
const saving = ref(false);

type TabId = 'context' | 'questions' | 'fields';
const active = ref<TabId>('context');
const tabs: { id: TabId; label: string }[] = [
  { id: 'context', label: 'Context' },
  { id: 'questions', label: 'Research questions' },
  { id: 'fields', label: 'Respondent details' },
];
const tabId = (tab: TabId) => `${id}-tab-${tab}`;
const panelId = (tab: TabId) => `${id}-panel-${tab}`;

/** A click or Enter on a tab goes straight to its editor; the arrow keys stay on the tabs. */
async function openTab(tab: TabId): Promise<void> {
  active.value = tab;
  await nextTick();
  document.getElementById(ids[tab])?.focus();
}

async function onTabKeydown(event: KeyboardEvent, index: number): Promise<void> {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const next = tabs[(index + step + tabs.length) % tabs.length]!;
  active.value = next.id;
  await nextTick();
  document.getElementById(tabId(next.id))?.focus();
}

const canSave = computed(() => name.value.trim() !== '' && !saving.value && !conflict.value);

function fill(): void {
  const current = project.project;
  name.value = current?.name ?? '';
  questions.value = current?.brief.researchQuestions.join('\n') ?? '';
  context.value = current?.brief.context ?? '';
  fields.value = current?.brief.metadataFields.join('\n') ?? '';
  base = project.projectStat;
  message.value = '';
  conflict.value = false;
  active.value = 'context';
}

// Filled before the dialog shows (useModalDialog opens it after this, with flush: 'post').
watch(
  () => props.open,
  (open) => {
    if (open) fill();
  },
  { immediate: true },
);

const { onCancelEvent, onClose } = useModalDialog(dialogEl, () => props.open, {
  focusOnOpen: () => nameInput.value,
  onCancel: () => emit('close'),
});

const lines = (text: string) => text.split(/\r?\n/);

async function save(): Promise<void> {
  if (!canSave.value || !base) return;
  saving.value = true;
  const result = await project.saveBrief(
    name.value,
    {
      researchQuestions: lines(questions.value),
      context: context.value,
      metadataFields: lines(fields.value),
    },
    base,
  );
  saving.value = false;
  if (result.ok) {
    emit('close');
    return;
  }
  message.value = result.message;
  conflict.value = result.reason === 'changed';
}

/** Shows the colleague's version. What was typed here is replaced. */
async function reload(): Promise<void> {
  if ((await project.reloadProject()) === null) {
    message.value = "DeScribe couldn't read the brief. Try again.";
    return;
  }
  fill();
  nameInput.value?.focus();
}
</script>

<template>
  <dialog
    ref="dialog"
    class="brief-dialog"
    aria-label="Brief"
    @cancel="onCancelEvent"
    @close="onClose"
  >
    <form class="form" @submit.prevent="save">
      <div class="name-row">
        <label :for="ids.name">Project Name</label>
        <input
          :id="ids.name"
          ref="nameInput"
          v-model="name"
          class="control"
          :class="{ named: name.trim() !== '' }"
          autocomplete="off"
          required
        />
      </div>

      <div class="tabs" role="tablist" aria-label="Brief sections">
        <button
          v-for="(tab, index) in tabs"
          :id="tabId(tab.id)"
          :key="tab.id"
          type="button"
          class="tab"
          role="tab"
          :aria-selected="active === tab.id"
          :aria-controls="panelId(tab.id)"
          :tabindex="active === tab.id ? 0 : -1"
          @click="openTab(tab.id)"
          @keydown="onTabKeydown($event, index)"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- All three stay mounted and the editor's height is fixed, so changing tab moves nothing. -->
      <div
        v-show="active === 'context'"
        :id="panelId('context')"
        class="panel"
        role="tabpanel"
        :aria-labelledby="tabId('context')"
      >
        <label :for="ids.context" class="visually-hidden">Context</label>
        <textarea
          :id="ids.context"
          v-model="context"
          class="control editor"
          :aria-describedby="ids.contextHint"
        />
        <p :id="ids.contextHint" class="hint">
          What the model should know when analysing and summarising sessions.
        </p>
      </div>

      <div
        v-show="active === 'questions'"
        :id="panelId('questions')"
        class="panel"
        role="tabpanel"
        :aria-labelledby="tabId('questions')"
      >
        <label :for="ids.questions" class="visually-hidden">Key research questions</label>
        <textarea
          :id="ids.questions"
          v-model="questions"
          class="control editor"
          :aria-describedby="ids.questionsHint"
        />
        <p :id="ids.questionsHint" class="hint">
          One per line. Summaries record whether each was answered, and search uses that.
        </p>
      </div>

      <div
        v-show="active === 'fields'"
        :id="panelId('fields')"
        class="panel"
        role="tabpanel"
        :aria-labelledby="tabId('fields')"
      >
        <label :for="ids.fields" class="visually-hidden">Respondent details</label>
        <textarea
          :id="ids.fields"
          v-model="fields"
          class="control editor"
          :aria-describedby="ids.fieldsHint"
        />
        <p :id="ids.fieldsHint" class="hint">
          One per line, such as Age or Country. Extracted from each session for search.
        </p>
      </div>

      <div class="actions">
        <p v-if="message" class="message" role="alert">{{ message }}</p>
        <button v-if="conflict" type="button" class="button" @click="reload">Reload</button>
        <button type="button" class="button quiet" @click="emit('close')">Cancel</button>
        <button type="submit" class="button button-primary" :disabled="!canSave">Save</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.brief-dialog {
  --ease: cubic-bezier(0.22, 1, 0.36, 1);

  width: min(44rem, calc(100vw - 2 * var(--space-4)));
  max-height: calc(100dvh - 2 * var(--space-4));
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  transition:
    opacity 160ms var(--ease),
    translate 240ms var(--ease);
}

.brief-dialog[open] {
  display: flex;
}

.brief-dialog::backdrop {
  background: var(--color-backdrop);
  transition: background-color 160ms var(--ease);
}

@starting-style {
  .brief-dialog[open] {
    opacity: 0;
    translate: 0 0.5rem;
  }

  .brief-dialog[open]::backdrop {
    background: transparent;
  }
}

.form {
  flex: 1;
  min-width: 0;
  padding: var(--space-5);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

.name-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  align-items: center;
  margin-bottom: var(--space-4);
}

.name-row .control {
  font-weight: 600;
}

.control {
  display: block;
  width: 100%;
  caret-color: var(--color-accent);
}

/* The name's outline shows only while it's edited or empty. The border stays, transparent, so the text doesn't move. */
.control.named:not(:focus) {
  border-color: transparent;
}

/* The same segmented control as the Analyse sidebar. */
.tabs {
  display: grid;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  gap: 2px;
  margin-bottom: var(--space-3);
  padding: 3px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-text) 7%, var(--color-surface));
}

.tab {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--space-1);
  padding: 0.3125rem var(--space-2);
  border: 0;
  border-radius: calc(var(--radius-md) - 3px);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 160ms var(--ease),
    color 160ms var(--ease),
    box-shadow 160ms var(--ease);
}

.tab:hover {
  color: var(--color-text);
}

.tab[aria-selected='true'] {
  background: var(--color-bg);
  color: var(--color-accent);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--color-text) 14%, transparent);
}

.tab:focus-visible {
  outline-offset: 1px;
}

.editor {
  height: 14rem;
  resize: none;
}

.hint {
  min-height: 1lh;
  margin-top: var(--space-2);
}

.message {
  flex: 1 1 14rem;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.quiet {
  border-color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  .brief-dialog,
  .brief-dialog::backdrop,
  .tab {
    transition: none;
  }
}

@media (max-width: 40rem) {
  .form {
    padding: var(--space-4);
  }

  .name-row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-1);
  }

  .tab {
    height: 100%;
    align-items: center;
    text-align: center;
  }

  .hint {
    min-height: 3lh;
  }
}
</style>
