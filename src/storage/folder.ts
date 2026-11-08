// The project folder, through the browser's File System Access API (DECISIONS.md T11). This is the only code that
// calls the API (AGENTS.md rule 4). Every browser error becomes a FolderError with a kind and a message that says
// what happened and what to do; the mapping follows reference/file-system-access.md, "Rules for Phase 14".
import { del, get, set } from 'idb-keyval';
import { keyvalStore } from './idb';
import { STORAGE_PREFIX } from './local';

export interface FileStat {
  size: number;
  lastModified: number;
}

export interface FolderEntry {
  name: string;
  kind: 'file' | 'directory';
}

export type FolderErrorKind =
  | 'unsupported'
  | 'cancelled'
  | 'permission'
  | 'not_found'
  | 'offline'
  | 'changed'
  | 'invalid'
  | 'io';

/** What Describe was doing when an error happened; it picks the message for `io`. */
export type FolderOperation = 'pick' | 'list' | 'read' | 'write';

const IO_MESSAGES: Record<FolderOperation, string> = {
  pick: "DeScribe couldn't open the folder. Try again.",
  list: "DeScribe couldn't read the project folder. Check that it's still there, then try again.",
  read: "DeScribe couldn't read this file. If it's only in OneDrive, check the connection and try again.",
  write: "DeScribe couldn't save this file. Try again.",
};

export const FOLDER_MESSAGES = {
  unsupported: "This browser can't open project folders. Use Edge or Chrome.",
  cancelled: '',
  permission: 'DeScribe no longer has access to the project folder. Reconnect it.',
  notFound: 'This file was moved or deleted.',
  offline:
    'This file is only in OneDrive and the computer is offline. Connect, or set the folder to Always keep on ' +
    'this device.',
  changed: 'Someone else changed this file since DeScribe read it.',
  invalid: "This file isn't one DeScribe can read.",
  badPath: "DeScribe can't use this file name.",
} as const;

export class FolderError extends Error {
  readonly kind: FolderErrorKind;
  readonly userMessage: string;
  readonly path?: string;

  constructor(kind: FolderErrorKind, userMessage: string, path?: string) {
    // The technical message names the kind and the path relative to the project, never more.
    super(path ? `${kind}: ${path}` : kind);
    this.name = 'FolderError';
    this.kind = kind;
    this.userMessage = userMessage;
    if (path !== undefined) this.path = path;
  }
}

function errorName(err: unknown): string | null {
  return err instanceof Error || err instanceof DOMException ? err.name : null;
}

/** Maps what the browser threw to a FolderError (reference/file-system-access.md, Rule 2). */
export function toFolderError(err: unknown, op: FolderOperation, path?: string): FolderError {
  if (err instanceof FolderError) return err;
  switch (errorName(err)) {
    // Access ended with the browser session (F5). SecurityError: a permission request without a click.
    case 'NotAllowedError':
    case 'SecurityError':
      return new FolderError('permission', FOLDER_MESSAGES.permission, path);
    // A file that's only in the cloud, read offline (F9). Its message blames permissions, wrongly: never offer
    // Reconnect for it.
    case 'NotReadableError':
      return navigator.onLine === false
        ? new FolderError('offline', FOLDER_MESSAGES.offline, path)
        : new FolderError('io', IO_MESSAGES[op], path);
    // Renamed or deleted after the listing (F11).
    case 'NotFoundError':
      return new FolderError('not_found', FOLDER_MESSAGES.notFound, path);
    // The picker was dismissed.
    case 'AbortError':
      return new FolderError('cancelled', FOLDER_MESSAGES.cancelled, path);
    default:
      return new FolderError('io', IO_MESSAGES[op], path);
  }
}

/** A path's names. Paths use `/` and are relative to the project folder; `''` is the folder itself. */
function segments(path: string): string[] {
  if (path === '') return [];
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new FolderError('invalid', FOLDER_MESSAGES.badPath, path);
  }
  return parts;
}

const statOf = (file: File): FileStat => ({ size: file.size, lastModified: file.lastModified });

/** The project folder, as the rest of the app sees it. */
export interface ProjectFolder {
  readonly name: string;
  /** The entries of a folder, `''` being the project folder. A missing folder throws `not_found`. */
  list(dir?: string): Promise<FolderEntry[]>;
  /** `null` when there is no such file. */
  stat(path: string): Promise<FileStat | null>;
  readText(path: string): Promise<{ text: string; stat: FileStat }>;
  /** Creates missing folders and replaces the file in one step (`createWritable`). Returns the new stat. */
  writeText(path: string, text: string): Promise<FileStat>;
}

export function openFolder(handle: FileSystemDirectoryHandle): ProjectFolder {
  async function directory(names: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let current = handle;
    for (const name of names) current = await current.getDirectoryHandle(name, { create });
    return current;
  }

  async function fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const names = segments(path);
    const name = names.pop();
    if (name === undefined) throw new FolderError('invalid', FOLDER_MESSAGES.badPath, path);
    return (await directory(names, create)).getFileHandle(name, { create });
  }

  return {
    name: handle.name,

    async list(dir = '') {
      try {
        const folder = await directory(segments(dir), false);
        const entries: FolderEntry[] = [];
        for await (const entry of folder.values())
          entries.push({ name: entry.name, kind: entry.kind });
        return entries;
      } catch (err) {
        throw toFolderError(err, 'list', dir);
      }
    },

    async stat(path) {
      try {
        return statOf(await (await fileHandle(path, false)).getFile());
      } catch (err) {
        // A missing file, or a folder where the file should be: there is no such file.
        if (errorName(err) === 'TypeMismatchError') return null;
        const error = toFolderError(err, 'read', path);
        if (error.kind === 'not_found') return null;
        throw error;
      }
    },

    async readText(path) {
      try {
        const file = await (await fileHandle(path, false)).getFile();
        return { text: await file.text(), stat: statOf(file) };
      } catch (err) {
        throw toFolderError(err, 'read', path);
      }
    },

    async writeText(path, text) {
      let writable: FileSystemWritableFileStream | null = null;
      try {
        const file = await fileHandle(path, true);
        // The default mode: overlapping writes don't fail, and the last close() wins (F12). The change check
        // before writing is what protects a colleague's edit.
        writable = await file.createWritable();
        await writable.write(text);
        await writable.close();
        writable = null;
        return statOf(await file.getFile());
      } catch (err) {
        await writable?.abort().catch(() => undefined);
        throw toFolderError(err, 'write', path);
      }
    },
  };
}

// --- Picking and permission --------------------------------------------------------------------------

export function isFolderAccessSupported(): boolean {
  try {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  } catch {
    return false;
  }
}

/** Opens the folder picker. Call it straight from a click. `FolderError('cancelled')` if it's dismissed. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  if (!isFolderAccessSupported()) {
    throw new FolderError('unsupported', FOLDER_MESSAGES.unsupported);
  }
  try {
    return await window.showDirectoryPicker({ id: 'describe-project', mode: 'readwrite' });
  } catch (err) {
    throw toFolderError(err, 'pick');
  }
}

/** `granted`, or `prompt` when access has to be asked for again (every new browser session on file://, F5). */
export async function folderPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'prompt';
  }
}

/** Asks for access again. Call it straight from a click, before any `await`: the browser requires it. */
export async function requestFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

// --- The remembered folder ---------------------------------------------------------------------------

/** In the `describe-v1` database, with the project's name, so Home can show it before access is granted. */
const HANDLE_KEY = `${STORAGE_PREFIX}projectFolder`;

/** A stored directory handle comes back from IndexedDB as a live handle; anything else here is ignored. */
function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<Record<'kind' | 'name', unknown>>;
  return v.kind === 'directory' && typeof v.name === 'string';
}

export async function saveFolderHandle(
  handle: FileSystemDirectoryHandle,
  projectName: string,
): Promise<void> {
  try {
    const store = keyvalStore();
    if (store) await set(HANDLE_KEY, { handle, projectName }, store);
  } catch {
    // Not remembered: the next visit starts from Open project.
  }
}

export async function loadFolderHandle(): Promise<{
  handle: FileSystemDirectoryHandle;
  projectName: string;
} | null> {
  try {
    const store = keyvalStore();
    if (!store) return null;
    const value: unknown = await get(HANDLE_KEY, store);
    if (typeof value !== 'object' || value === null) return null;
    const { handle, projectName } = value as Record<string, unknown>;
    if (!isDirectoryHandle(handle) || typeof projectName !== 'string') return null;
    return { handle, projectName };
  } catch {
    return null;
  }
}

export async function forgetFolderHandle(): Promise<void> {
  try {
    const store = keyvalStore();
    if (store) await del(HANDLE_KEY, store);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}

// --- Recent projects (D49) -----------------------------------------------------------------------------

/** A project folder opened on this computer. The list is stored most recent first. */
export interface RecentFolder {
  handle: FileSystemDirectoryHandle;
  projectId: string;
  projectName: string;
}

/** In the `describe-v1` database, beside the remembered folder, which older builds still read. */
const RECENT_KEY = `${STORAGE_PREFIX}recentProjects`;

function isRecentFolder(value: unknown): value is RecentFolder {
  if (typeof value !== 'object' || value === null) return false;
  const { handle, projectId, projectName } = value as Record<string, unknown>;
  return (
    isDirectoryHandle(handle) && typeof projectId === 'string' && typeof projectName === 'string'
  );
}

export async function saveRecentFolders(folders: readonly RecentFolder[]): Promise<void> {
  try {
    const store = keyvalStore();
    if (store) await set(RECENT_KEY, folders, store);
  } catch {
    // Not remembered: the list starts again from the next project opened.
  }
}

/** The recent projects, leaving out any entry that isn't one. */
export async function loadRecentFolders(): Promise<RecentFolder[]> {
  try {
    const store = keyvalStore();
    if (!store) return [];
    const value: unknown = await get(RECENT_KEY, store);
    return Array.isArray(value) ? value.filter(isRecentFolder) : [];
  } catch {
    return [];
  }
}

export async function forgetRecentFolders(): Promise<void> {
  try {
    const store = keyvalStore();
    if (store) await del(RECENT_KEY, store);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}
