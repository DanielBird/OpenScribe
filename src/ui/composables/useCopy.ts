import { onBeforeUnmount, ref } from 'vue';
import { writeClipboard } from '../clipboard';

/** How long **Copy** reads "Copied". */
export const COPIED_MS = 1500;

export const COPY_MESSAGES = {
  copied: 'Copied with its citation.',
  fallback: "Couldn't copy automatically. The text is selected: press Ctrl+C to copy it.",
} as const;

/**
 * **Copy** with its feedback: "Copied" for a moment, a status line for screen readers, and, when the clipboard
 * refuses, the text to show selected for Ctrl+C (`fallback`; the component shows and selects it).
 */
export function useCopy() {
  const copied = ref(false);
  const fallback = ref<string | null>(null);
  const status = ref('');
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Resolves whether the clipboard took it. */
  async function copy(text: string): Promise<boolean> {
    status.value = '';
    if (await writeClipboard(text)) {
      fallback.value = null;
      copied.value = true;
      status.value = COPY_MESSAGES.copied;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => (copied.value = false), COPIED_MS);
      return true;
    }
    fallback.value = text;
    status.value = COPY_MESSAGES.fallback;
    return false;
  }

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
  });

  return { copied, fallback, status, copy };
}
