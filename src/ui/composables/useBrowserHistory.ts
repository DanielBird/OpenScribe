import { computed, onUnmounted, watch } from 'vue';
import { STEPS, useNavStore, type Step } from '../../stores/nav';
import { useProjectStore } from '../../stores/project';
import { useProjectUi } from './useProjectUi';

/** One page of the app, as kept in a browser history entry (DECISIONS.md D28). */
export type HistoryLocation =
  | { mode: 'home' }
  | { mode: 'transcribe'; step: Step }
  | { mode: 'project'; selected: string | null }
  | { mode: 'settings' };

const HOME: HistoryLocation = { mode: 'home' };

/** Reads a history entry's state back into a location. Anything else, e.g. the entry before the app ran, is Home. */
export function toLocation(state: unknown): HistoryLocation {
  if (typeof state !== 'object' || state === null || !('mode' in state)) return HOME;
  switch (state.mode) {
    case 'home':
    case 'settings':
      return { mode: state.mode };
    case 'transcribe': {
      const step = STEPS.find((s) => 'step' in state && s === state.step);
      return step ? { mode: 'transcribe', step } : HOME;
    }
    case 'project': {
      const selected = 'selected' in state ? state.selected : null;
      return { mode: 'project', selected: typeof selected === 'string' ? selected : null };
    }
    default:
      return HOME;
  }
}

function sameLocation(a: HistoryLocation, b: HistoryLocation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Lets the browser's Back and Forward move between pages. Each page change pushes a history entry holding only
 * state, never a URL, so nothing changes on `file://` and a reload still opens on Home. Back or Forward shows the
 * entry's page through the nav store, or the nearest page that can be shown now (Setup for an Output with nothing
 * in it). Call once, from the app shell.
 */
export function useBrowserHistory(): void {
  const nav = useNavStore();
  const ui = useProjectUi();
  const project = useProjectStore();

  const current = computed<HistoryLocation>(() => {
    switch (nav.mode) {
      case 'transcribe':
        return { mode: 'transcribe', step: nav.step };
      case 'project':
        return { mode: 'project', selected: ui.selected };
      default:
        return { mode: nav.mode };
    }
  });

  function show(target: HistoryLocation): void {
    switch (target.mode) {
      case 'home':
        nav.goHome();
        break;
      case 'transcribe':
        if (!nav.goTo(target.step)) nav.goTo('setup');
        break;
      case 'project':
        nav.enter('project');
        ui.selected =
          target.selected !== null && project.sessions.some((s) => s.sessionId === target.selected)
            ? target.selected
            : null;
        break;
      case 'settings':
        nav.openSettings();
        break;
    }
  }

  function onPopState(event: PopStateEvent): void {
    show(toLocation(event.state));
    // Correct the entry if its page couldn't be shown, so the push below sees nothing new.
    history.replaceState(current.value, '');
  }

  try {
    history.scrollRestoration = 'manual';
  } catch {
    // Not settable in some embedded contexts; the browser's default scrolling is fine there.
  }
  // The first entry is the page shown now, replacing any state left from before a reload.
  history.replaceState(current.value, '');
  window.addEventListener('popstate', onPopState);
  onUnmounted(() => window.removeEventListener('popstate', onPopState));

  watch(current, (location) => {
    if (!sameLocation(location, toLocation(history.state))) history.pushState(location, '');
  });
}
