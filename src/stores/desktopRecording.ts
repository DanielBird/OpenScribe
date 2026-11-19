import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  chooseRecording,
  onDragOverWindow,
  onDroppedRecording,
  RecordingError,
} from '../desktop/recordings';
import { ProviderError } from '../providers/errors';

// The desktop app's way of choosing a recording (DECISIONS.md D53): Windows' Open dialog, and files dropped on the
// window, both handed to the page as real Files by Rust so a local transcription can name them. FileDrop uses this
// only when `__DESKTOP__` is true; the web build keeps the browser's own picker and drop.

/** A recording the user chose or dropped, or why it couldn't be opened (D41: the detail for Technical details). */
export type ChosenRecording = { file: File } | { error: ProviderError };
/** A recording dropped on the window, with where it was dropped in CSS pixels from the top left of the page. */
export type DroppedOnWindow = ChosenRecording & { x: number; y: number };

const CANT_OPEN =
  "DeScribe couldn't open this file. Try again, or restart DeScribe if it keeps happening.";

function cantOpen(cause: unknown): ProviderError {
  const detail = cause instanceof RecordingError ? cause.detail : String(cause);
  return new ProviderError('unknown', CANT_OPEN, { detail: `recording: ${detail}` });
}

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

  /** Shows Windows' Open dialog. The chosen file, why it couldn't be opened, or null if the user cancelled. */
  async function choose(): Promise<ChosenRecording | null> {
    if (!__DESKTOP__) return null;
    listen();
    try {
      const file = await chooseRecording();
      return file && { file };
    } catch (cause) {
      return { error: cantOpen(cause) };
    }
  }

  /** Calls `listener` for each file dropped on the window. Returns a function that stops it. */
  function onDrop(listener: (drop: DroppedOnWindow) => void): () => void {
    if (!__DESKTOP__) return () => {};
    listen();
    return onDroppedRecording((drop) =>
      listener('file' in drop ? drop : { error: cantOpen(drop.error), x: drop.x, y: drop.y }),
    );
  }

  return { dragging, choose, onDrop };
});
