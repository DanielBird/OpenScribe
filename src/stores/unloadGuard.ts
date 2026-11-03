// The browser's "Leave site?" confirmation (Chromium 119+), kept up while a store's work would be lost.

export interface UnloadGuard {
  /** Asks before the page is left or reloaded. Holding it again changes nothing. */
  hold(): void;
  /** Stops asking. Releasing it when it isn't held changes nothing. */
  release(): void;
}

/**
 * One guard with its own listener. Make one per store module, never share one between stores: the browser adds a
 * listener only once, so a shared one would be removed by the first store to finish while another still runs.
 */
export function createUnloadGuard(): UnloadGuard {
  const listener = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };
  return {
    hold: () => window.addEventListener('beforeunload', listener),
    release: () => window.removeEventListener('beforeunload', listener),
  };
}
