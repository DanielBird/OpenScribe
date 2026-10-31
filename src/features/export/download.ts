/** Saves `blob` as `fileName` through the browser's download. Works from file:// in Chromium. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by the next tick; only then is the URL safe to release.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
