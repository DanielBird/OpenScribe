<script setup lang="ts">
import { computed, ref } from 'vue';
import { languageName, type TranscriptVersion } from '../../domain/transcript';
import { useExportStore } from '../../stores/export';
import { useTranscriptStore } from '../../stores/transcript';
import ExportDialog from './ExportDialog.vue';

// "Download .docx", the Output tab's main action. With an English translation, a dialog asks which
// version first.
const exporter = useExportStore();
const transcript = useTranscriptStore();

const choosing = ref(false);
const language = computed(() =>
  transcript.doc ? languageName(transcript.doc.result.languageCode) : '',
);

function onClick(): void {
  // aria-disabled rather than disabled while busy, so the button keeps keyboard focus.
  if (exporter.busy) return;
  if (exporter.hasTranslation) choosing.value = true;
  else void exporter.download('original');
}

function onChoose(version: TranscriptVersion): void {
  choosing.value = false;
  void exporter.download(version);
}
</script>

<template>
  <div class="export">
    <button
      type="button"
      class="button"
      :aria-disabled="exporter.busy || undefined"
      :class="{ busy: exporter.busy }"
      @click="onClick"
    >
      <span v-if="exporter.busy" class="spinner" aria-hidden="true" />
      Download .docx
    </button>
    <p v-if="exporter.error" class="error" role="alert">{{ exporter.error }}</p>
    <ExportDialog
      :open="choosing"
      :language="language"
      :initial="transcript.view"
      @download="onChoose"
      @cancel="choosing = false"
    />
  </div>
</template>

<style scoped>
.export {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.busy {
  cursor: progress;
}

/* Drawn in the button's text colour. */
.spinner {
  width: 1em;
  height: 1em;
  border-width: 2px;
  border-color: color-mix(in srgb, currentColor 35%, transparent);
  border-top-color: currentColor;
}

.error {
  color: var(--color-danger);
}
</style>
