// The recording, chosen by the desktop app's Rust side and handed to the page as a real File (DECISIONS.md D53): a
// file the user picks with Windows' Open dialog or drops on the window. Rust keeps the path under a token; the page
// gets a read-only file handle and calls `getFile()`, so playback, the duration probe and an ElevenLabs upload work on
// it as on any File. A local transcription names the recording by its token (`tokenOf`).
//
// A handover can fail: WebView2 refuses the file (Rust reports it), or `getFile()` does. Either way the dialog's
// promise rejects and a drop's listener hears why, so no file is waited for in silence.
import { z } from '../lib/zod';
import { invokeCommand, onHostMessage, type HostMessage } from './ipc';

/** Longest wait for a chosen file once Rust has handed it over. It normally takes milliseconds. */
const HANDOVER_TIMEOUT_MS = 10_000;

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
    dropFailed: z.object({
      kind: z.literal('describe.drop-failed'),
      x: z.number(),
      y: z.number(),
      detail: z.string(),
    }),
    rustError: z.object({ kind: z.string(), detail: z.string() }),
  };
}
let cachedSchemas: ReturnType<typeof makeSchemas> | null = null;
const schemas = () => (cachedSchemas ??= makeSchemas());

/** A recording that couldn't be handed to the page. `detail` is for Technical details, and names no path. */
export class RecordingError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = 'RecordingError';
  }
}

/** A file dropped on the window, or why it couldn't be opened, with where it was dropped. */
export type DroppedRecording = ({ file: File } | { error: RecordingError }) & {
  /** CSS pixels from the top left of the page. */
  x: number;
  y: number;
};

type Outcome = File | RecordingError;

const tokens = new WeakMap<File, string>();
/** Chosen files (or their failures) that arrived before the command that chose them returned, by token. */
const arrived = new Map<string, Outcome>();
const waiting = new Map<string, (outcome: Outcome) => void>();
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

function detailOf(cause: unknown): string {
  // stt_choose_recording fails only with the `recording` kind, so its detail says it all.
  const rust = schemas().rustError.safeParse(cause);
  if (rust.success) return rust.data.detail;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return String(cause);
}

async function fileFrom(handle: unknown): Promise<Outcome> {
  if (!isFileHandle(handle)) return new RecordingError('the file came without its handle');
  try {
    return await handle.getFile();
  } catch (cause) {
    return new RecordingError(`couldn't open the file handed over: ${detailOf(cause)}`);
  }
}

function tellDropListeners(drop: DroppedRecording): void {
  for (const listener of dropListeners) listener(drop);
}

async function receive(message: HostMessage): Promise<void> {
  const drag = schemas().drag.safeParse(message.data);
  if (drag.success) {
    for (const listener of dragListeners) listener(drag.data.over);
    return;
  }
  const failed = schemas().dropFailed.safeParse(message.data);
  if (failed.success) {
    const { x, y, detail } = failed.data;
    tellDropListeners({ error: new RecordingError(detail), x, y });
    return;
  }
  const parsed = schemas().recording.safeParse(message.data);
  if (!parsed.success) return;
  const { token, via, x = 0, y = 0 } = parsed.data;
  const outcome = await fileFrom(message.objects[0]);
  if (outcome instanceof File) tokens.set(outcome, token);
  if (via === 'drop') {
    tellDropListeners(outcome instanceof File ? { file: outcome, x, y } : { error: outcome, x, y });
    return;
  }
  const settle = waiting.get(token);
  if (settle) {
    waiting.delete(token);
    settle(outcome);
  } else {
    arrived.set(token, outcome);
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

/** The file handed over under `token`, once it arrives, or why it didn't. Gives up after HANDOVER_TIMEOUT_MS. */
function handedOver(token: string): Promise<Outcome> {
  const early = arrived.get(token);
  if (early) {
    arrived.delete(token);
    return Promise.resolve(early);
  }
  return new Promise<Outcome>((resolve) => {
    // On a timeout the waiter stays, so a file that arrives late is dropped rather than kept in `arrived`.
    const timer = setTimeout(
      () => resolve(new RecordingError('the file never reached the page')),
      HANDOVER_TIMEOUT_MS,
    );
    waiting.set(token, (outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    });
  });
}

/**
 * Shows Windows' Open dialog. The chosen file, or null if the user cancelled. Rejects with a RecordingError if the
 * dialog failed or the file couldn't be handed to the page.
 */
export async function chooseRecording(): Promise<File | null> {
  listen();
  let reply: unknown;
  try {
    reply = await invokeCommand('stt_choose_recording');
  } catch (cause) {
    throw new RecordingError(detailOf(cause));
  }
  const token = schemas().token.nullable().safeParse(reply);
  if (!token.success) throw new RecordingError('Rust sent an unexpected reply');
  if (token.data === null) return null;
  const outcome = await handedOver(token.data);
  if (outcome instanceof RecordingError) throw outcome;
  return outcome;
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
