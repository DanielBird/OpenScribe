<script setup lang="ts">
import { ref, watch } from 'vue';
import type { TranscriptVersion } from '../../domain/transcript';
import ConfirmDialog from './ConfirmDialog.vue';

// Asks which version to download when an English translation exists (DECISIONS.md D7).
const props = defineProps<{
  open: boolean;
  /** The original's language name, e.g. 'German'. */
  language: string;
  /** Selected when the dialog opens: the version the view shows. */
  initial: TranscriptVersion;
}>();
const emit = defineEmits<{ download: [version: TranscriptVersion]; cancel: [] }>();

const choice = ref<TranscriptVersion>(props.initial);
watch(
  () => props.open,
  (open) => {
    if (open) choice.value = props.initial;
  },
);
</script>

<template>
  <ConfirmDialog
    :open="open"
    title="Which version?"
    confirm-label="Download"
    @confirm="emit('download', choice)"
    @cancel="emit('cancel')"
  >
    <fieldset class="choices">
      <legend class="visually-hidden">Version</legend>
      <label class="choice">
        <input v-model="choice" type="radio" name="export-version" value="original" />
        Original ({{ language }})
      </label>
      <label class="choice">
        <input v-model="choice" type="radio" name="export-version" value="en" />
        English translation
      </label>
    </fieldset>
  </ConfirmDialog>
</template>

<style scoped>
.choices {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.choice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.choice input {
  margin: 0;
  accent-color: var(--color-accent);
}
</style>
