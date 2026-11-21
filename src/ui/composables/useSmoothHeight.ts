import { onBeforeUnmount, onMounted, type Ref } from 'vue';

const TIMING: KeyframeAnimationOptions = {
  duration: 220,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

/**
 * Makes `box` glide to its new height when `content`, the one child that holds everything in it, changes height
 * (rows found or dropped, a count shown), instead of jumping. `content` must be sized by what's in it, not by `box`.
 * A ResizeObserver sees every change, also those no render makes (a row laid out for the first time once it's
 * scrolled into view), and a change while it's moving glides on from where it is. Showing and hiding `box` stays
 * instant, and with reduced motion it all does.
 */
export function useSmoothHeight(
  box: Readonly<Ref<HTMLElement | null>>,
  content: Readonly<Ref<HTMLElement | null>>,
): void {
  /** The content's height when last seen; 0 while it isn't shown. */
  let last = 0;
  /** The box's height when it last settled: by the time a resize is seen, its own height has changed already. */
  let settled = 0;
  let running: Animation | null = null;
  let observer: ResizeObserver | undefined;

  function stop(): void {
    if (!running) return;
    running.cancel();
    running = null;
    box.value?.style.removeProperty('overflow');
  }

  function onResize(): void {
    const outer = box.value;
    const inner = content.value;
    if (!outer || !inner) return;
    const previous = last;
    last = inner.offsetHeight;
    if (last === previous) return;
    const from = running ? outer.offsetHeight : settled; // as on screen now, partway through a glide included
    stop();
    const to = outer.offsetHeight;
    settled = to;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (previous === 0 || last === 0 || reduced || typeof outer.animate !== 'function') return;
    if (Math.abs(to - from) < 1) return;
    // Clipped while it grows: the content is its new size already, and a modal <dialog> would show a scrollbar.
    outer.style.overflow = 'clip';
    const animation = outer.animate([{ height: `${from}px` }, { height: `${to}px` }], TIMING);
    running = animation;
    const done = (): void => {
      if (running !== animation) return; // cancelled for a newer one, which has the overflow now
      running = null;
      outer.style.removeProperty('overflow');
    };
    animation.finished.then(done, done);
  }

  onMounted(() => {
    if (typeof ResizeObserver === 'undefined' || !content.value) return;
    observer = new ResizeObserver(onResize);
    observer.observe(content.value);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    stop();
  });
}
