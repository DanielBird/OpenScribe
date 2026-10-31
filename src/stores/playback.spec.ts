import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { makeDoc, TEST_SOURCE, withTranslation } from '../testing/transcriptDoc';
import { FRAME_INTERVAL_MS, PLAYBACK_MESSAGES, usePlaybackStore } from './playback';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';

vi.mock('../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
  clearLastTranscript: vi.fn(() => Promise.resolve()),
}));

/** Just enough of an <audio> element: events, time, play/pause. */
class FakeAudio extends EventTarget {
  currentTime = 0;
  paused = true;
  error: { code: number } | null = null;

  play = vi.fn(() => {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });

  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });

  fire(type: string): void {
    this.dispatchEvent(new Event(type));
  }
}

/** Node's `process`, which the app's types don't include. */
interface NodeLikeProcess {
  on(event: 'unhandledRejection', listener: () => void): void;
  off(event: 'unhandledRejection', listener: () => void): void;
}

const asAudio = (el: FakeAudio) => el as unknown as HTMLAudioElement;

/** A file with the given name and size (the content doesn't matter). */
const fileOf = (name: string, size: number) => new File([new Uint8Array(size)], name);
const SOURCE_FILE = () => fileOf(TEST_SOURCE.fileName, TEST_SOURCE.fileSize);

describe('playback store', () => {
  let urls: number;
  let createUrl: MockInstance<typeof URL.createObjectURL>;
  let revokeUrl: MockInstance<typeof URL.revokeObjectURL>;

  beforeEach(async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    urls = 0;
    createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++urls}`);
    revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await useTranscriptStore().setDoc(makeDoc());
  });

  afterEach(() => {
    usePlaybackStore().$dispose();
    useTranscriptStore().$dispose();
    vi.restoreAllMocks();
  });

  /** The store with the run's file attached and a fake element registered. */
  function withAudio() {
    const playback = usePlaybackStore();
    playback.attachFromRunFile(SOURCE_FILE());
    const el = new FakeAudio();
    playback.registerAudioElement(asAudio(el));
    return { playback, el };
  }

  describe('attaching', () => {
    it('starts with no audio', () => {
      const playback = usePlaybackStore();
      expect(playback.audioUrl).toBeNull();
      expect(playback.sourceMatch).toBeNull();
      expect(playback.playable).toBe(false);
      expect(playback.activeTurnId).toBeNull();
    });

    it("attaches the run's file", () => {
      const playback = usePlaybackStore();
      const file = SOURCE_FILE();
      playback.attachFromRunFile(file);
      expect(createUrl).toHaveBeenCalledExactlyOnceWith(file);
      expect(playback.audioUrl).toBe('blob:1');
      expect(playback.sourceMatch).toBe('same-run');
      expect(playback.playable).toBe(true);
    });

    it('attaches a file with the same name and size without asking', async () => {
      const playback = usePlaybackStore();
      const confirm = vi.fn(() => Promise.resolve(true));
      await expect(playback.attachManual(SOURCE_FILE(), confirm)).resolves.toBe(true);
      expect(confirm).not.toHaveBeenCalled();
      expect(playback.sourceMatch).toBe('matched');
      expect(playback.audioUrl).toBe('blob:1');
    });

    it.each([
      ['name', fileOf('other.mp3', TEST_SOURCE.fileSize)],
      ['size', fileOf(TEST_SOURCE.fileName, 10)],
    ])('asks before attaching a file whose %s differs', async (_, file) => {
      const playback = usePlaybackStore();
      const confirm = vi.fn(() => Promise.resolve(true));
      await expect(playback.attachManual(file, confirm)).resolves.toBe(true);
      expect(confirm).toHaveBeenCalledOnce();
      expect(playback.sourceMatch).toBe('mismatch');
      expect(playback.audioUrl).toBe('blob:1');
    });

    it('leaves everything as it was when the user declines', async () => {
      const { playback } = withAudio();
      const ok = await playback.attachManual(fileOf('other.mp3', 10), () => Promise.resolve(false));
      expect(ok).toBe(false);
      expect(createUrl).toHaveBeenCalledOnce(); // only the run's file
      expect(playback.audioUrl).toBe('blob:1');
      expect(playback.sourceMatch).toBe('same-run');
    });

    it('attaches nothing without a transcript', async () => {
      setActivePinia(createPinia());
      const playback = usePlaybackStore();
      await expect(playback.attachManual(SOURCE_FILE(), () => Promise.resolve(true))).resolves.toBe(
        false,
      );
      expect(createUrl).not.toHaveBeenCalled();
    });

    it('attaches nothing when the transcript is replaced while the user decides', async () => {
      const playback = usePlaybackStore();
      let answer!: (ok: boolean) => void;
      const attaching = playback.attachManual(
        fileOf('other.mp3', 10),
        () => new Promise((resolve) => (answer = resolve)),
      );
      await useTranscriptStore().setDoc(makeDoc({ id: 'another-doc' }));
      answer(true);
      await expect(attaching).resolves.toBe(false);
      expect(playback.audioUrl).toBeNull();
    });
  });

  describe('object URLs', () => {
    it('revokes the previous URL when the file is replaced', async () => {
      const playback = usePlaybackStore();
      playback.attachFromRunFile(SOURCE_FILE());
      playback.attachFromRunFile(SOURCE_FILE());
      expect(playback.audioUrl).toBe('blob:2');
      // Not before the <audio> element has been given the new URL.
      expect(revokeUrl).not.toHaveBeenCalled();
      await nextTick();
      expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:1');
    });

    it('drops and revokes the audio when another transcript replaces this one', async () => {
      const { playback } = withAudio();
      await useTranscriptStore().setDoc(makeDoc({ id: 'another-doc' }));
      expect(playback.audioUrl).toBeNull();
      expect(playback.sourceMatch).toBeNull();
      await nextTick();
      expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:1');
    });

    it('keeps the audio when the transcript is translated or a speaker renamed', async () => {
      const { playback } = withAudio();
      const transcript = useTranscriptStore();
      await transcript.setTranslation(
        transcript.doc!.id,
        withTranslation(transcript.doc!).translations.en!,
      );
      transcript.renameSpeaker('speaker_0', 'Interviewer');
      await nextTick();
      expect(playback.audioUrl).toBe('blob:1');
      expect(revokeUrl).not.toHaveBeenCalled();
    });

    it("keeps a new run's file: the new doc arrives first, then its file", async () => {
      const { playback } = withAudio();
      await useTranscriptStore().setDoc(makeDoc({ id: 'run-2' }));
      playback.attachFromRunFile(SOURCE_FILE());
      await nextTick();
      expect(playback.audioUrl).toBe('blob:2');
      expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:1');
    });

    it('revokes the URL when the store is disposed', () => {
      const { playback } = withAudio();
      playback.$dispose();
      expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:1');
    });
  });

  describe('playing', () => {
    it('seeks and plays', () => {
      const { playback, el } = withAudio();
      playback.seekTo(6.5);
      expect(el.currentTime).toBe(6.5);
      expect(playback.currentTime).toBe(6.5);
      expect(el.play).toHaveBeenCalledOnce();
      expect(playback.playing).toBe(true);
    });

    it('seeks without playing when autoplay is off', () => {
      const { playback, el } = withAudio();
      playback.seekTo(3, false);
      expect(el.currentTime).toBe(3);
      expect(el.play).not.toHaveBeenCalled();
    });

    it('does nothing without an element', () => {
      const playback = usePlaybackStore();
      playback.attachFromRunFile(SOURCE_FILE());
      expect(() => playback.seekTo(3)).not.toThrow();
      expect(() => playback.togglePlay()).not.toThrow();
    });

    it.each([
      ['seekTo', (p: ReturnType<typeof usePlaybackStore>) => p.seekTo(3)],
      ['togglePlay', (p: ReturnType<typeof usePlaybackStore>) => p.togglePlay()],
    ])('%s swallows a rejected play() (autoplay blocked)', async (_, start) => {
      // In the browser an unhandled rejection is a console error, which fails the e2e tests. Under
      // happy-dom Vitest doesn't report it, so watch for it here.
      const node = (globalThis as unknown as { process: NodeLikeProcess }).process;
      const unhandled = vi.fn();
      node.on('unhandledRejection', unhandled);
      try {
        const { playback, el } = withAudio();
        // A plain function: a vi.fn would handle the rejection itself (it records settled results).
        let calls = 0;
        el.play = (() => {
          calls++;
          return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
        }) as unknown as typeof el.play;
        start(playback);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(calls).toBe(1);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        node.off('unhandledRejection', unhandled);
      }
    });

    it('toggles play and pause', () => {
      const { playback, el } = withAudio();
      playback.togglePlay();
      expect(el.play).toHaveBeenCalledOnce();
      expect(playback.playing).toBe(true);
      playback.togglePlay();
      expect(el.pause).toHaveBeenCalledOnce();
      expect(playback.playing).toBe(false);
    });

    it('reports a format the browser cannot play', () => {
      const { playback, el } = withAudio();
      el.error = { code: 4 }; // MEDIA_ERR_SRC_NOT_SUPPORTED
      el.fire('error');
      expect(playback.playbackError).toBe(PLAYBACK_MESSAGES.unplayable);
      expect(playback.playable).toBe(false);
      playback.seekTo(3);
      expect(el.play).not.toHaveBeenCalled();
    });

    it('reports a format play() rejects without an error event', async () => {
      const { playback, el } = withAudio();
      el.play = (() =>
        Promise.reject(
          new DOMException('no supported source', 'NotSupportedError'),
        )) as unknown as typeof el.play;
      playback.seekTo(3);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(playback.playbackError).toBe(PLAYBACK_MESSAGES.unplayable);
    });

    it('does not report blocked autoplay as a format problem', async () => {
      const { playback, el } = withAudio();
      el.play = (() =>
        Promise.reject(
          new DOMException('blocked', 'NotAllowedError'),
        )) as unknown as typeof el.play;
      playback.togglePlay();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(playback.playbackError).toBeNull();
    });

    it('ignores an aborted load', () => {
      const { playback, el } = withAudio();
      el.error = { code: 1 }; // MEDIA_ERR_ABORTED
      el.fire('error');
      expect(playback.playbackError).toBeNull();
    });

    it('clears the error when another file is attached', async () => {
      const { playback, el } = withAudio();
      el.error = { code: 4 };
      el.fire('error');
      await playback.attachManual(SOURCE_FILE(), () => Promise.resolve(true));
      expect(playback.playbackError).toBeNull();
      expect(playback.playable).toBe(true);
    });

    it('continues where it was left when the element registers again', () => {
      const { playback } = withAudio();
      playback.seekTo(7, false);
      playback.registerAudioElement(null);
      const again = new FakeAudio();
      playback.registerAudioElement(asAudio(again));
      expect(again.currentTime).toBe(7);
    });

    it('stops listening to an unregistered element', () => {
      const { playback, el } = withAudio();
      playback.registerAudioElement(null);
      el.currentTime = 9;
      el.fire('timeupdate');
      expect(playback.currentTime).toBe(0);
    });
  });

  describe('the active turn', () => {
    it('is none until the recording is played or sought', () => {
      const { playback, el } = withAudio();
      el.currentTime = 5;
      el.fire('timeupdate');
      expect(playback.activeTurnId).toBeNull();
      el.fire('play');
      expect(playback.activeTurnId).not.toBeNull();
    });

    it('follows the time', () => {
      const { playback, el } = withAudio();
      const turns = useTranscriptStore().doc!.turns;
      playback.seekTo(turns[2]!.start);
      expect(playback.activeTurnId).toBe(turns[2]!.id);
      el.currentTime = turns[3]!.start + 0.1;
      el.fire('timeupdate');
      expect(playback.activeTurnId).toBe(turns[3]!.id);
      el.currentTime = 0;
      el.fire('seeked');
      expect(playback.activeTurnId).toBeNull(); // before the first turn
    });

    it('updates at most every 100 ms while playing', () => {
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
      const { playback, el } = withAudio();
      el.fire('play');
      const runFrame = (now: number, time: number) => {
        el.currentTime = time;
        frames.shift()!(now);
      };

      runFrame(1000, 1);
      expect(playback.currentTime).toBe(1);
      runFrame(1000 + FRAME_INTERVAL_MS / 2, 1.05);
      expect(playback.currentTime).toBe(1);
      runFrame(1000 + FRAME_INTERVAL_MS, 1.1);
      expect(playback.currentTime).toBe(1.1);

      el.fire('pause');
      expect(frames).toHaveLength(1); // the loop's next frame, cancelled
      expect(window.cancelAnimationFrame).toHaveBeenCalled();
    });
  });

  describe('following', () => {
    it('mirrors the saved preference', () => {
      const playback = usePlaybackStore();
      expect(playback.followPlayback).toBe(true);
      playback.followPlayback = false;
      expect(useSettingsStore().followPlayback).toBe(false);
    });

    it('pauses when the user scrolls while playing, and resumes on the next turn click', () => {
      const { playback } = withAudio();
      playback.seekTo(3);
      window.dispatchEvent(new Event('wheel'));
      expect(playback.followPaused).toBe(true);
      playback.seekTo(6);
      expect(playback.followPaused).toBe(false);
      window.dispatchEvent(new Event('touchmove'));
      expect(playback.followPaused).toBe(true);
    });

    it('resumes when playback starts again', () => {
      const { playback, el } = withAudio();
      playback.togglePlay();
      window.dispatchEvent(new Event('wheel'));
      el.pause();
      el.play();
      expect(playback.followPaused).toBe(false);
    });

    it('does not pause when the user scrolls while nothing plays', () => {
      const { playback } = withAudio();
      window.dispatchEvent(new Event('wheel'));
      expect(playback.followPaused).toBe(false);
    });
  });
});
