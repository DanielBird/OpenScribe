// The transcript store's link to its file in the project folder (Phase 15, DECISIONS.md D25): saving back with the
// change check, the conflict and permission notices, and the link across a reload.
import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptDoc } from '../domain/transcript';
import { clearCorpusCache } from '../storage/corpusCache';
import { clearLastTranscript, loadTranscriptLink, saveTranscriptLink } from '../storage/idb';
import { folderMocks, rememberFolder, resetFolderMocks } from '../testing/folderMocks';
import { memoryFolder, type MemoryFolder } from '../testing/memoryFolder';
import {
  makeProjectFile,
  projectFiles,
  projectFileText,
  summaryFileText,
  summaryPath,
  TEST_PROJECT_ID,
  transcriptFileText,
  transcriptPath,
} from '../testing/projectSeed';
import { makeDoc } from '../testing/transcriptDoc';
import { useProjectStore } from './project';
import { SAVE_DELAY_MS, useTranscriptStore } from './transcript';

vi.mock('../storage/folder', async (importOriginal) =>
  (await import('../testing/folderMocks')).mockFolderModule(await importOriginal()),
);

const doc = makeDoc();
const path = transcriptPath(doc);
const fileName = path.slice('sessions/'.length);

const fileDoc = (folder: MemoryFolder, p = path): TranscriptDoc =>
  (JSON.parse(folder.text(p)!) as { doc: TranscriptDoc }).doc;

const relabelled = (d: TranscriptDoc, label: string): TranscriptDoc => ({
  ...d,
  speakers: d.speakers.map((s, i) => (i === 0 ? { ...s, label } : s)),
});

/** The project store, ready on `folder` (remembered, access granted). */
async function readyProject(folder: MemoryFolder) {
  rememberFolder(folder);
  const project = useProjectStore();
  await project.init();
  expect(project.status).toBe('ready');
  return project;
}

/** A reload: new stores, the remembered folder with access to ask for again (file://), the last transcript. */
async function reload(permission: PermissionState) {
  useTranscriptStore().$dispose();
  setActivePinia(createPinia());
  folderMocks.permission = permission;
  const transcript = useTranscriptStore();
  const project = useProjectStore();
  await transcript.loadAutosave();
  await project.init();
  return { transcript, project };
}

/** A session opened from the project on Output. */
async function openLinked(folder: MemoryFolder) {
  const project = await readyProject(folder);
  const transcript = useTranscriptStore();
  await transcript.openFromProject(doc.id);
  return { project, transcript };
}

beforeEach(async () => {
  resetFolderMocks();
  await clearCorpusCache();
  await clearLastTranscript();
  await saveTranscriptLink(null);
  setActivePinia(createPinia());
});

afterEach(() => {
  useTranscriptStore().$dispose();
  vi.useRealTimers();
});

describe('the link', () => {
  it('Open transcript shows the session linked to its file, and remembers the link', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const { transcript } = await openLinked(folder);
    expect(transcript.doc).toEqual(doc);
    const link = {
      docId: doc.id,
      projectId: TEST_PROJECT_ID,
      projectName: 'Hearing at home 2026',
      fileName,
      stat: await folder.stat(path),
    };
    expect(transcript.projectLink).toEqual(link);
    await expect(loadTranscriptLink()).resolves.toEqual(link);
    expect(folder.writes).toEqual([]);
    expect(transcript.folderNotice).toBeNull();
  });

  it('is dropped by a new transcript and by Clear saved data', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const { transcript } = await openLinked(folder);
    await transcript.setDoc(makeDoc({ id: 'another' }));
    expect(transcript.projectLink).toBeNull();
    await expect(loadTranscriptLink()).resolves.toBeNull();

    await transcript.openFromProject(doc.id);
    await transcript.clear();
    expect(transcript.projectLink).toBeNull();
    await expect(loadTranscriptLink()).resolves.toBeNull();
  });

  it('Add to project writes the file and links it; a session already there is linked instead', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const project = await readyProject(folder);
    const transcript = useTranscriptStore();
    await transcript.setDoc(doc);
    await transcript.addToProject();
    expect(fileDoc(folder)).toEqual(doc);
    expect(transcript.projectLink).toMatchObject({ fileName, stat: await folder.stat(path) });
    expect(project.session(doc.id)).toBeDefined();

    await transcript.setDoc(doc); // the same transcript, unlinked
    const writes = folder.writes.length;
    await transcript.addToProject();
    expect(folder.writes).toHaveLength(writes);
    expect(transcript.projectLink).toMatchObject({ fileName });
  });

  it('is dropped when its files are deleted from the folder, so Add to project is offered again', async () => {
    const folder = memoryFolder('P', {
      ...projectFiles([doc]),
      [summaryPath(doc)]: summaryFileText(doc),
    });
    const { project, transcript } = await openLinked(folder);
    folder.remove(path);
    folder.remove(summaryPath(doc));

    await project.refresh();
    expect(project.session(doc.id)).toBeUndefined();
    expect(transcript.projectLink).toBeNull();
    expect(transcript.folderNotice).toBeNull();
    await expect(loadTranscriptLink()).resolves.toBeNull();
    expect(transcript.doc).toEqual(doc);

    // Added again: a new file, linked.
    await transcript.addToProject();
    expect(fileDoc(folder)).toEqual(doc);
    expect(transcript.projectLink).toMatchObject({ fileName });
  });

  it('is dropped after a reload when the file was deleted meanwhile', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    await openLinked(folder);
    folder.remove(path);
    const { transcript, project } = await reload('granted');
    expect(project.status).toBe('ready');
    expect(transcript.projectLink).toBeNull();
    await expect(loadTranscriptLink()).resolves.toBeNull();
  });

  it('is kept while its file is there but cannot be read', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const { project, transcript } = await openLinked(folder);
    folder.put(path, transcriptFileText(relabelled(doc, 'Theirs')));
    folder.failOn(path, 'offline');

    await project.refresh();
    expect(project.session(doc.id)).toBeUndefined();
    expect(transcript.projectLink).toMatchObject({ fileName });
  });
});

describe('saving to the folder', () => {
  it('saves renames and edits after the debounce, each from the stat the last save left', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const { transcript, project } = await openLinked(folder);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    transcript.renameSpeaker('speaker_0', 'Interviewer');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(folder.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(folder.writes).toEqual([path]));
    await transcript.flush();
    expect(fileDoc(folder).speakers[0]!.label).toBe('Interviewer');

    transcript.editTurnText('t1', 'Changed text.');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    await vi.waitFor(() => expect(folder.writes).toHaveLength(2));
    await transcript.flush();
    expect(fileDoc(folder).turns[0]!.text).toBe('Changed text.');
    expect(transcript.projectLink?.stat).toEqual(await folder.stat(path));
    expect(transcript.folderNotice).toBeNull();
    expect(project.session(doc.id)?.text.turns[0]!.text).toBe('Changed text.');
  });

  it('stops at a file someone else changed; Keep mine overwrites theirs', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const { transcript } = await openLinked(folder);
    folder.put(path, transcriptFileText(relabelled(doc, 'Theirs')));

    transcript.renameSpeaker('speaker_0', 'Mine');
    await transcript.flush();
    expect(transcript.folderNotice).toEqual({ kind: 'conflict' });
    expect(fileDoc(folder).speakers[0]!.label).toBe('Theirs');

    // Saving to the folder has stopped; IndexedDB carries on.
    const writes = folder.writes.length;
    transcript.renameSpeaker('speaker_1', 'Anna');
    await transcript.flush();
    expect(folder.writes).toHaveLength(writes);

    await transcript.resolveConflict('keep');
    expect(transcript.folderNotice).toBeNull();
    expect(fileDoc(folder).speakers.map((s) => s.label)).toEqual(['Mine', 'Anna']);
    expect(transcript.projectLink?.stat).toEqual(await folder.stat(path));
  });

  it("Reload replaces the open transcript with the folder's version", async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const { transcript } = await openLinked(folder);
    folder.put(path, transcriptFileText(relabelled(doc, 'Theirs')));
    transcript.renameSpeaker('speaker_0', 'Mine');
    await transcript.flush();

    await transcript.resolveConflict('reload');
    expect(transcript.doc?.speakers[0]!.label).toBe('Theirs');
    expect(transcript.folderNotice).toBeNull();
    expect(transcript.projectLink?.stat).toEqual(await folder.stat(path));

    // Saving goes on from their version.
    transcript.renameSpeaker('speaker_1', 'Anna');
    await transcript.flush();
    expect(fileDoc(folder).speakers.map((s) => s.label)).toEqual(['Theirs', 'Anna']);
  });

  it('offers Reconnect when access ends, keeps saving to IndexedDB, and saves once reconnected', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const { transcript, project } = await openLinked(folder);
    folder.failAll('permission');
    transcript.renameSpeaker('speaker_0', 'Interviewer');
    await transcript.flush();
    expect(transcript.folderNotice).toEqual({
      kind: 'reconnect',
      projectName: 'Hearing at home 2026',
    });
    expect(project.status).toBe('reconnect');
    expect(transcript.saveFailed).toBe(false);

    folder.failAll(null);
    folderMocks.permission = 'prompt';
    await transcript.reconnectFolder();
    expect(folderMocks.requests).toBe(1);
    expect(transcript.folderNotice).toBeNull();
    expect(fileDoc(folder).speakers[0]!.label).toBe('Interviewer');
  });

  it('says which project to open when another one is open', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const { transcript, project } = await openLinked(folder);
    const other = memoryFolder('Other', {
      'describe-project.json': projectFileText({ id: 'other-project', name: 'Other' }),
    });
    folderMocks.picks.push(other);
    await project.openProject();
    expect(project.project?.id).toBe('other-project');

    transcript.renameSpeaker('speaker_0', 'Interviewer');
    await transcript.flush();
    expect(transcript.folderNotice).toEqual({
      kind: 'otherProject',
      projectName: 'Hearing at home 2026',
    });
    expect(other.writes).toEqual([]);
  });
});

describe('after a reload', () => {
  it('keeps the link; a change waits for Reconnect, then saves without a false conflict', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    await openLinked(folder);

    const { transcript, project } = await reload('prompt');
    expect(project.status).toBe('reconnect');
    expect(transcript.projectLink).toMatchObject({ fileName, projectName: 'Hearing at home 2026' });

    transcript.renameSpeaker('speaker_0', 'Interviewer');
    await transcript.flush();
    expect(transcript.folderNotice).toMatchObject({ kind: 'reconnect' });

    await transcript.reconnectFolder();
    expect(transcript.folderNotice).toBeNull();
    expect(fileDoc(folder).speakers[0]!.label).toBe('Interviewer');
  });

  it('saves changes the folder missed as soon as the project is ready', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const first = await openLinked(folder);
    folder.failAll('permission');
    first.transcript.renameSpeaker('speaker_0', 'Interviewer');
    await first.transcript.flush();
    folder.failAll(null);

    const { transcript } = await reload('granted');
    await vi.waitFor(() => expect(fileDoc(folder).speakers[0]!.label).toBe('Interviewer'));
    await transcript.flush();
    expect(transcript.folderNotice).toBeNull();
  });

  it('stops for a choice when a colleague changed the file meanwhile', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    await openLinked(folder);
    folder.put(path, transcriptFileText(relabelled(doc, 'Theirs')));

    const { transcript } = await reload('granted');
    await vi.waitFor(() => expect(transcript.folderNotice).toEqual({ kind: 'conflict' }));
  });

  it('takes the new stat when the file changed but holds the same text', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    await openLinked(folder);
    folder.put(path, transcriptFileText(doc, '2026-10-19T09:00:00.000Z'));

    const { transcript } = await reload('granted');
    await vi.waitFor(async () =>
      expect(transcript.projectLink?.stat).toEqual(await folder.stat(path)),
    );
    expect(transcript.folderNotice).toBeNull();
  });

  it('links by id a transcript that is in the project but has no link, and asks if they differ', async () => {
    const folder = memoryFolder('P', projectFiles([doc]));
    const transcript = useTranscriptStore();
    await transcript.setDoc(relabelled(doc, 'Mine'));
    await readyProject(folder);
    await vi.waitFor(() => expect(transcript.projectLink).toMatchObject({ fileName }));
    expect(transcript.folderNotice).toEqual({ kind: 'conflict' });
  });

  it('ignores a remembered link to another transcript', async () => {
    await useTranscriptStore().setDoc(doc);
    await saveTranscriptLink({
      docId: 'someone-else',
      projectId: makeProjectFile().id,
      projectName: 'P',
      fileName,
      stat: { size: 1, lastModified: 1 },
    });
    const { transcript: reloaded } = await reload('prompt');
    expect(reloaded.doc?.id).toBe(doc.id);
    expect(reloaded.projectLink).toBeNull();
  });
});
