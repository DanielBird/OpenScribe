/**
 * Reads a media file's duration in seconds with an off-DOM `<audio preload="metadata">`. Only the
 * metadata is decoded; the file is never read into memory. Resolves `null` on a media error, after
 * `timeoutMs`, when `signal` aborts, or when the browser reports a non-finite duration (e.g. some
 * WebM recordings). The object URL is always revoked.
 */
export function probeDuration(
  file: File,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<number | null> {
  // An empty file has no duration, and loading it logs ERR_REQUEST_RANGE_NOT_SATISFIABLE in Chromium.
  if (signal?.aborted || file.size === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);

    // Listeners and the timer only fire asynchronously, after `timer` is initialised.
    const settle = (duration: number | null) => {
      clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    const onMetadata = () => settle(Number.isFinite(audio.duration) ? audio.duration : null);
    const onError = () => settle(null);
    const onAbort = () => settle(null);

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => settle(null), timeoutMs);

    audio.preload = 'metadata';
    audio.src = url;
  });
}
