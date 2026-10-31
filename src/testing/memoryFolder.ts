// Test only: an in-memory ProjectFolder (storage/folder.ts) for unit tests. It can be seeded with files, made to
// fail on chosen paths, changed "by someone else" (to test the change check and refresh), and held mid-read (to
// test what happens while a load runs). Every write and change moves its clock on, so `lastModified` differs.
import {
  FOLDER_MESSAGES,
  FolderError,
  type FileStat,
  type FolderEntry,
  type FolderErrorKind,
  type ProjectFolder,
} from '../storage/folder';

/** When the first seeded file was last modified. */
export const MEMORY_FOLDER_EPOCH = Date.UTC(2026, 9, 1, 9, 0, 0);

interface StoredFile {
  text: string;
  lastModified: number;
}

export interface MemoryFolder extends ProjectFolder {
  /** Adds or replaces files as someone else would, e.g. a colleague's new session. */
  put(path: string, text: string): void;
  remove(path: string): void;
  /** The text of a file, or `undefined`. */
  text(path: string): string | undefined;
  /** Every file's path, sorted. */
  paths(): string[];
  /** Makes reads and writes of `path` throw a FolderError of `kind` (`null` stops it). */
  failOn(path: string, kind: FolderErrorKind | null): void;
  /** Makes every operation throw a FolderError of `kind`, e.g. `permission` (`null` stops it). */
  failAll(kind: FolderErrorKind | null): void;
  /** Holds every read until the returned function is called. */
  hold(): () => void;
  /** The paths read and written, in order. */
  readonly reads: string[];
  readonly writes: string[];
  /** How many times `list` was called. */
  readonly listCount: number;
}

const MESSAGES: Record<FolderErrorKind, string> = {
  unsupported: FOLDER_MESSAGES.unsupported,
  cancelled: FOLDER_MESSAGES.cancelled,
  permission: FOLDER_MESSAGES.permission,
  not_found: FOLDER_MESSAGES.notFound,
  offline: FOLDER_MESSAGES.offline,
  changed: FOLDER_MESSAGES.changed,
  invalid: FOLDER_MESSAGES.invalid,
  io: "DeScribe couldn't read this file.",
};

export function folderError(kind: FolderErrorKind, path?: string): FolderError {
  return new FolderError(kind, MESSAGES[kind], path);
}

export function memoryFolder(name = 'Project', seed: Record<string, string> = {}): MemoryFolder {
  const files = new Map<string, StoredFile>();
  const dirs = new Set<string>(['']);
  const failures = new Map<string, FolderErrorKind>();
  let failEverything: FolderErrorKind | null = null;
  let clock = MEMORY_FOLDER_EPOCH;
  let gate: Promise<void> | null = null;
  const reads: string[] = [];
  const writes: string[] = [];
  let listCount = 0;

  function store(path: string, text: string): StoredFile {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    const file = { text, lastModified: clock };
    clock += 1000;
    files.set(path, file);
    return file;
  }

  for (const [path, text] of Object.entries(seed)) store(path, text);

  const statOf = (file: StoredFile): FileStat => ({
    size: new TextEncoder().encode(file.text).length,
    lastModified: file.lastModified,
  });

  function check(path: string, fileOp: boolean): void {
    if (failEverything) throw folderError(failEverything, path);
    const kind = fileOp ? failures.get(path) : undefined;
    if (kind) throw folderError(kind, path);
  }

  return {
    name,
    reads,
    writes,
    get listCount() {
      return listCount;
    },

    async list(dir = '') {
      listCount++;
      check(dir, false);
      if (!dirs.has(dir)) throw folderError('not_found', dir);
      const prefix = dir === '' ? '' : `${dir}/`;
      const entries = new Map<string, FolderEntry['kind']>();
      for (const path of [...files.keys(), ...dirs]) {
        if (path === dir || !path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length).split('/');
        const first = rest[0] ?? '';
        entries.set(first, rest.length > 1 || dirs.has(prefix + first) ? 'directory' : 'file');
      }
      return [...entries].map(([entryName, kind]) => ({ name: entryName, kind }));
    },

    async stat(path) {
      check(path, false);
      const file = files.get(path);
      return file ? statOf(file) : null;
    },

    async readText(path) {
      if (gate) await gate;
      reads.push(path);
      check(path, true);
      const file = files.get(path);
      if (!file) throw folderError('not_found', path);
      return { text: file.text, stat: statOf(file) };
    },

    async writeText(path, text) {
      writes.push(path);
      check(path, true);
      return statOf(store(path, text));
    },

    put(path, text) {
      store(path, text);
    },

    remove(path) {
      files.delete(path);
    },

    text(path) {
      return files.get(path)?.text;
    },

    paths() {
      return [...files.keys()].sort();
    },

    failOn(path, kind) {
      if (kind) failures.set(path, kind);
      else failures.delete(path);
    },

    failAll(kind) {
      failEverything = kind;
    },

    hold() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
  };
}
