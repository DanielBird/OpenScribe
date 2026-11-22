import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummary } from '../domain/summary';
import { addTheme, setBlockText } from '../domain/summaryEdit';
import type { TranscriptDoc } from '../domain/transcript';
import { clearCorpusCache } from '../storage/corpusCache';
import { folderMocks as mocks, handleFor, resetFolderMocks } from '../testing/folderMocks';
import { memoryFolder, type MemoryFolder } from '../testing/memoryFolder';
import {
  makeSummaryFile,
  projectFiles,
  summaryFileText,
  summaryPath,
} from '../testing/projectSeed';
import { makeDoc, withTranslation } from '../testing/transcriptDoc';
import { usePipelineStore } from './pipeline';
import { useProjectStore } from './project';
import { useSummaryEditStore } from './summaryEdit';
import { SAVE_DELAY_MS } from './transcript';

vi.mock('../storage/folder', async (importOriginal) =>
  (await import('../testing/folderMocks')).mockFolderModule(await importOriginal()),
);

const known = () => false;
const titled = (s: SessionSummary, title: string) =>
  setBlockText(s, { kind: 'title' }, title, known);

let doc: TranscriptDoc;
let folder: MemoryFolder;

async function ready() {
  mocks.stored = { handle: handleFor(folder), projectName: 'Remembered' };
  mocks.permission = 'granted';
  const project = useProjectStore();
  await project.init();
  return { project, edit: useSummaryEditStore() };
}

const fileOnDisk = () => JSON.parse(folder.text(summaryPath(doc)) ?? '{}');

beforeEach(async () => {
  resetFolderMocks();
  await clearCorpusCache();
  setActivePinia(createPinia());
  doc = withTranslation(makeDoc());
  folder = memoryFolder('P', {
    ...projectFiles([doc]),
    [summaryPath(doc)]: JSON.stringify({ ...makeSummaryFile(doc), futureField: 1 }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('summaryEdit', () => {
  it('starts on a session with a summary, and saves a change after the delay', async () => {
    const { project, edit } = await ready();
    expect(await edit.start(doc.id)).toBe(true);
    expect(edit.draft).toBe(project.session(doc.id)!.summary!.summary);
    vi.useFakeTimers();
    edit.change(titled(edit.draft!, 'Edited'));
    expect(edit.unsaved).toBe(true);
    expect(fileOnDisk().summary.title).not.toBe('Edited');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    vi.useRealTimers();
    await edit.flush();
    const written = fileOnDisk();
    expect(written.summary.title).toBe('Edited');
    expect(written.futureField).toBe(1);
    expect(written.createdAt).toBe(makeSummaryFile(doc).createdAt);
    expect(written.transcriptHash).toBe(makeSummaryFile(doc).transcriptHash);
    expect(edit.unsaved).toBe(false);
    expect(project.session(doc.id)).toMatchObject({ title: 'Edited', status: 'ok' });
  });

  it('saves each change from the stat the last save returned', async () => {
    const { edit } = await ready();
    await edit.start(doc.id);
    edit.change(titled(edit.draft!, 'One'));
    await edit.flush();
    edit.change(titled(edit.draft!, 'Two'));
    await edit.flush();
    expect(edit.conflict).toBe(false);
    expect(fileOnDisk().summary.title).toBe('Two');
  });

  it('flushes on Done, tidies the draft, and ends editing', async () => {
    const { edit } = await ready();
    await edit.start(doc.id);
    const themes = edit.draft!.themes.length;
    edit.change(addTheme(titled(edit.draft!, 'Done title '), 0));
    expect(await edit.done()).toBe(true);
    expect(edit.sessionId).toBeNull();
    expect(fileOnDisk().summary.title).toBe('Done title');
    expect(fileOnDisk().summary.themes).toHaveLength(themes);
  });

  it('flushes on pagehide', async () => {
    const { edit } = await ready();
    await edit.start(doc.id);
    edit.change(titled(edit.draft!, 'Closing'));
    window.dispatchEvent(new Event('pagehide'));
    await edit.flush();
    expect(fileOnDisk().summary.title).toBe('Closing');
  });

  it('stops saving when someone else changed the file, then Keep mine overwrites it', async () => {
    const { edit } = await ready();
    await edit.start(doc.id);
    folder.put(summaryPath(doc), summaryFileText(doc, { model: 'theirs' }));
    edit.change(titled(edit.draft!, 'Mine'));
    await edit.flush();
    expect(edit.conflict).toBe(true);
    expect(edit.folderNotice).toEqual({ kind: 'conflict' });
    expect(fileOnDisk().model).toBe('theirs');
    expect(await edit.done()).toBe(false);
    expect(edit.sessionId).toBe(doc.id);
    await edit.resolveConflict('keep');
    expect(edit.conflict).toBe(false);
    expect(fileOnDisk().summary.title).toBe('Mine');
    expect(edit.unsaved).toBe(false);
  });

  it('Reload takes their version and goes on editing from it', async () => {
    const { edit } = await ready();
    await edit.start(doc.id);
    const generation = edit.generation;
    const theirs = makeSummaryFile(doc, {
      summary: { ...makeSummaryFile(doc).summary, title: 'Theirs' },
    });
    folder.put(summaryPath(doc), JSON.stringify(theirs));
    edit.change(titled(edit.draft!, 'Mine'));
    await edit.flush();
    await edit.resolveConflict('reload');
    expect(edit.conflict).toBe(false);
    expect(edit.draft!.title).toBe('Theirs');
    expect(edit.generation).toBe(generation + 1);
    edit.change(titled(edit.draft!, 'After reload'));
    await edit.flush();
    expect(edit.conflict).toBe(false);
    expect(fileOnDisk().summary.title).toBe('After reload');
  });

  it('keeps the draft when a rescan reads a newer file', async () => {
    const { project, edit } = await ready();
    await edit.start(doc.id);
    edit.change(titled(edit.draft!, 'Mine'));
    const draft = edit.draft;
    folder.put(summaryPath(doc), summaryFileText(doc, { model: 'theirs' }));
    await project.refresh();
    expect(edit.draft).toBe(draft);
    await edit.flush();
    expect(edit.conflict).toBe(true);
  });

  it('shows a lost folder as Reconnect, and keeps the draft', async () => {
    const { project, edit } = await ready();
    await edit.start(doc.id);
    project.status = 'reconnect';
    edit.change(titled(edit.draft!, 'Mine'));
    await edit.flush();
    expect(edit.folderNotice).toMatchObject({ kind: 'reconnect' });
    expect(edit.draft!.title).toBe('Mine');
    expect(edit.unsaved).toBe(true);
  });

  it('won’t start while the pipeline works on the session, and the pipeline leaves an edited one alone', async () => {
    folder.put(summaryPath(doc), summaryFileText(doc, { transcriptHash: 'older text' }));
    const { edit } = await ready();
    const pipeline = usePipelineStore();
    expect(pipeline.summariseAllIds).toEqual([doc.id]);
    const statusOf = vi.spyOn(pipeline, 'statusOf').mockReturnValue('running');
    expect(await edit.start(doc.id)).toBe(false);
    statusOf.mockRestore();
    expect(await edit.start(doc.id)).toBe(true);
    expect(pipeline.summariseAllIds).toEqual([]);
    await pipeline.summarise([doc.id]);
    expect(pipeline.statusOf(doc.id)).toBe('stale');
  });
});
