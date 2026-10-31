import { defineStore } from 'pinia';
import { computed, ref, toRaw, watch } from 'vue';
import type { TranscriptVersion } from '../domain/transcript';
import { buildDocModel } from '../features/export/docxModel';
import { renderDocx } from '../features/export/docxRender';
import { downloadBlob } from '../features/export/download';
import { exportFileName } from '../features/export/fileName';
import { useTranscriptStore } from './transcript';

export const EXPORT_ERROR = "Couldn't create the Word file. Try again.";

// Builds the .docx for the current transcript and hands it to the browser's download.
export const useExportStore = defineStore('export', () => {
  const transcript = useTranscriptStore();

  /** True while the file is being built (big transcripts take about a second). */
  const busy = ref(false);
  const error = ref<string | null>(null);

  const hasTranslation = computed(() => transcript.doc?.translations.en !== undefined);

  // An error belongs to the transcript it happened with.
  watch(
    () => transcript.doc?.id,
    () => (error.value = null),
  );

  async function download(version: TranscriptVersion): Promise<void> {
    const doc = transcript.doc;
    if (!doc || busy.value) return;
    busy.value = true;
    error.value = null;
    try {
      const raw = toRaw(doc);
      const model = buildDocModel(raw, {
        version,
        generatedAt: new Date(),
        appVersion: __APP_VERSION__,
      });
      const blob = await renderDocx(model);
      downloadBlob(blob, exportFileName(raw, version));
    } catch (e) {
      console.error('Word export failed', e);
      error.value = EXPORT_ERROR;
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, hasTranslation, download };
});
