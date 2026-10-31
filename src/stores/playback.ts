import { defineStore } from 'pinia';
import { computed, nextTick, onScopeDispose, ref, toRef, watch } from 'vue';
import { findActiveTurnIndex } from '../domain/playback';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';

/** Where the attached recording came from: the run itself, or a file attached later (D10). */
export type SourceMatch = 'same-run' | 'matched' | 'mismatch';

export const PLAYBACK_MESSAGES = {
  unplayable: "This file format can't be played in the browser. The transcript is not affected.",
} as const;

/** While playing, the highlight follows the audio at most this often (smoother than `timeupdate`). */
export const FRAME_INTERVAL_MS = 100;

/** `MediaError.MEDIA_ERR_ABORTED`: the load was stopped (for example by a new `src`). */
const MEDIA_ERR_ABORTED = 1;

const MEDIA_EVENTS = ['play', 'pause', 'ended', 'timeupdate', 'seeked', 'error'] as const;

// Plays the recording of the current transcript. The audio is never stored: the run's file is attached
// on success, and after a reload the user attaches it again. The <audio> element lives in AudioBar and
// registers here, so a turn click anywhere can seek it.
export const usePlaybackStore = defineStore('playback', () => {
  const transcript = useTranscriptStore();
  const settings = useSettingsStore();

  const audioUrl = ref<string | null>(null);
  const sourceMatch = ref<SourceMatch | null>(null);
  const currentTime = ref(0);
  const playing = ref(false);
  const playbackError = ref<string | null>(null);
  /** The persisted "Follow playback" choice. */
  const followPlayback = toRef(settings, 'followPlayback');
  /** Set when the user scrolls with the wheel or touch while playing; the next turn click or play clears it. */
  const followPaused = ref(false);
  /** No turn is highlighted until the recording has been played or sought. */
  const started = ref(false);

  /** The id of the doc the audio belongs to. */
  let attachedDocId: string | null = null;
  let audioEl: HTMLAudioElement | null = null;

  const playable = computed(() => audioUrl.value !== null && playbackError.value === null);

  const activeTurnId = computed(() => {
    const turns = transcript.doc?.turns;
    if (!turns || !audioUrl.value || !started.value) return null;
    return turns[findActiveTurnIndex(turns, currentTime.value)]?.id ?? null;
  });

  // --- Object URLs --------------------------------------------------------------------------------

  // The <audio> element still points at the old URL until Vue updates its `src`, so a replaced URL is
  // revoked only after that.
  function revokeLater(url: string): void {
    void nextTick(() => URL.revokeObjectURL(url));
  }

  function resetState(): void {
    sourceMatch.value = null;
    currentTime.value = 0;
    playing.value = false;
    playbackError.value = null;
    followPaused.value = false;
    started.value = false;
    stopFrames();
  }

  function attach(file: File, match: SourceMatch): void {
    const old = audioUrl.value;
    resetState();
    audioUrl.value = URL.createObjectURL(file);
    if (old) revokeLater(old);
    sourceMatch.value = match;
    attachedDocId = transcript.doc?.id ?? null;
  }

  function clear(): void {
    const old = audioUrl.value;
    resetState();
    audioUrl.value = null;
    attachedDocId = null;
    if (old) revokeLater(old);
  }

  /** Attaches the file that was just transcribed (called by the job store on success). */
  function attachFromRunFile(file: File): void {
    attach(file, 'same-run');
  }

  /**
   * Attaches a recording to the current transcript. One whose name or size differs from the transcript's
   * source is attached only if `confirmMismatch` resolves true. Resolves whether it was attached.
   */
  async function attachManual(
    file: File,
    confirmMismatch: () => Promise<boolean>,
  ): Promise<boolean> {
    const doc = transcript.doc;
    if (!doc) return false;
    const same = file.name === doc.source.fileName && file.size === doc.source.fileSize;
    if (!same && !(await confirmMismatch())) return false;
    if (transcript.doc?.id !== doc.id) return false; // replaced while the user decided
    attach(file, same ? 'matched' : 'mismatch');
    return true;
  }

  // Another transcript replaces this one (a new run): its audio no longer applies. A translation or a
  // rename keeps the doc id, and so the audio.
  watch(
    () => transcript.doc?.id ?? null,
    (id) => {
      if (audioUrl.value !== null && id !== attachedDocId) clear();
    },
    { flush: 'sync' },
  );

  // --- The <audio> element ------------------------------------------------------------------------

  let frame: number | null = null;
  let lastFrameAt = 0;

  function syncTime(): void {
    if (audioEl) currentTime.value = audioEl.currentTime;
  }

  function onFrame(now: number): void {
    if (now - lastFrameAt >= FRAME_INTERVAL_MS) {
      lastFrameAt = now;
      syncTime();
    }
    frame = requestAnimationFrame(onFrame);
  }

  function startFrames(): void {
    if (frame === null) frame = requestAnimationFrame(onFrame);
  }

  function stopFrames(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function onMediaEvent(event: Event): void {
    switch (event.type) {
      case 'play':
        playing.value = true;
        started.value = true;
        followPaused.value = false;
        startFrames();
        break;
      case 'pause':
      case 'ended':
        playing.value = false;
        stopFrames();
        syncTime();
        break;
      case 'timeupdate':
      case 'seeked':
        syncTime();
        break;
      case 'error':
        // A load aborted by a new `src` isn't a format problem.
        if (!audioEl?.error || audioEl.error.code === MEDIA_ERR_ABORTED) return;
        showUnplayable();
        break;
    }
  }

  /** AudioBar registers its element on mount and `null` on unmount. */
  function registerAudioElement(el: HTMLAudioElement | null): void {
    if (audioEl) for (const type of MEDIA_EVENTS) audioEl.removeEventListener(type, onMediaEvent);
    stopFrames();
    playing.value = false;
    audioEl = el;
    if (!el) return;
    for (const type of MEDIA_EVENTS) el.addEventListener(type, onMediaEvent);
    // Back on the Output tab: continue where the recording was left.
    if (currentTime.value > 0) el.currentTime = currentTime.value;
  }

  function showUnplayable(): void {
    playbackError.value = PLAYBACK_MESSAGES.unplayable;
    playing.value = false;
    stopFrames();
  }

  // A rejected play() must not become an unhandled rejection. Blocked autoplay needs nothing: the user
  // can press play. A format the browser can't decode usually fires the element's `error` event, but
  // Chrome rejects some (HEVC without a hardware decoder) with NotSupportedError and no event (V6).
  function play(el: HTMLAudioElement): void {
    el.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'NotSupportedError' && el === audioEl) {
        showUnplayable();
      }
    });
  }

  /** Moves to `sec` and, unless `autoplay` is false, plays from there. Resumes following. */
  function seekTo(sec: number, autoplay = true): void {
    const el = audioEl;
    if (!el || !playable.value) return;
    el.currentTime = sec;
    currentTime.value = sec;
    started.value = true;
    followPaused.value = false;
    if (autoplay) play(el);
  }

  function togglePlay(): void {
    const el = audioEl;
    if (!el || !playable.value) return;
    if (el.paused) play(el);
    else el.pause();
  }

  // Scrolling by hand while the recording plays means the user wants to read elsewhere: stop following.
  // Programmatic scrolling (scrollIntoView) fires neither event.
  const onManualScroll = () => {
    if (playing.value) followPaused.value = true;
  };
  window.addEventListener('wheel', onManualScroll, { passive: true });
  window.addEventListener('touchmove', onManualScroll, { passive: true });

  onScopeDispose(() => {
    window.removeEventListener('wheel', onManualScroll);
    window.removeEventListener('touchmove', onManualScroll);
    registerAudioElement(null);
    if (audioUrl.value) URL.revokeObjectURL(audioUrl.value);
  });

  return {
    audioUrl,
    sourceMatch,
    currentTime,
    playing,
    playbackError,
    followPlayback,
    followPaused,
    playable,
    activeTurnId,
    registerAudioElement,
    attachFromRunFile,
    attachManual,
    seekTo,
    togglePlay,
  };
});
