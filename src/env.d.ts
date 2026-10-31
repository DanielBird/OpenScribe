/// <reference types="vite/client" />

declare global {
  /** Version from package.json, injected at build time (vite.config.ts `define`). */
  const __APP_VERSION__: string;
  /** Build date as YYYY-MM-DD, injected at build time (vite.config.ts `define`). */
  const __BUILD_DATE__: string;
  /** True only in Vite's `desktop` mode (the Tauri app); vite.config.ts `define`. */
  const __DESKTOP__: boolean;
}

export {};
