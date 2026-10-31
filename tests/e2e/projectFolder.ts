import type { Page } from '@playwright/test';

// The project folder for e2e specs (reference/file-system-access.md, "E2E harness"). The native folder picker can't
// be automated, and OPFS isn't available on file://, so an init script replaces `showDirectoryPicker` with in-memory
// handles.
//
// The files live here, in Node, behind `page.exposeFunction`: the page mirrors them into real `File`s the first time
// a handle is used, and every write goes back through the binding. So they survive reloads, have no size limit (the
// perf corpus is ~200 MB, far more than sessionStorage holds), and a spec can read what the app wrote or change a file
// "as a colleague" without a page script. Handles stored in IndexedDB lose their methods in the structured clone, so
// the script revives them when IndexedDB hands them back.

export type FolderFiles = Record<string, string>;

/** When the first seeded file was last modified; each further file is a second later. Fixed, so caches hit. */
const SEED_EPOCH = Date.UTC(2026, 9, 1, 9, 0, 0);

interface StoredFile {
  text: string;
  lastModified: number;
}

export interface ProjectFolderHarness {
  /** Every file of a folder, as the app left it. */
  files(root: string): FolderFiles;
  /** Adds or replaces a file as a colleague would (OneDrive brings it in). The open page sees it at once. */
  put(root: string, path: string, text: string): Promise<void>;
  remove(root: string, path: string): Promise<void>;
  /**
   * What the next folder picker returns: a folder's name, `'cancel'` to dismiss it, or `'refuse'` for the browser to
   * refuse access (`NotAllowedError`).
   */
  pickNext(root: string | 'cancel' | 'refuse'): Promise<void>;
  /** `prompt`: access has ended (a new browser session), so the app must ask with **Reconnect**. */
  setPermission(permission: 'granted' | 'prompt'): Promise<void>;
  /**
   * Holds reading files' text in the page until the returned function is called, to see the loading state. Only
   * paths starting with `prefix`, e.g. `sessions/` to let the project file through. Sizes and dates still come.
   */
  holdReads(prefix?: string): Promise<() => Promise<void>>;
  /** Waits until the page has mirrored every file, e.g. before timing a load. */
  mirrored(): Promise<void>;
}

/**
 * Installs the fake folder picker in `page`, with `folders` (folder name → path → text). Call it before the page
 * opens. Picking grants access, as the real picker does (F2).
 */
export async function useProjectFolder(
  page: Page,
  folders: Record<string, FolderFiles>,
  opts: { permission?: 'granted' | 'prompt'; pick?: string } = {},
): Promise<ProjectFolderHarness> {
  let clock = SEED_EPOCH;
  const roots = new Map<string, Map<string, StoredFile>>();
  for (const [root, files] of Object.entries(folders)) {
    const map = new Map<string, StoredFile>();
    for (const [path, text] of Object.entries(files)) {
      map.set(path, { text, lastModified: clock });
      clock += 1000;
    }
    roots.set(root, map);
  }
  const state = {
    permission: opts.permission ?? 'granted',
    pick: opts.pick ?? Object.keys(folders)[0] ?? 'cancel',
  };
  const folder = (root: string) => {
    const map = roots.get(root);
    if (!map) throw new Error(`useProjectFolder: no folder named ${root}`);
    return map;
  };

  await page.exposeFunction('__fsListing', () => ({
    ...state,
    roots: Object.fromEntries(
      [...roots].map(([root, map]) => [
        root,
        [...map].map(([path, file]) => ({ path, lastModified: file.lastModified })),
      ]),
    ),
  }));
  await page.exposeFunction(
    '__fsRead',
    (root: string, path: string) => folder(root).get(path)?.text ?? null,
  );
  await page.exposeFunction(
    '__fsWrite',
    (root: string, path: string, text: string, lastModified: number) => {
      folder(root).set(path, { text, lastModified });
    },
  );
  await page.exposeFunction('__fsGranted', () => {
    state.permission = 'granted';
  });
  await page.addInitScript(installFakeFolder);

  /** Runs `fn` in the page if it's open; a page that isn't open picks the change up when it next mirrors. */
  const inPage = async (fn: string, ...args: unknown[]) => {
    await page
      .evaluate(
        ([name, rest]) => {
          const fake = (window as unknown as Record<string, unknown>).__fakeFolder as
            Record<string, (...a: unknown[]) => unknown> | undefined;
          return fake?.[name as string]?.(...(rest as unknown[]));
        },
        [fn, args] as const,
      )
      .catch(() => undefined);
  };

  return {
    files(root) {
      return Object.fromEntries([...folder(root)].map(([path, file]) => [path, file.text]));
    },
    async put(root, path, text) {
      const lastModified = (clock += 1000);
      folder(root).set(path, { text, lastModified });
      await inPage('put', root, path, text, lastModified);
    },
    async remove(root, path) {
      folder(root).delete(path);
      await inPage('remove', root, path);
    },
    async pickNext(root) {
      state.pick = root;
      await inPage('setPick', root);
    },
    async setPermission(permission) {
      state.permission = permission;
      await inPage('setPermission', permission);
    },
    async holdReads(prefix = '') {
      await inPage('hold', prefix);
      return () => inPage('release');
    },
    async mirrored() {
      await page.evaluate(() =>
        (
          (window as unknown as Record<string, unknown>).__fakeFolder as { ready(): Promise<void> }
        ).ready(),
      );
    },
  };
}

/** Takes File System Access away, to see the `unsupported` state. Call it before the page opens. */
export async function withoutFolderAccess(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (Window.prototype as unknown as Record<string, unknown>).showDirectoryPicker;
    delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
  });
}

// --- In the page ----------------------------------------------------------------------------------------------
// Runs before the app's scripts on every navigation. Self-contained: Playwright sends its source to the page.

function installFakeFolder(): void {
  type Listing = {
    permission: PermissionState;
    pick: string;
    roots: Record<string, { path: string; lastModified: number }[]>;
  };
  type Bindings = {
    __fsListing(): Promise<Listing>;
    __fsRead(root: string, path: string): Promise<string | null>;
    __fsWrite(root: string, path: string, text: string, lastModified: number): Promise<void>;
    __fsGranted(): Promise<void>;
  };
  const w = window as unknown as Bindings & Record<string, unknown>;

  const files = new Map<string, Map<string, File>>();
  const dirs = new Map<string, Set<string>>();
  const state = { permission: 'prompt' as PermissionState, pick: 'cancel' };
  let filling: Promise<void> | null = null;
  let gate: Promise<void> | null = null;
  let gatePrefix = '';
  let release: (() => void) | null = null;

  const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  const join = (dir: string, name: string) => (dir === '' ? name : `${dir}/${name}`);
  const error = (name: string, message: string) => new DOMException(message, name);
  const notAllowed = () =>
    error(
      'NotAllowedError',
      'The request is not allowed by the user agent or the platform in the current context.',
    );

  function addDirsFor(root: string, path: string): void {
    const set = dirs.get(root) ?? new Set<string>(['']);
    dirs.set(root, set);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'));
  }

  function store(root: string, path: string, text: string, lastModified: number): void {
    const map = files.get(root) ?? new Map<string, File>();
    files.set(root, map);
    map.set(path, new File([text], baseName(path), { lastModified }));
    addDirsFor(root, path);
  }

  async function fill(): Promise<void> {
    const listing = await w.__fsListing();
    state.permission = listing.permission;
    state.pick = listing.pick;
    for (const [root, entries] of Object.entries(listing.roots)) {
      dirs.set(root, new Set(['']));
      files.set(root, new Map());
      for (const { path, lastModified } of entries) {
        const text = await w.__fsRead(root, path);
        if (text !== null) store(root, path, text, lastModified);
      }
    }
  }

  const ready = () => (filling ??= fill());

  function checkAccess(): void {
    if (state.permission !== 'granted') throw notAllowed();
  }

  async function permission(): Promise<PermissionState> {
    await ready();
    return state.permission;
  }

  async function grant(): Promise<PermissionState> {
    await ready();
    state.permission = 'granted';
    await w.__fsGranted();
    return state.permission;
  }

  class FakeFileHandle {
    readonly kind = 'file';
    readonly name: string;
    constructor(
      readonly __fakeRoot: string,
      readonly __fakePath: string,
    ) {
      this.name = baseName(__fakePath);
    }

    async getFile(): Promise<File> {
      await ready();
      checkAccess();
      const file = files.get(this.__fakeRoot)?.get(this.__fakePath);
      if (!file) {
        throw error('NotFoundError', 'A requested file or directory could not be found.');
      }
      if (!gate || !this.__fakePath.startsWith(gatePrefix)) return file;
      // Held: the size and date are there at once, as for a cloud-only file; reading its text waits.
      const held = gate;
      const { name, size, lastModified, type } = file;
      const text = async () => {
        await held;
        return file.text();
      };
      return { name, size, lastModified, type, text } as unknown as File;
    }

    async createWritable() {
      await ready();
      checkAccess();
      const chunks: BlobPart[] = [];
      return {
        write: async (chunk: BlobPart) => {
          chunks.push(chunk);
        },
        close: async () => {
          const text = await new Blob(chunks).text();
          const lastModified = Date.now();
          store(this.__fakeRoot, this.__fakePath, text, lastModified);
          await w.__fsWrite(this.__fakeRoot, this.__fakePath, text, lastModified);
        },
        abort: async () => undefined,
      };
    }

    // Methods, not fields: a handle must survive the structured clone into IndexedDB.
    queryPermission(): Promise<PermissionState> {
      return permission();
    }

    requestPermission(): Promise<PermissionState> {
      return grant();
    }
  }

  class FakeDirectoryHandle {
    readonly kind = 'directory';
    readonly name: string;
    constructor(
      readonly __fakeRoot: string,
      readonly __fakeDir: string,
    ) {
      this.name = __fakeDir === '' ? __fakeRoot : baseName(__fakeDir);
    }

    private hasDir(path: string): boolean {
      return dirs.get(this.__fakeRoot)?.has(path) ?? false;
    }

    private hasFile(path: string): boolean {
      return files.get(this.__fakeRoot)?.has(path) ?? false;
    }

    async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
      await ready();
      checkAccess();
      const path = join(this.__fakeDir, name);
      if (this.hasFile(path)) throw error('TypeMismatchError', 'The path is a file.');
      if (!this.hasDir(path)) {
        if (!opts.create) throw error('NotFoundError', 'A requested directory could not be found.');
        addDirsFor(this.__fakeRoot, `${path}/x`);
      }
      return new FakeDirectoryHandle(this.__fakeRoot, path);
    }

    async getFileHandle(name: string, opts: { create?: boolean } = {}) {
      await ready();
      checkAccess();
      const path = join(this.__fakeDir, name);
      if (this.hasDir(path)) throw error('TypeMismatchError', 'The path is a directory.');
      if (!this.hasFile(path)) {
        if (!opts.create) throw error('NotFoundError', 'A requested file could not be found.');
        store(this.__fakeRoot, path, '', Date.now());
      }
      return new FakeFileHandle(this.__fakeRoot, path);
    }

    async *values() {
      await ready();
      checkAccess();
      const prefix = this.__fakeDir === '' ? '' : `${this.__fakeDir}/`;
      const seen = new Set<string>();
      const children: (FakeDirectoryHandle | FakeFileHandle)[] = [];
      for (const dir of dirs.get(this.__fakeRoot) ?? []) {
        if (
          dir === this.__fakeDir ||
          !dir.startsWith(prefix) ||
          dir.slice(prefix.length).includes('/')
        )
          continue;
        seen.add(dir);
        children.push(new FakeDirectoryHandle(this.__fakeRoot, dir));
      }
      for (const path of files.get(this.__fakeRoot)?.keys() ?? []) {
        if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/') || seen.has(path))
          continue;
        children.push(new FakeFileHandle(this.__fakeRoot, path));
      }
      yield* children;
    }

    async *entries() {
      for await (const handle of this.values()) yield [handle.name, handle] as const;
    }

    // Methods, not fields: a handle must survive the structured clone into IndexedDB.
    queryPermission(): Promise<PermissionState> {
      return permission();
    }

    requestPermission(): Promise<PermissionState> {
      return grant();
    }
  }

  // The picker: the folder chosen with pickNext, with access granted at once (F2).
  Object.defineProperty(window, 'showDirectoryPicker', {
    configurable: true,
    writable: true,
    value: async () => {
      await ready();
      if (state.pick === 'refuse') throw notAllowed();
      if (!files.has(state.pick)) throw error('AbortError', 'The user aborted a request.');
      await grant();
      return new FakeDirectoryHandle(state.pick, '');
    },
  });

  // A handle comes back from IndexedDB as a plain object (the structured clone drops methods): revive it, alone or
  // as a property of the stored value ({ handle, projectName }).
  function revive(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) return value;
    const v = value as Record<string, unknown>;
    if (v.kind === 'directory' && typeof v.__fakeRoot === 'string') {
      return new FakeDirectoryHandle(v.__fakeRoot, String(v.__fakeDir ?? ''));
    }
    if (v.kind === 'file' && typeof v.__fakeRoot === 'string') {
      return new FakeFileHandle(v.__fakeRoot, String(v.__fakePath ?? ''));
    }
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(v)) {
      out[key] = revive(inner);
      if (out[key] !== inner) changed = true;
    }
    return changed ? out : value;
  }
  const resultOf = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result')!.get!;
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['get']>
  ) {
    const request = get.apply(this, args);
    Object.defineProperty(request, 'result', { get: () => revive(resultOf.call(request)) });
    return request;
  };

  // For the spec, through the harness.
  w.__fakeFolder = {
    ready,
    async put(root: string, path: string, text: string, lastModified: number) {
      await ready();
      store(root, path, text, lastModified);
    },
    async remove(root: string, path: string) {
      await ready();
      files.get(root)?.delete(path);
    },
    setPick(root: string) {
      state.pick = root;
    },
    setPermission(next: PermissionState) {
      state.permission = next;
    },
    hold(prefix: string) {
      gatePrefix = prefix;
      gate = new Promise<void>((resolve) => (release = resolve));
    },
    release() {
      gate = null;
      release?.();
      release = null;
    },
  };
}
