// The parts of the File System Access API that TypeScript's DOM library leaves out, because only Chromium has
// them (https://wicg.github.io/file-system-access/). The library already has the handles, `createWritable()` and
// async iteration of a directory. Only src/storage/folder.ts uses these (AGENTS.md rule 4).

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

type WellKnownDirectory = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | WellKnownDirectory;
}

interface SaveFilePickerOptions {
  id?: string;
  startIn?: FileSystemHandle | WellKnownDirectory;
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
