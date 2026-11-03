<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TranscriptVersion } from '../../domain/transcript';
import ConfirmDialog from './ConfirmDialog.vue';

// Asks which version to download when an English translation exists (DECISIONS.md D7).
const props = defineProps<{
  open: boolean;
  /** The original's language name, e.g. 'German', or '' when it is not known. */
  language: string;
  /** Selected when the dialog opens: the version the view shows. */
  initial: TranscriptVersion;
  /** Turns whose English is out of date: changed since they were translated (DECISIONS.md D39). */
  stale?: number;
}>();
const emit = defineEmits<{ download: [version: TranscriptVersion]; cancel: [] }>();

const choice = ref<TranscriptVersion>(props.initial);
const originalLabel = computed(() =>
  props.language ? `Original (${props.language})` : 'Original',
);
const englishLabel = computed(() => {
  const n = props.stale ?? 0;
  return n > 0
    ? `English translation (${n === 1 ? '1 turn' : `${n} turns`} out of date)`
    : 'English translation';
});
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
        {{ originalLabel }}
      </label>
      <label class="choice">
        <input v-model="choice" type="radio" name="export-version" value="en" />
        {{ englishLabel }}
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
