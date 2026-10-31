import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FOLDER_MESSAGES,
  FolderError,
  folderPermission,
  forgetFolderHandle,
  isFolderAccessSupported,
  loadFolderHandle,
  openFolder,
  pickFolder,
  requestFolderPermission,
  saveFolderHandle,
  toFolderError,
} from './folder';

// happy-dom has no File System Access, so these fakes stand in for the browser's handles.

const domError = (name: string) => new DOMException(`fake ${name}`, name);

let clock = Date.UTC(2026, 9, 1);

class FakeFileHandle {
  readonly kind = 'file';
  text = '';
  lastModified = clock;
  /** Makes the next operation throw a DOMException with this name. */
  failWith: { op: 'getFile' | 'write'; name: string } | null = null;
  aborted = false;
  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    if (this.failWith?.op === 'getFile') throw domError(this.failWith.name);
    return new File([this.text], this.name, { lastModified: this.lastModified });
  }

  async createWritable() {
    let buffer = '';
    return {
      write: async (chunk: string) => {
        if (this.failWith?.op === 'write') throw domError(this.failWith.name);
        buffer += chunk;
      },
      close: async () => {
        this.text = buffer;
        this.lastModified = clock += 1000;
      },
      abort: async () => {
        this.aborted = true;
      },
    };
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory';
  readonly children = new Map<string, FakeDirectoryHandle | FakeFileHandle>();
  permission: PermissionState = 'granted';
  failWith: string | null = null;
  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    if (this.failWith) throw domError(this.failWith);
    const child = this.children.get(name);
    if (child instanceof FakeDirectoryHandle) return child;
    if (child) throw domError('TypeMismatchError');
    if (!opts.create) throw domError('NotFoundError');
    const dir = new FakeDirectoryHandle(name);
    this.children.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    if (this.failWith) throw domError(this.failWith);
    const child = this.children.get(name);
    if (child instanceof FakeFileHandle) return child;
    if (child) throw domError('TypeMismatchError');
    if (!opts.create) throw domError('NotFoundError');
    const file = new FakeFileHandle(name);
    this.children.set(name, file);
    return file;
  }

  async *values() {
    if (this.failWith) throw domError(this.failWith);
    yield* this.children.values();
  }

  async queryPermission() {
    return this.permission;
  }

  async requestPermission() {
    this.permission = 'granted';
    return this.permission;
  }

  /** Seeds a file, creating its folders. */
  add(path: string, text: string): FakeFileHandle {
    const [first = '', ...rest] = path.split('/');
    if (rest.length === 0) {
      const file = new FakeFileHandle(first);
      file.text = text;
      this.children.set(first, file);
      return file;
    }
    let next = this.children.get(first);
    if (!(next instanceof FakeDirectoryHandle)) {
      next = new FakeDirectoryHandle(first);
      this.children.set(first, next);
    }
    return next.add(rest.join('/'), text);
  }
}

const asHandle = (fake: FakeDirectoryHandle) => fake as unknown as FileSystemDirectoryHandle;

function project() {
  const root = new FakeDirectoryHandle('Hearing at home');
  root.add('describe-project.json', '{"kind":"describe.project"}');
  root.add('sessions/a.transcript.json', 'aaa');
  root.add('sessions/b.summary.json', 'bb');
  return { root, folder: openFolder(asHandle(root)) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openFolder', () => {
  it('is named after the folder', () => {
    expect(project().folder.name).toBe('Hearing at home');
  });

  it('lists the project folder and a subfolder', async () => {
    const { folder } = project();
    expect(await folder.list()).toEqual([
      { name: 'describe-project.json', kind: 'file' },
      { name: 'sessions', kind: 'directory' },
    ]);
    expect((await folder.list('sessions')).map((e) => e.name)).toEqual([
      'a.transcript.json',
      'b.summary.json',
    ]);
  });

  it('reports a missing folder as not_found', async () => {
    await expect(project().folder.list('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('stats a file, and gives null for a missing file or a folder', async () => {
    const { root, folder } = project();
    const handle = root.add('sessions/c.transcript.json', 'hello');
    handle.lastModified = 1234;
    expect(await folder.stat('sessions/c.transcript.json')).toEqual({
      size: 5,
      lastModified: 1234,
    });
    expect(await folder.stat('sessions/missing.json')).toBeNull();
    expect(await folder.stat('missing/x.json')).toBeNull();
    expect(await folder.stat('sessions')).toBeNull();
  });

  it('reads a file with its stat', async () => {
    const { root, folder } = project();
    root.add('sessions/c.transcript.json', 'Grüße').lastModified = 99;
    expect(await folder.readText('sessions/c.transcript.json')).toEqual({
      text: 'Grüße',
      stat: { size: 7, lastModified: 99 },
    });
  });

  it('writes a file, creating missing folders, and returns the new stat', async () => {
    const root = new FakeDirectoryHandle('Empty');
    const folder = openFolder(asHandle(root));
    const stat = await folder.writeText('sessions/new/x.json', '{"a":1}');
    expect(stat.size).toBe(7);
    expect((await folder.readText('sessions/new/x.json')).text).toBe('{"a":1}');
    expect(await folder.stat('sessions/new/x.json')).toEqual(stat);
  });

  it('replaces a file that exists', async () => {
    const { folder } = project();
    const before = await folder.stat('sessions/a.transcript.json');
    const after = await folder.writeText('sessions/a.transcript.json', 'new text');
    expect((await folder.readText('sessions/a.transcript.json')).text).toBe('new text');
    expect(after.lastModified).toBeGreaterThan(before!.lastModified);
  });

  it('aborts the swap file when a write fails', async () => {
    const { root, folder } = project();
    const handle = root.add('sessions/x.json', 'old');
    handle.failWith = { op: 'write', name: 'QuotaExceededError' };
    const error = await folder.writeText('sessions/x.json', 'new').catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'io', path: 'sessions/x.json' });
    expect((error as FolderError).userMessage).toMatch(/couldn't save/);
    expect(handle.aborted).toBe(true);
    expect(handle.text).toBe('old');
  });

  it.each(['', 'sessions/', '/x.json', 'sessions//x.json', '../x.json', 'sessions/./x.json'])(
    'refuses the path %j',
    async (path) => {
      const { folder } = project();
      const op = path === '' ? folder.readText(path) : folder.writeText(path, 'x');
      await expect(op).rejects.toMatchObject({ kind: 'invalid' });
    },
  );

  it('maps a lost permission while listing or reading', async () => {
    const { root, folder } = project();
    root.failWith = 'NotAllowedError';
    await expect(folder.list()).rejects.toMatchObject({
      kind: 'permission',
      userMessage: FOLDER_MESSAGES.permission,
    });
    await expect(folder.readText('describe-project.json')).rejects.toMatchObject({
      kind: 'permission',
    });
    await expect(folder.stat('describe-project.json')).rejects.toMatchObject({
      kind: 'permission',
    });
  });

  it('maps an unreadable cloud-only file: offline when offline, otherwise io, never permission', async () => {
    const { root, folder } = project();
    root.add('sessions/cloud.json', 'x').failWith = { op: 'getFile', name: 'NotReadableError' };
    await expect(folder.readText('sessions/cloud.json')).rejects.toMatchObject({
      kind: 'io',
      path: 'sessions/cloud.json',
    });
    vi.stubGlobal('navigator', { onLine: false });
    await expect(folder.readText('sessions/cloud.json')).rejects.toMatchObject({
      kind: 'offline',
      userMessage: FOLDER_MESSAGES.offline,
    });
  });

  it('maps a file removed after the listing to not_found', async () => {
    const { root, folder } = project();
    root.add('sessions/gone.json', 'x').failWith = { op: 'getFile', name: 'NotFoundError' };
    await expect(folder.readText('sessions/gone.json')).rejects.toMatchObject({
      kind: 'not_found',
      userMessage: FOLDER_MESSAGES.notFound,
    });
  });
});

describe('toFolderError', () => {
  it.each([
    ['NotAllowedError', 'permission'],
    ['SecurityError', 'permission'],
    ['NotFoundError', 'not_found'],
    ['AbortError', 'cancelled'],
    ['NotReadableError', 'io'],
    ['TypeMismatchError', 'io'],
    ['InvalidModificationError', 'io'],
  ])('maps %s to %s', (name, kind) => {
    expect(toFolderError(domError(name), 'read', 'x.json')).toMatchObject({ kind, path: 'x.json' });
  });

  it('maps anything else to io, with a message for the operation', () => {
    expect(toFolderError(new TypeError('boom'), 'list').userMessage).toMatch(/project folder/);
    expect(toFolderError('weird', 'read').userMessage).toMatch(/couldn't read this file/);
  });

  it('passes a FolderError through', () => {
    const error = new FolderError('changed', 'msg', 'x');
    expect(toFolderError(error, 'write')).toBe(error);
  });

  it('keeps paths, not messages from the browser, in its own message', () => {
    const error = toFolderError(domError('NotFoundError'), 'read', 'sessions/x.json');
    expect(error.message).toBe('not_found: sessions/x.json');
  });
});

describe('picking and permission', () => {
  it('is unsupported without showDirectoryPicker', async () => {
    expect(isFolderAccessSupported()).toBe(false);
    await expect(pickFolder()).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('asks for a folder with read and write access', async () => {
    const root = new FakeDirectoryHandle('Picked');
    const picker = vi.fn(async () => root);
    vi.stubGlobal('showDirectoryPicker', picker);
    expect(isFolderAccessSupported()).toBe(true);
    await expect(pickFolder()).resolves.toBe(root);
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ mode: 'readwrite' }));
  });

  it('reports a dismissed picker as cancelled', async () => {
    vi.stubGlobal('showDirectoryPicker', async () => {
      throw domError('AbortError');
    });
    await expect(pickFolder()).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('queries and requests permission', async () => {
    const root = new FakeDirectoryHandle('P');
    root.permission = 'prompt';
    await expect(folderPermission(asHandle(root))).resolves.toBe('prompt');
    await expect(requestFolderPermission(asHandle(root))).resolves.toBe(true);
    await expect(folderPermission(asHandle(root))).resolves.toBe('granted');
  });

  it('treats a failing permission call as not granted', async () => {
    const broken = {
      queryPermission: async () => {
        throw new Error('x');
      },
      requestPermission: async () => {
        throw domError('SecurityError');
      },
    } as unknown as FileSystemDirectoryHandle;
    await expect(folderPermission(broken)).resolves.toBe('prompt');
    await expect(requestFolderPermission(broken)).resolves.toBe(false);
  });
});

describe('the remembered folder', () => {
  afterEach(async () => {
    await forgetFolderHandle();
  });

  it('keeps the handle with the project name, and forgets it', async () => {
    await expect(loadFolderHandle()).resolves.toBeNull();
    await saveFolderHandle(asHandle(new FakeDirectoryHandle('Hearing')), 'Hearing at home 2026');
    const loaded = await loadFolderHandle();
    expect(loaded?.projectName).toBe('Hearing at home 2026');
    expect(loaded?.handle).toMatchObject({ kind: 'directory', name: 'Hearing' });
    await forgetFolderHandle();
    await expect(loadFolderHandle()).resolves.toBeNull();
  });

  it('ignores a stored value of the wrong shape', async () => {
    const { createStore, set } = await import('idb-keyval');
    const store = createStore('describe-v1', 'keyval');
    for (const value of [
      'x',
      { projectName: 'P' },
      { handle: { kind: 'file', name: 'f' }, projectName: 'P' },
    ]) {
      await set('describe.v1.projectFolder', value, store);
      await expect(loadFolderHandle()).resolves.toBeNull();
    }
  });

  it('works quietly without IndexedDB', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const folder = await import('./folder');
    await folder.saveFolderHandle(asHandle(new FakeDirectoryHandle('x')), 'x');
    await expect(folder.loadFolderHandle()).resolves.toBeNull();
    await expect(folder.forgetFolderHandle()).resolves.toBeUndefined();
    vi.resetModules();
  });
});
