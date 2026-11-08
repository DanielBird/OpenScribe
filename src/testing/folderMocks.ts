// Test only: the browser side of storage/folder.ts, replaced for store specs. A "handle" here carries the
// MemoryFolder it opens. Use it with
//   vi.mock('../storage/folder', async (importOriginal) =>
//     (await import('../testing/folderMocks')).mockFolderModule(await importOriginal()));
// and drive it through `folderMocks`. Only types are imported from storage/folder here: the factory runs while that
// module is being mocked.
import type * as FolderModule from '../storage/folder';
import type { MemoryFolder } from './memoryFolder';

export const folderMocks = {
  supported: true,
  stored: null as null | { handle: unknown; projectName: string },
  /** The saved recent list, and how many times it has been saved. */
  recent: [] as FolderModule.RecentFolder[],
  recentSaves: 0,
  permission: 'granted' as PermissionState,
  grantOnRequest: true,
  requests: 0,
  /** What the next folder pickers return, in order; a picker with nothing queued is dismissed. */
  picks: [] as (MemoryFolder | null)[],
};

export function resetFolderMocks(): void {
  folderMocks.supported = true;
  folderMocks.stored = null;
  folderMocks.recent = [];
  folderMocks.recentSaves = 0;
  folderMocks.permission = 'granted';
  folderMocks.grantOnRequest = true;
  folderMocks.requests = 0;
  folderMocks.picks = [];
}

export const handleFor = (folder: MemoryFolder) => ({
  kind: 'directory',
  name: folder.name,
  folder,
});

/** An entry of the saved recent list, for `folderMocks.recent`. */
export const recentEntry = (
  folder: MemoryFolder,
  projectId: string,
  projectName: string,
): FolderModule.RecentFolder => ({
  handle: handleFor(folder) as unknown as FileSystemDirectoryHandle,
  projectId,
  projectName,
});

/** The next folder picker returns this folder; `null` dismisses it. */
export function pickNext(folder: MemoryFolder | null): void {
  folderMocks.picks.push(folder);
}

/** Remembers `folder` as the project folder, with access granted (or not), as after a reload. */
export function rememberFolder(
  folder: MemoryFolder,
  permission: PermissionState = 'granted',
  projectName = 'Remembered',
): void {
  folderMocks.stored = { handle: handleFor(folder), projectName };
  folderMocks.permission = permission;
}

export function mockFolderModule(actual: typeof FolderModule): typeof FolderModule {
  return {
    ...actual,
    isFolderAccessSupported: () => folderMocks.supported,
    pickFolder: async () => {
      const folder = folderMocks.picks.shift();
      if (!folder) throw new actual.FolderError('cancelled', '');
      return handleFor(folder) as unknown as FileSystemDirectoryHandle;
    },
    openFolder: (handle) => (handle as unknown as { folder: MemoryFolder }).folder,
    folderPermission: async () => folderMocks.permission,
    requestFolderPermission: async () => {
      folderMocks.requests++;
      if (folderMocks.grantOnRequest) folderMocks.permission = 'granted';
      return folderMocks.grantOnRequest;
    },
    loadFolderHandle: async () =>
      folderMocks.stored as { handle: FileSystemDirectoryHandle; projectName: string } | null,
    saveFolderHandle: async (handle, projectName) => {
      folderMocks.stored = { handle, projectName };
    },
    forgetFolderHandle: async () => {
      folderMocks.stored = null;
    },
    loadRecentFolders: async () => folderMocks.recent,
    saveRecentFolders: async (folders) => {
      folderMocks.recent = [...folders];
      folderMocks.recentSaves++;
    },
    forgetRecentFolders: async () => {
      folderMocks.recent = [];
    },
  };
}
