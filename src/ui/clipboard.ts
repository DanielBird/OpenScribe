// Writing text to the clipboard, for Copy buttons. On file:// Chromium allows it from a click (reference doc F13);
// when it fails, the caller shows the text selected for Ctrl+C instead.

/** Resolves whether the text was copied. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    // Missing when the page isn't a secure context (Chromium treats file:// as secure).
    if (!('clipboard' in navigator)) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
