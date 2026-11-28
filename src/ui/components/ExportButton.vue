<script setup lang="ts">
import { computed, ref } from 'vue';
import { languageName, type TranscriptVersion } from '../../domain/transcript';
import { useExportStore } from '../../stores/export';
import { useTranscriptStore } from '../../stores/transcript';
import IconDownload from '../icons/IconDownload.vue';
import IconSaved from '../icons/IconSaved.vue';
import ExportDialog from './ExportDialog.vue';

// "Download .docx", the Output tab's main action; "Save as .docx" in the desktop app, which asks where in Windows'
// Save dialog and then shows a tick for a moment (D61). With an English translation, a dialog asks which version first.
const exporter = useExportStore();
const transcript = useTranscriptStore();

const label = __DESKTOP__ ? 'Save as .docx' : 'Download .docx';

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
      class="button button-icon"
      :aria-label="label"
      :aria-disabled="exporter.busy || undefined"
      :class="{ busy: exporter.busy, saved: exporter.saved !== null }"
      @click="onClick"
    >
      <span v-if="exporter.busy" class="spinner" aria-hidden="true" />
      <IconSaved v-else-if="exporter.saved" />
      <IconDownload v-else />
      <span class="icon-tip" aria-hidden="true">{{ label }}</span>
    </button>
    <span class="visually-hidden" role="status">{{
      exporter.saved ? `Saved ${exporter.saved}` : ''
    }}</span>
    <p v-if="exporter.error" class="error" role="alert">{{ exporter.error }}</p>
    <ExportDialog
      :open="choosing"
      :language="language"
      :initial="transcript.view"
      :stale="transcript.staleTurnIds.length"
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

/* Just saved: the tick, in green even while the pointer is still on the button. */
.button.saved,
.button.saved:hover:not(:disabled) {
  border-color: var(--color-success);
  color: var(--color-success);
}

/* Drawn in the button's text colour. */
.spinner {
  border-width: 2px;
  border-color: color-mix(in srgb, currentColor 35%, transparent);
  border-top-color: currentColor;
}

.error {
  color: var(--color-danger);
}
</style>
