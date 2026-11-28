import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, toRaw, watch } from 'vue';
import type { TranscriptDoc, TranscriptVersion } from '../domain/transcript';
import { buildDocModel } from '../features/export/docxModel';
import { renderDocx } from '../features/export/docxRender';
import { downloadBlob } from '../features/export/download';
import { exportFileName } from '../features/export/fileName';
import { FolderError, pickSaveFile, writeFile } from '../storage/folder';
import { useTranscriptStore } from './transcript';

export const EXPORT_ERROR = "Couldn't create the Word file. Try again.";
export const SAVE_ERROR =
  "Couldn't save the Word file. If it's open in Word, close it, then try again.";

/** How long the button shows that the file was saved (the desktop app). */
export const SAVED_MS = 3000;

// Builds the .docx for the current transcript. The web build hands it to the browser's download; the desktop app
// asks where to save it, in Windows' Save dialog, since its web view saves to Downloads without a sign (D61).
export const useExportStore = defineStore('export', () => {
  const transcript = useTranscriptStore();

  /** True while the file is being built or saved (big transcripts take about a second to build). */
  const busy = ref(false);
  const error = ref<string | null>(null);
  /** The name of the file just saved, for a few seconds (the desktop app). */
  const saved = ref<string | null>(null);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;

  const hasTranslation = computed(() => transcript.doc?.translations.en !== undefined);

  function setSaved(name: string | null): void {
    if (savedTimer !== null) clearTimeout(savedTimer);
    savedTimer = name === null ? null : setTimeout(() => setSaved(null), SAVED_MS);
    saved.value = name;
  }
  onScopeDispose(() => setSaved(null));

  // An error, or a save, belongs to the transcript it happened with.
  watch(
    () => transcript.doc?.id,
    () => {
      error.value = null;
      setSaved(null);
    },
  );

  /** Builds the file, or shows why it couldn't. */
  async function build(doc: TranscriptDoc, version: TranscriptVersion): Promise<Blob | null> {
    try {
      const model = buildDocModel(doc, {
        version,
        generatedAt: new Date(),
        appVersion: __APP_VERSION__,
      });
      return await renderDocx(model);
    } catch (e) {
      console.error('Word export failed', e);
      error.value = EXPORT_ERROR;
      return null;
    }
  }

  /** The desktop app's Save as. A dismissed dialog saves nothing and says nothing. */
  async function saveAs(blob: Blob, fileName: string): Promise<void> {
    try {
      const handle = await pickSaveFile(fileName);
      await writeFile(handle, blob);
      setSaved(handle.name);
    } catch (e) {
      if (e instanceof FolderError && e.kind === 'cancelled') return;
      console.error('Saving the Word file failed', e);
      error.value = SAVE_ERROR;
    }
  }

  async function download(version: TranscriptVersion): Promise<void> {
    const doc = transcript.doc;
    if (!doc || busy.value) return;
    busy.value = true;
    error.value = null;
    setSaved(null);
    try {
      const raw = toRaw(doc);
      // Built before the Save dialog opens: the dialog must follow the click within seconds, and a file that
      // can't be built never leaves an empty one behind.
      const blob = await build(raw, version);
      if (!blob) return;
      const fileName = exportFileName(raw, version);
      if (__DESKTOP__) await saveAs(blob, fileName);
      else downloadBlob(blob, fileName);
    } catch (e) {
      console.error('Word export failed', e);
      error.value = EXPORT_ERROR;
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, saved, hasTranslation, download };
});
