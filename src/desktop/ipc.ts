// The only code in src/ that talks to the desktop app's Rust side (AGENTS.md rule 4, DECISIONS.md D53), as
// storage/folder.ts is for the File System Access API. Everything that reaches it sits behind `__DESKTOP__`, so the
// web build has none of it (`verify:single-file` checks). Nothing here is trusted as typed: callers parse every reply
// with zod (AGENTS.md rule 6).
import { Channel, invoke } from '@tauri-apps/api/core';

/** Calls one of the app's commands (`src-tauri/src/stt/commands.rs`). Rejects with what Rust sent: parse it. */
export function invokeCommand(
  command: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return invoke<unknown>(command, args);
}

/** A channel for a command to send messages on, for as long as the command runs. */
export function openChannel(onMessage: (message: unknown) => void): Channel<unknown> {
  return new Channel<unknown>(onMessage);
}

/** A message WebView2 delivered from Rust (`PostWebMessageAsJsonWithAdditionalObjects`), with its objects. */
export interface HostMessage {
  data: unknown;
  objects: readonly unknown[];
}

interface WebViewMessageEvent {
  data: unknown;
  additionalObjects?: ArrayLike<unknown>;
}

interface WebView {
  addEventListener(type: 'message', listener: (event: WebViewMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: WebViewMessageEvent) => void): void;
}

function webView(): WebView | null {
  const chrome = (globalThis as { chrome?: { webview?: WebView } }).chrome;
  return chrome?.webview ?? null;
}

/** Listens for messages Rust posts to the page. Returns a function that stops listening. */
export function onHostMessage(listener: (message: HostMessage) => void): () => void {
  const view = webView();
  if (!view) return () => {};
  const handle = (event: WebViewMessageEvent) =>
    listener({ data: event.data, objects: Array.from(event.additionalObjects ?? []) });
  view.addEventListener('message', handle);
  return () => view.removeEventListener('message', handle);
}
