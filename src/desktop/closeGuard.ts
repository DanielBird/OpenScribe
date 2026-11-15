// Tells the desktop app whether closing the window now would lose work (src-tauri/src/close_guard.rs). WebView2's
// `beforeunload` doesn't stop the window closing, so Rust asks first instead.
import { invokeCommand } from './ipc';

export function setCloseGuard(active: boolean): void {
  invokeCommand('set_close_guard', { active }).catch((error: unknown) =>
    console.error('DeScribe: the close guard could not be set', error),
  );
}
