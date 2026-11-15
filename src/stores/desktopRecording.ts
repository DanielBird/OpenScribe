import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  chooseRecording,
  onDragOverWindow,
  onDroppedRecording,
  type DroppedRecording,
} from '../desktop/recordings';

// The desktop app's way of choosing a recording (DECISIONS.md D53): Windows' Open dialog, and files dropped on the
// window, both handed to the page as real Files by Rust so a local transcription can name them. FileDrop uses this
// only when `__DESKTOP__` is true; the web build keeps the browser's own picker and drop.
export const useDesktopRecordingStore = defineStore('desktopRecording', () => {
  /** A file is being dragged over the window. */
  const dragging = ref(false);
  let listening = false;

  function listen(): void {
    if (!__DESKTOP__ || listening) return;
    listening = true;
    onDragOverWindow((over) => {
      dragging.value = over;
    });
  }

  /** Shows Windows' Open dialog. The chosen file, or null if the user cancelled or the dialog failed. */
  async function choose(): Promise<File | null> {
    if (!__DESKTOP__) return null;
    listen();
    try {
      return await chooseRecording();
    } catch (error) {
      console.error('DeScribe: the Open dialog failed', error);
      return null;
    }
  }

  /** Calls `listener` for each file dropped on the window. Returns a function that stops it. */
  function onDrop(listener: (drop: DroppedRecording) => void): () => void {
    if (!__DESKTOP__) return () => {};
    listen();
    return onDroppedRecording(listener);
  }

  return { dragging, choose, onDrop };
});
