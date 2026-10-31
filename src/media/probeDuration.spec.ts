import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeDuration } from './probeDuration';

/** Captures the off-DOM audio element the probe creates, so a test can fire its media events. */
function captureAudio() {
  const created: HTMLAudioElement[] = [];
  const RealAudio = window.Audio;
  vi.spyOn(window, 'Audio').mockImplementation(function () {
    const el = new RealAudio();
    created.push(el);
    return el;
  });
  return {
    get el(): HTMLAudioElement {
      const el = created[0];
      if (!el) throw new Error('no audio element was created');
      return el;
    },
    count: () => created.length,
  };
}

function setDuration(el: HTMLAudioElement, value: number): void {
  Object.defineProperty(el, 'duration', { configurable: true, get: () => value });
}

describe('probeDuration', () => {
  const file = new File(['RIFF'], 'clip.wav', { type: 'audio/wav' });
  let revoke: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:probe-1');
    revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves the duration from the metadata and revokes the URL', async () => {
    const audio = captureAudio();
    const promise = probeDuration(file);
    expect(audio.el.preload).toBe('metadata');
    expect(audio.el.src).toBe('blob:probe-1');
    expect(audio.el.isConnected).toBe(false);

    setDuration(audio.el, 5);
    audio.el.dispatchEvent(new Event('loadedmetadata'));

    await expect(promise).resolves.toBe(5);
    expect(revoke).toHaveBeenCalledWith('blob:probe-1');
  });

  it.each([Infinity, NaN])('resolves null for a duration of %s', async (value) => {
    const audio = captureAudio();
    const promise = probeDuration(file);
    setDuration(audio.el, value);
    audio.el.dispatchEvent(new Event('loadedmetadata'));
    await expect(promise).resolves.toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:probe-1');
  });

  it('resolves null on a media error', async () => {
    const audio = captureAudio();
    const promise = probeDuration(file);
    audio.el.dispatchEvent(new Event('error'));
    await expect(promise).resolves.toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:probe-1');
  });

  it('resolves null after the timeout', async () => {
    vi.useFakeTimers();
    captureAudio();
    const promise = probeDuration(file, 1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:probe-1');
  });

  it('resolves null when the signal aborts, and ignores later events', async () => {
    const audio = captureAudio();
    const controller = new AbortController();
    const promise = probeDuration(file, 10_000, controller.signal);
    controller.abort();
    await expect(promise).resolves.toBeNull();
    expect(revoke).toHaveBeenCalledTimes(1);

    setDuration(audio.el, 5);
    audio.el.dispatchEvent(new Event('loadedmetadata'));
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('does not load an empty file', async () => {
    const audio = captureAudio();
    await expect(probeDuration(new File([], 'empty.wav'))).resolves.toBeNull();
    expect(audio.count()).toBe(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('does nothing for a signal that has already aborted', async () => {
    const audio = captureAudio();
    const controller = new AbortController();
    controller.abort();
    await expect(probeDuration(file, 10_000, controller.signal)).resolves.toBeNull();
    expect(audio.count()).toBe(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
