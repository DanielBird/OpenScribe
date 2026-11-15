// The recording, chosen by the desktop app's Rust side and handed to the page as a real File (DECISIONS.md D53): a
// file the user picks with Windows' Open dialog or drops on the window. Rust keeps the path under a token; the page
// gets a read-only file handle and calls `getFile()`, so playback, the duration probe and an ElevenLabs upload work on
// it as on any File. A local transcription names the recording by its token (`tokenOf`).
import { z } from '../lib/zod';
import { invokeCommand, onHostMessage, type HostMessage } from './ipc';

// Made when first used, never at import, so the web build leaves this module out (AGENTS.md rule 1).
function makeSchemas() {
  const token = z.string().regex(/^[0-9a-f]{32}$/);
  return {
    token,
    recording: z.object({
      kind: z.literal('describe.recording'),
      token,
      via: z.enum(['dialog', 'drop']),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
    drag: z.object({ kind: z.literal('describe.drag'), over: z.boolean() }),
  };
}
let cachedSchemas: ReturnType<typeof makeSchemas> | null = null;
const schemas = () => (cachedSchemas ??= makeSchemas());

export interface DroppedRecording {
  file: File;
  /** Where it was dropped, in CSS pixels from the top left of the page. */
  x: number;
  y: number;
}

const tokens = new WeakMap<File, string>();
/** Chosen files that arrived before the command that chose them returned, by token. */
const arrived = new Map<string, File>();
const waiting = new Map<string, (file: File) => void>();
const dropListeners = new Set<(drop: DroppedRecording) => void>();
const dragListeners = new Set<(over: boolean) => void>();
let listening = false;

interface FileHandle {
  kind: string;
  getFile(): Promise<File>;
}

function isFileHandle(value: unknown): value is FileHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'file' &&
    typeof (value as { getFile?: unknown }).getFile === 'function'
  );
}

async function receive(message: HostMessage): Promise<void> {
  const drag = schemas().drag.safeParse(message.data);
  if (drag.success) {
    for (const listener of dragListeners) listener(drag.data.over);
    return;
  }
  const parsed = schemas().recording.safeParse(message.data);
  const handle = message.objects[0];
  if (!parsed.success || !isFileHandle(handle)) return;
  const file = await handle.getFile();
  const { token, via, x, y } = parsed.data;
  tokens.set(file, token);
  if (via === 'drop') {
    for (const listener of dropListeners) listener({ file, x: x ?? 0, y: y ?? 0 });
    return;
  }
  const resolve = waiting.get(token);
  if (resolve) {
    waiting.delete(token);
    resolve(file);
  } else {
    arrived.set(token, file);
  }
}

function listen(): void {
  if (listening) return;
  listening = true;
  onHostMessage((message) => {
    receive(message).catch((error: unknown) =>
      console.error('DeScribe: a recording handed over failed', error),
    );
  });
}

/** Shows Windows' Open dialog. The chosen file, or null if the user cancelled. Rejects if the dialog failed. */
export async function chooseRecording(): Promise<File | null> {
  listen();
  const token = schemas()
    .token.nullable()
    .parse(await invokeCommand('stt_choose_recording'));
  if (token === null) return null;
  const early = arrived.get(token);
  if (early) {
    arrived.delete(token);
    return early;
  }
  return new Promise<File>((resolve) => waiting.set(token, resolve));
}

/** Calls `listener` for each recording dropped on the window. Returns a function that stops it. */
export function onDroppedRecording(listener: (drop: DroppedRecording) => void): () => void {
  listen();
  dropListeners.add(listener);
  return () => dropListeners.delete(listener);
}

/** Calls `listener` when a file is dragged over the window (true) and when it leaves or is dropped (false). */
export function onDragOverWindow(listener: (over: boolean) => void): () => void {
  listen();
  dragListeners.add(listener);
  return () => dragListeners.delete(listener);
}

/** The token Rust keeps the file's path under, if Rust chose it. */
export function tokenOf(file: File): string | null {
  return tokens.get(file) ?? null;
}
