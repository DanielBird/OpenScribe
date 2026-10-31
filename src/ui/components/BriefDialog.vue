<script setup lang="ts">
import { computed, ref, useId, useTemplateRef, watch } from 'vue';
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
  message: `${id}-message`,
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
      <div class="field">
        <label :for="ids.name" class="label">Project Name</label>
        <input
          :id="ids.name"
          ref="nameInput"
          v-model="name"
          class="control"
          autocomplete="off"
          required
        />
      </div>

      <div class="field">
        <label :for="ids.context" class="label">Context</label>
        <textarea
          :id="ids.context"
          v-model="context"
          class="control"
          rows="5"
          :aria-describedby="ids.contextHint"
        />
        <p :id="ids.contextHint" class="hint">
          Background information the model should know for analysis and for summarising research
          sessions.
        </p>
      </div>

      <div class="field">
        <label :for="ids.questions" class="label">Key research questions</label>
        <textarea
          :id="ids.questions"
          v-model="questions"
          class="control"
          rows="4"
          :aria-describedby="ids.questionsHint"
        />
        <p :id="ids.questionsHint" class="hint">
          Enter one per line. When summarising, the model will document whether the session provided
          answers to these questions. This is used to support search.
        </p>
      </div>

      <div class="field">
        <label :for="ids.fields" class="label">Respondent details</label>
        <textarea
          :id="ids.fields"
          v-model="fields"
          class="control"
          rows="3"
          :aria-describedby="ids.fieldsHint"
        />
        <p :id="ids.fieldsHint" class="hint">
          Enter one per line, for example Age or Country. The model will attempt to extract these
          for each research session. This is saved as metadata to support search.
        </p>
      </div>

      <p v-if="message" :id="ids.message" class="message" role="alert">{{ message }}</p>

      <div class="actions">
        <button v-if="conflict" type="button" class="button" @click="reload">Reload</button>
        <span class="spacer" />
        <button type="button" class="button" @click="emit('close')">Cancel</button>
        <button type="submit" class="button button-primary" :disabled="!canSave">Save</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.brief-dialog {
  width: min(50.4rem, calc(100vw - 2 * var(--space-4)));
  max-height: calc(100vh - 2 * var(--space-4));
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
}

.brief-dialog::backdrop {
  background: var(--color-backdrop);
}

.form {
  display: grid;
  gap: var(--space-4);
}

.field {
  display: grid;
  gap: var(--space-1);
}

/* A hint shows only while its field has focus. It keeps its space, so nothing moves when focus leaves a field
   (a collapsing hint made Save jump away from a click), and screen readers still read it (aria-describedby). */
.hint {
  transition: opacity 0.15s ease-out;
}

.field:not(:focus-within) .hint {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .hint {
    transition: none;
  }
}

.label {
  font-weight: 600;
}

.control {
  width: 100%;
}

textarea.control {
  resize: vertical;
}

.message {
  color: var(--color-danger);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.spacer {
  flex: 1;
}
</style>
