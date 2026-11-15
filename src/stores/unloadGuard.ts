// The browser's "Leave site?" confirmation (Chromium 119+), kept up while a store's work would be lost. In the desktop
// app, closing the window doesn't fire `beforeunload`, so the same guards also tell Rust to ask before the window
// closes (src/desktop/closeGuard.ts, DECISIONS.md D53).
import { setCloseGuard } from '../desktop/closeGuard';

export interface UnloadGuard {
  /** Asks before the page is left or reloaded. Holding it again changes nothing. */
  hold(): void;
  /** Stops asking. Releasing it when it isn't held changes nothing. */
  release(): void;
}

/** The guards held now, across every store: the desktop app asks before closing while there is one. */
const held = new Set<symbol>();

function changed(before: number): void {
  if (__DESKTOP__ && (before === 0) !== (held.size === 0)) setCloseGuard(held.size > 0);
}

/** Whether any store's work would be lost now. */
export function anyGuardHeld(): boolean {
  return held.size > 0;
}

/**
 * One guard with its own listener. Make one per store module, never share one between stores: the browser adds a
 * listener only once, so a shared one would be removed by the first store to finish while another still runs.
 */
export function createUnloadGuard(): UnloadGuard {
  const id = Symbol('unload guard');
  const listener = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };
  return {
    hold: () => {
      window.addEventListener('beforeunload', listener);
      const before = held.size;
      held.add(id);
      changed(before);
    },
    release: () => {
      window.removeEventListener('beforeunload', listener);
      const before = held.size;
      held.delete(id);
      changed(before);
    },
  };
}
