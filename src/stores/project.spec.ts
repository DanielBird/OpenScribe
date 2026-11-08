import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watch } from 'vue';
import { PROJECT_FILE } from '../domain/sessionFiles';
import type { TranscriptDoc } from '../domain/transcript';
import { clearCorpusCache } from '../storage/corpusCache';
import type { ChatFile } from '../domain/chat';
import { makeCorpus } from '../testing/corpus';
import {
  folderMocks as mocks,
  handleFor,
  pickNext,
  recentEntry,
  rememberFolder,
  resetFolderMocks,
} from '../testing/folderMocks';
import { memoryFolder, type MemoryFolder } from '../testing/memoryFolder';
import {
  chatFileText,
  chatPath,
  FUTURE_FIELD,
  makeChatFile,
  makeProjectFile,
  makeSummaryFile,
  projectFileText,
  projectFiles,
  summaryFileText,
  summaryPath,
  TEST_BRIEF,
  TEST_PROJECT_ID,
  transcriptFileText,
  transcriptPath,
} from '../testing/projectSeed';
import { makeDoc, withTranslation } from '../testing/transcriptDoc';
import {
  MAX_RECENT_PROJECTS,
  PROJECT_MESSAGES,
  REFRESH_DELAY_MS,
  RESCAN_INTERVAL_MS,
  SEARCH_HITS_PER_SESSION,
  SEARCH_PAGE_SESSIONS,
  useProjectStore,
} from './project';

// The browser side of storage/folder.ts is replaced: a "handle" here carries the MemoryFolder it opens.
vi.mock('../storage/folder', async (importOriginal) =>
  (await import('../testing/folderMocks')).mockFolderModule(await importOriginal()),
);

/** A doc from the fixture with its own id, recording name and date. */
function docAt(n: number, overrides: Partial<TranscriptDoc> = {}): TranscriptDoc {
  const base = makeDoc();
  return {
    ...base,
    id: `0000000${n}-0000-4000-8000-00000000000${n}`,
    source: {
      ...base.source,
      fileName: `P0${n} interview.m4a`,
      lastModified: Date.UTC(2026, 8, n),
    },
    ...overrides,
  };
}

const transcriptReads = (folder: MemoryFolder) =>
  folder.reads.filter((path) => path.startsWith('sessions/'));

/** A store with a remembered folder and access granted, after init. */
async function readyStore(folder: MemoryFolder) {
  mocks.stored = { handle: handleFor(folder), projectName: 'Remembered' };
  mocks.permission = 'granted';
  const project = useProjectStore();
  await project.init();
  return project;
}

beforeEach(async () => {
  resetFolderMocks();
  await clearCorpusCache();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('status', () => {
  it('is unsupported without the File System Access API', async () => {
    mocks.supported = false;
    const project = useProjectStore();
    expect(project.status).toBe('unsupported');
    await project.init();
    expect(project.status).toBe('unsupported');
  });

  it('is none when no folder is remembered', async () => {
    const project = useProjectStore();
    await project.init();
    expect(project.status).toBe('none');
    expect(project.projectName).toBeNull();
  });

  it('loads a remembered folder when access is still granted', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    const project = await readyStore(folder);
    expect(project.status).toBe('ready');
    expect(project.projectName).toBe('Hearing at home 2026');
    expect(project.sessions).toHaveLength(1);
  });

  it('asks to reconnect when access must be granted again, and reads nothing until then', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    mocks.stored = { handle: handleFor(folder), projectName: 'Remembered' };
    mocks.permission = 'prompt';
    const project = useProjectStore();
    await project.init();
    expect(project.status).toBe('reconnect');
    expect(project.projectName).toBe('Remembered');
    expect(folder.reads).toEqual([]);
    expect(folder.listCount).toBe(0);

    await project.reconnect();
    expect(mocks.requests).toBe(1);
    expect(project.status).toBe('ready');
    expect(project.sessions).toHaveLength(1);
  });

  it('treats denied like prompt, and stays on reconnect when the request is refused', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    mocks.stored = { handle: handleFor(folder), projectName: 'P' };
    mocks.permission = 'denied';
    mocks.grantOnRequest = false;
    const project = useProjectStore();
    await project.init();
    expect(project.status).toBe('reconnect');
    await project.reconnect();
    expect(project.status).toBe('reconnect');
    expect(folder.reads).toEqual([]);
  });

  it('switches to reconnect when access ends during a load', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    folder.failAll('permission');
    const project = await readyStore(folder);
    expect(project.status).toBe('reconnect');
  });

  it('shows an error for a damaged project file, and Try again loads it once fixed', async () => {
    const folder = memoryFolder('P', { [PROJECT_FILE]: '{nope' });
    const project = await readyStore(folder);
    expect(project.status).toBe('error');
    expect(project.error).toBe(PROJECT_MESSAGES.projectFileInvalid);

    folder.put(PROJECT_FILE, projectFileText());
    await project.retry();
    expect(project.status).toBe('ready');
    expect(project.error).toBeNull();
  });

  it('shows an error when the project file is gone', async () => {
    const folder = memoryFolder('P', { 'sessions/x.txt': '' });
    const project = await readyStore(folder);
    expect(project.status).toBe('error');
    expect(project.error).toBe(PROJECT_MESSAGES.projectFileMissing);
  });
});

describe('Open project and New project', () => {
  it('opens a project and remembers its folder with its name', async () => {
    const folder = memoryFolder('Hearing', projectFiles([docAt(1), docAt(2)]));
    const project = useProjectStore();
    await project.init();
    pickNext(folder);
    await expect(project.openProject()).resolves.toBe(true);
    expect(project.status).toBe('ready');
    expect(project.sessions).toHaveLength(2);
    expect(mocks.stored).toMatchObject({ projectName: 'Hearing at home 2026' });
  });

  it("refuses a folder that isn't a project, and keeps the current state", async () => {
    const project = useProjectStore();
    await project.init();
    pickNext(memoryFolder('Downloads'));
    await expect(project.openProject()).resolves.toBe(false);
    expect(project.notice).toBe(PROJECT_MESSAGES.notAProject);
    expect(project.status).toBe('none');
    expect(mocks.stored).toBeNull();
  });

  it('keeps the open project when another pick is dismissed or refused', async () => {
    const folder = memoryFolder('A', projectFiles([docAt(1)]));
    const project = await readyStore(folder);
    pickNext(null);
    await expect(project.openProject()).resolves.toBe(false);
    expect(project.notice).toBeNull();
    pickNext(memoryFolder('Not a project'));
    await project.openProject();
    expect(project.status).toBe('ready');
    expect(project.sessions).toHaveLength(1);
    expect(project.notice).toBe(PROJECT_MESSAGES.notAProject);
  });

  it('switches to another project and drops the first one', async () => {
    const a = memoryFolder('A', projectFiles([docAt(1), docAt(2)]));
    const b = memoryFolder(
      'B',
      projectFiles([docAt(3)], { id: '99999999-0000-4000-8000-000000000000', name: 'B' }),
    );
    const project = await readyStore(a);
    pickNext(b);
    await project.openProject();
    expect(project.projectName).toBe('B');
    expect(project.sessions.map((s) => s.sessionId)).toEqual([docAt(3).id]);
  });

  it('creates a project named after an empty folder', async () => {
    const folder = memoryFolder('Hearing at home');
    const project = useProjectStore();
    await project.init();
    pickNext(folder);
    await expect(project.newProject()).resolves.toEqual({ created: true });
    expect(project.status).toBe('ready');
    expect(project.project).toMatchObject({ name: 'Hearing at home', kind: 'describe.project' });
    expect(project.sessions).toEqual([]);
    expect(folder.paths()).toEqual([PROJECT_FILE]);
    expect(mocks.stored).toMatchObject({ projectName: 'Hearing at home' });
  });

  it('simply opens a folder that is a project already', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    const project = useProjectStore();
    await project.init();
    pickNext(folder);
    await expect(project.newProject()).resolves.toEqual({ created: false });
    expect(project.status).toBe('ready');
    expect(folder.writes).toEqual([]);
  });

  it('does nothing when the picker is dismissed', async () => {
    const project = useProjectStore();
    await project.init();
    pickNext(null);
    await expect(project.newProject()).resolves.toBeNull();
    expect(project.status).toBe('none');
    expect(project.notice).toBeNull();
  });

  it('says the browser refused a picked folder, rather than asking to reconnect', async () => {
    const project = useProjectStore();
    await project.init();
    // Read but not written: the project file can't be created.
    const readOnly = memoryFolder('Hearing at home');
    readOnly.failOn(PROJECT_FILE, 'permission');
    pickNext(readOnly);
    await expect(project.newProject()).resolves.toBeNull();
    expect(project.notice).toBe(PROJECT_MESSAGES.accessRefused);
    expect(project.status).toBe('none');
    expect(mocks.stored).toBeNull();

    const refused = memoryFolder('P', projectFiles([docAt(1)]));
    refused.failAll('permission');
    pickNext(refused);
    await expect(project.openProject()).resolves.toBe(false);
    expect(project.notice).toBe(PROJECT_MESSAGES.accessRefused);
    expect(project.status).toBe('none');
  });
});

describe('load', () => {
  it('reports progress, one transcript at a time', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1), docAt(2), docAt(3)]));
    mocks.stored = { handle: handleFor(folder), projectName: 'P' };
    const project = useProjectStore();
    const seen: string[] = [];
    watch(
      () => `${project.status} ${project.progress.done}/${project.progress.total}`,
      (v) => seen.push(v),
      { flush: 'sync' },
    );
    await project.init();
    expect(seen).toEqual([
      'loading 0/0',
      'loading 0/3',
      'loading 1/3',
      'loading 2/3',
      'loading 3/3',
      'ready 3/3',
    ]);
  });

  it('lists sessions newest recording first, with their text', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(2), docAt(5), docAt(1)]));
    const project = await readyStore(folder);
    expect(project.sessions.map((s) => s.text.recordingName)).toEqual([
      'P05 interview.m4a',
      'P02 interview.m4a',
      'P01 interview.m4a',
    ]);
    expect(project.corpus.map((s) => s.sessionId)).toEqual(
      project.sessions.map((s) => s.sessionId),
    );
    expect(project.sessions[0]!.transcriptFile).toMatchObject({
      kind: 'transcript',
      conflictCopy: false,
    });
  });

  it('keeps the newest copy of a session and lists the others as copies', async () => {
    const doc = docAt(1);
    const older = {
      ...doc,
      speakers: doc.speakers.map((s) => ({ ...s, label: `Old ${s.label}` })),
    };
    const path = transcriptPath(doc);
    const copy = path.replace('.transcript.json', '.transcript-LAPTOP-123.json');
    const folder = memoryFolder('P', {
      [PROJECT_FILE]: projectFileText(),
      [path]: transcriptFileText(older, '2026-10-01T10:00:00Z'),
      [copy]: transcriptFileText(doc, '2026-10-02T10:00:00Z'),
    });
    const project = await readyStore(folder);
    expect(project.sessions).toHaveLength(1);
    const [session] = project.sessions;
    expect(session!.transcriptFile.name).toBe(copy.slice('sessions/'.length));
    expect(session!.copies).toEqual([path.slice('sessions/'.length)]);
    expect(session!.text.speakers[0]!.label).not.toMatch(/^Old/);
  });

  it("lists files that can't be read, and loads the rest", async () => {
    const folder = memoryFolder('P', {
      ...projectFiles([docAt(1), docAt(2)]),
      'sessions/broken--1.transcript.json': '{not json',
      'sessions/cloud--2.transcript.json': transcriptFileText(docAt(3)),
    });
    folder.failOn('sessions/cloud--2.transcript.json', 'offline');
    const project = await readyStore(folder);
    expect(project.status).toBe('ready');
    expect(project.sessions).toHaveLength(2);
    expect(project.problems).toEqual([
      { file: 'broken--1.transcript.json', message: "This file isn't one DeScribe can read." },
      { file: 'cloud--2.transcript.json', message: expect.stringMatching(/offline/) },
    ]);
  });

  it('reads no unchanged transcript on a second load: the cache serves it', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1), docAt(2)]));
    await readyStore(folder);
    expect(transcriptReads(folder)).toHaveLength(2);

    setActivePinia(createPinia());
    const changed = docAt(2, {
      speakers: [{ id: 'speaker_0', label: 'Renamed' }, makeDoc().speakers[1]!],
    });
    folder.put(transcriptPath(changed), transcriptFileText(changed));
    folder.reads.length = 0;
    const project = await readyStore(folder);
    expect(project.status).toBe('ready');
    expect(transcriptReads(folder)).toEqual([transcriptPath(changed)]);
    const p2 = project.sessions.find((s) => s.sessionId === changed.id);
    expect(p2?.text.speakers[0]?.label).toBe('Renamed');
  });

  it('still loads without IndexedDB, reading every file', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    try {
      const { useProjectStore: freshStore } = await import('./project');
      const folder = memoryFolder('P', projectFiles([docAt(1), docAt(2)]));
      mocks.stored = { handle: handleFor(folder), projectName: 'P' };
      setActivePinia(createPinia());
      const project = freshStore();
      await project.init();
      expect(project.status).toBe('ready');
      expect(project.sessions).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe('refresh', () => {
  it("picks up a colleague's new session, reading only that file", async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    const project = await readyStore(folder);
    folder.reads.length = 0;
    folder.put(transcriptPath(docAt(2)), transcriptFileText(docAt(2)));
    await project.refresh();
    expect(project.sessions.map((s) => s.sessionId)).toEqual([docAt(2).id, docAt(1).id]);
    expect(transcriptReads(folder)).toEqual([transcriptPath(docAt(2))]);
  });

  it('keeps the same sessions and corpus when nothing changed', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1), docAt(2)]));
    const project = await readyStore(folder);
    const { sessions, corpus } = project;
    folder.reads.length = 0;
    await project.refresh();
    expect(project.sessions).toBe(sessions);
    expect(project.corpus).toBe(corpus);
    expect(folder.reads).toEqual([]);
  });

  it('keeps unchanged session texts when one session changes, and drops a removed one', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1), docAt(2), docAt(3)]));
    const project = await readyStore(folder);
    const textOf = (id: string) => project.corpus.find((s) => s.sessionId === id);
    const first = textOf(docAt(1).id);
    folder.put(transcriptPath(docAt(2)), transcriptFileText(docAt(2), '2026-10-05T00:00:00Z'));
    folder.remove(transcriptPath(docAt(3)));
    await project.refresh();
    expect(project.sessions.map((s) => s.sessionId)).toEqual([docAt(2).id, docAt(1).id]);
    expect(textOf(docAt(1).id)).toBe(first);
  });

  it('picks up a brief a colleague changed', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const project = await readyStore(folder);
    folder.put(PROJECT_FILE, projectFileText({ name: 'Renamed by Anna' }));
    await project.refresh();
    expect(project.projectName).toBe('Renamed by Anna');
  });

  it('is skipped while a load runs', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    mocks.stored = { handle: handleFor(folder), projectName: 'P' };
    const project = useProjectStore();
    const release = folder.hold();
    const loading = project.init();
    await vi.waitFor(() => expect(project.status).toBe('loading'));
    const lists = folder.listCount;
    await project.refresh();
    expect(folder.listCount).toBe(lists);
    release();
    await loading;
    expect(project.status).toBe('ready');
  });

  it('runs once, shortly after the window gets focus or becomes visible', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    const project = await readyStore(folder);
    vi.useFakeTimers();
    const lists = folder.listCount;
    folder.put(transcriptPath(docAt(2)), transcriptFileText(docAt(2)));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS + 10);
    vi.useRealTimers();
    await vi.waitFor(() => expect(project.sessions).toHaveLength(2));
    // One listing of sessions/ and one of chats/.
    expect(folder.listCount).toBe(lists + 2);
  });

  describe('every two minutes', () => {
    /** Real time for the rescan that a tick schedules, REFRESH_DELAY_MS later. */
    const afterTheDelay = () =>
      new Promise((resolve) => setTimeout(resolve, REFRESH_DELAY_MS + 50));

    // The interval starts with the store, so only it is faked, before the store exists; reads keep real timers.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    });

    it('rescans while the window is visible, without focus', async () => {
      const folder = memoryFolder('P', projectFiles([docAt(1)]));
      const project = await readyStore(folder);
      folder.put(transcriptPath(docAt(2)), transcriptFileText(docAt(2)));
      vi.advanceTimersByTime(RESCAN_INTERVAL_MS - 1);
      await afterTheDelay();
      expect(project.sessions).toHaveLength(1);
      vi.advanceTimersByTime(1);
      await vi.waitFor(() => expect(project.sessions).toHaveLength(2));
    });

    it('ticks only while a project is open', async () => {
      const folder = memoryFolder('P', projectFiles([docAt(1)]));
      const project = useProjectStore();
      expect(project.status).toBe('none');
      expect(vi.getTimerCount()).toBe(0);
      await readyStore(folder);
      expect(vi.getTimerCount()).toBe(1);
      folder.failAll('permission');
      await project.refresh();
      expect(project.status).toBe('reconnect');
      expect(vi.getTimerCount()).toBe(0);
    });

    it("doesn't rescan while the window is hidden", async () => {
      const folder = memoryFolder('P', projectFiles([docAt(1)]));
      await readyStore(folder);
      const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      try {
        const lists = folder.listCount;
        vi.advanceTimersByTime(RESCAN_INTERVAL_MS * 2);
        await afterTheDelay();
        expect(folder.listCount).toBe(lists);
      } finally {
        hidden.mockRestore();
      }
    });
  });

  it('switches to reconnect when access has ended', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    const project = await readyStore(folder);
    folder.failAll('permission');
    await project.refresh();
    expect(project.status).toBe('reconnect');
  });
});

describe('the brief', () => {
  it('saves the name and the brief with trimmed lines, and remembers the new name', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const project = await readyStore(folder);
    const result = await project.saveBrief(
      '  Hearing 2027 ',
      {
        researchQuestions: [' How do people charge? ', '', 'Who helps?'],
        context: '  Home visits. ',
        metadataFields: ['Age', '  ', 'Country '],
      },
      project.projectStat!,
    );
    expect(result).toEqual({ ok: true });
    const saved = JSON.parse(folder.text(PROJECT_FILE)!) as Record<string, unknown>;
    expect(saved).toMatchObject({
      id: TEST_PROJECT_ID,
      name: 'Hearing 2027',
      brief: {
        researchQuestions: ['How do people charge?', 'Who helps?'],
        context: 'Home visits.',
        metadataFields: ['Age', 'Country'],
      },
    });
    expect(project.projectName).toBe('Hearing 2027');
    expect(mocks.stored?.projectName).toBe('Hearing 2027');
    expect(project.projectStat).toEqual(await folder.stat(PROJECT_FILE));
  });

  it('keeps fields a newer build added to the project file and its brief (D38)', async () => {
    const folder = memoryFolder(
      'P',
      projectFiles([], { ...FUTURE_FIELD, brief: { ...TEST_BRIEF, ...FUTURE_FIELD } }),
    );
    const project = await readyStore(folder);
    const result = await project.saveBrief('Hearing 2027', TEST_BRIEF, project.projectStat!);
    expect(result).toEqual({ ok: true });
    expect(JSON.parse(folder.text(PROJECT_FILE)!)).toMatchObject({
      ...FUTURE_FIELD,
      name: 'Hearing 2027',
      brief: { ...TEST_BRIEF, ...FUTURE_FIELD },
    });
  });

  it("never overwrites a colleague's brief: it reports the conflict, and Reload gets theirs", async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const project = await readyStore(folder);
    const base = project.projectStat!;
    const theirs = projectFileText({
      brief: { researchQuestions: ['Theirs?'], context: '', metadataFields: [] },
    });
    folder.put(PROJECT_FILE, theirs);

    const mine = { researchQuestions: ['Mine?'], context: '', metadataFields: [] };
    await expect(project.saveBrief('P', mine, base)).resolves.toEqual({
      ok: false,
      reason: 'changed',
      message: PROJECT_MESSAGES.briefChanged,
    });
    expect(folder.text(PROJECT_FILE)).toBe(theirs);

    const reloaded = await project.reloadProject();
    expect(project.project?.brief.researchQuestions).toEqual(['Theirs?']);
    await expect(project.saveBrief('P', mine, reloaded!)).resolves.toEqual({ ok: true });
  });

  it('checks against the stat when editing started, even after a refresh read the new file', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const project = await readyStore(folder);
    const base = project.projectStat!;
    folder.put(PROJECT_FILE, projectFileText({ name: 'Theirs' }));
    await project.refresh();
    const result = await project.saveBrief('Mine', makeProjectFile().brief, base);
    expect(result).toMatchObject({ ok: false, reason: 'changed' });
  });
});

describe('search', () => {
  async function corpusStore() {
    const { docs, planted } = makeCorpus({ hours: 30, seed: 7 });
    const folder = memoryFolder('P', projectFiles(docs));
    return { project: await readyStore(folder), docs, planted };
  }

  it('finds the planted phrases across sessions, in English and in the original text', async () => {
    const { project, planted } = await corpusStore();
    expect(planted.some((p) => p.field === 'english')).toBe(true);
    expect(planted.some((p) => p.field === 'original')).toBe(true);
    for (const plant of planted) {
      const outcome = project.search(`"${plant.phrase}"`);
      expect(outcome.kind).toBe('result');
      if (outcome.kind !== 'result') continue;
      const session = outcome.result.sessions.find((s) => s.sessionId === plant.sessionId);
      expect(
        session?.hits.map((h) => h.turnId),
        plant.phrase,
      ).toContain(plant.turnId);
      expect(session?.hits.find((h) => h.turnId === plant.turnId)?.field).toBe(plant.field);
    }
  });

  it("gives a bad query's message", async () => {
    const { project } = await corpusStore();
    expect(project.search('"charger')).toEqual({
      kind: 'error',
      message: 'Close the quotation marks.',
    });
  });

  it('pages by sessions, at most 4 hits each', async () => {
    const { project } = await corpusStore();
    const first = project.search('the OR die OR le');
    if (first.kind !== 'result') throw new Error('expected a result');
    expect(SEARCH_HITS_PER_SESSION).toBe(4);
    expect(first.result.sessions.length).toBeLessThanOrEqual(SEARCH_PAGE_SESSIONS);
    expect(first.result.sessions.every((s) => s.hits.length <= SEARCH_HITS_PER_SESSION)).toBe(true);
    if (first.result.nextOffset !== null) {
      const next = project.search('the OR die OR le', first.result.nextOffset);
      if (next.kind !== 'result') throw new Error('expected a result');
      expect(next.result.sessions[0]?.sessionId).not.toBe(first.result.sessions[0]?.sessionId);
    }
  });

  it("lists every hit in one session, starting with the page's", async () => {
    const { project } = await corpusStore();
    const page = project.search('the OR die OR le');
    if (page.kind !== 'result') throw new Error('expected a result');
    const listed = page.result.sessions[0]!;
    expect(listed.hitCount).toBeGreaterThan(SEARCH_HITS_PER_SESSION);
    const all = project.searchSession('the OR die OR le', listed.sessionId);
    expect(all?.sessionId).toBe(listed.sessionId);
    expect(all?.hits).toHaveLength(listed.hitCount);
    expect(all?.hits.slice(0, listed.hits.length)).toEqual(listed.hits);
  });

  it('lists no hits in one session for a bad query, or one that no longer finds it', async () => {
    const { project, docs } = await corpusStore();
    expect(project.searchSession('"charger', docs[0]!.id)).toBeNull();
    expect(project.searchSession('zzzzqqq', docs[0]!.id)).toBeNull();
  });

  it('copies the whole English turn with its citation, saying when it was translated', async () => {
    const translated = withTranslation(docAt(1));
    const english = docAt(2, {
      result: { ...makeDoc().result, languageCode: 'eng' },
    });
    const folder = memoryFolder('P', projectFiles([translated, english]));
    const project = await readyStore(folder);
    const turn = translated.turns[0]!;
    const citation = project.citationFor(translated.id, turn.id);
    expect(citation).toBe(
      `"${translated.translations.en!.texts[turn.id]}" — ${translated.speakers[0]!.label}, 00:00:00, ` +
        'P01 interview.m4a (translated from German)',
    );
    const englishTurn = english.turns[1]!;
    expect(project.citationFor(english.id, englishTurn.id)).toMatch(
      new RegExp(`^".+" — .+, 00:00:\\d\\d, P02 interview\\.m4a$`),
    );
    expect(project.citationFor(english.id, 'nope')).toBeNull();
  });

  it('copies the original text of a session that has no translation', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    const project = await readyStore(folder);
    const turn = docAt(1).turns[2]!;
    expect(project.citationFor(docAt(1).id, turn.id)).toContain(
      `"${turn.text.replace(/\s+/g, ' ').trim()}"`,
    );
    expect(project.citationFor(docAt(1).id, turn.id)).not.toContain('translated');
  });
});

describe('recent projects', () => {
  const B_ID = '99999999-0000-4000-8000-000000000000';
  const A = { id: TEST_PROJECT_ID, name: 'Hearing at home 2026' };
  const B = { id: B_ID, name: 'B' };
  const folderA = () => memoryFolder('A', projectFiles([docAt(1), docAt(2)]));
  const folderB = () => memoryFolder('B', projectFiles([docAt(3)], { id: B_ID, name: 'B' }));

  /** A open, with B in the recent list. */
  async function aOpenWithB(a = folderA(), b = folderB()) {
    mocks.recent = [recentEntry(a, A.id, A.name), recentEntry(b, B.id, B.name)];
    return { project: await readyStore(a), a, b };
  }

  it('lists each project opened, newest first, and saves the list', async () => {
    const a = folderA();
    const b = folderB();
    const project = useProjectStore();
    await project.init();
    expect(project.recentProjects).toEqual([]);
    pickNext(a);
    await project.openProject();
    pickNext(b);
    await project.openProject();
    expect(project.recentProjects).toEqual([B, A]);
    expect(mocks.recent.map((r) => r.projectId)).toEqual([B.id, A.id]);
  });

  it('adds a folder remembered before there was a list, once it has loaded', async () => {
    const project = await readyStore(folderA());
    expect(project.recentProjects).toEqual([A]);
  });

  it('adds nothing until a remembered folder has access', async () => {
    rememberFolder(folderA(), 'prompt');
    const project = useProjectStore();
    await project.init();
    expect(project.status).toBe('reconnect');
    expect(project.recentProjects).toEqual([]);
  });

  it('saves only when the list changes', async () => {
    const { project, a } = await aOpenWithB();
    expect(mocks.recentSaves).toBe(0);
    await project.refresh();
    expect(mocks.recentSaves).toBe(0);

    // A colleague renames the project.
    a.put(PROJECT_FILE, projectFileText({ name: 'Renamed' }));
    await project.refresh();
    expect(project.recentProjects).toEqual([{ id: A.id, name: 'Renamed' }, B]);
    expect(mocks.recentSaves).toBe(1);
  });

  it('takes the new name when the brief is saved', async () => {
    const { project } = await aOpenWithB();
    await project.saveBrief('Better name', TEST_BRIEF, project.projectStat!);
    expect(project.recentProjects[0]).toEqual({ id: A.id, name: 'Better name' });
    expect(mocks.recent[0]?.projectName).toBe('Better name');
  });

  it(`keeps the ${MAX_RECENT_PROJECTS} most recent`, async () => {
    mocks.recent = Array.from({ length: MAX_RECENT_PROJECTS }, (_, i) =>
      recentEntry(memoryFolder(`F${i}`), `id-${i}`, `P${i}`),
    );
    const project = await readyStore(folderA());
    expect(project.recentProjects).toHaveLength(MAX_RECENT_PROJECTS);
    expect(project.recentProjects[0]).toEqual(A);
    expect(project.recentProjects.at(-1)?.id).toBe(`id-${MAX_RECENT_PROJECTS - 2}`);
  });

  it('takes the new handle when a project is opened from another folder', async () => {
    const { project } = await aOpenWithB();
    const moved = folderA();
    pickNext(moved);
    await project.openProject();
    expect(project.recentProjects).toEqual([A, B]);
    expect((mocks.recent[0]?.handle as unknown as { folder: MemoryFolder }).folder).toBe(moved);
  });

  it('opens a recent project: it moves to the front and is remembered', async () => {
    const { project } = await aOpenWithB();
    await expect(project.openRecent(B.id)).resolves.toBe(true);
    expect(mocks.requests).toBe(1);
    expect(project.status).toBe('ready');
    expect(project.project?.id).toBe(B.id);
    expect(project.sessions.map((s) => s.sessionId)).toEqual([docAt(3).id]);
    expect(project.recentProjects).toEqual([B, A]);
    expect(mocks.stored).toMatchObject({ projectName: 'B' });
  });

  it('keeps the open project when access to a recent one is refused', async () => {
    const { project } = await aOpenWithB();
    mocks.grantOnRequest = false;
    await expect(project.openRecent(B.id)).resolves.toBe(false);
    expect(project.notice).toBe(PROJECT_MESSAGES.accessRefused);
    expect(project.status).toBe('ready');
    expect(project.project?.id).toBe(A.id);
    expect(project.sessions).toHaveLength(2);
    expect(project.recentProjects).toEqual([A, B]);
    expect(mocks.stored).toMatchObject({ projectName: 'Remembered' });
  });

  it('drops a recent project whose folder is gone, and keeps the open one', async () => {
    const { project } = await aOpenWithB(folderA(), memoryFolder('Emptied'));
    await expect(project.openRecent(B.id)).resolves.toBe(false);
    expect(project.notice).toBe(PROJECT_MESSAGES.projectGone('B'));
    expect(project.status).toBe('ready');
    expect(project.project?.id).toBe(A.id);
    expect(project.recentProjects).toEqual([A]);
    expect(mocks.recent.map((r) => r.projectId)).toEqual([A.id]);
  });

  it('keeps a recent project it can only not read for now', async () => {
    const b = folderB();
    b.failOn(PROJECT_FILE, 'invalid');
    const { project } = await aOpenWithB(folderA(), b);
    await expect(project.openRecent(B.id)).resolves.toBe(false);
    expect(project.notice).toBe(PROJECT_MESSAGES.projectFileInvalid);
    expect(project.project?.id).toBe(A.id);
    expect(project.recentProjects).toEqual([A, B]);
  });

  it('does nothing for a project that is not in the list', async () => {
    const { project } = await aOpenWithB();
    await expect(project.openRecent('nope')).resolves.toBe(false);
    expect(mocks.requests).toBe(0);
  });

  it('forgets the list with the saved data', async () => {
    const { project } = await aOpenWithB();
    await project.forget();
    expect(project.recentProjects).toEqual([]);
    expect(mocks.recent).toEqual([]);
  });
});

describe('forget', () => {
  it('forgets the folder and the cache, and leaves the files alone', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    const project = await readyStore(folder);
    const before = folder.paths();
    await project.forget();
    expect(project.status).toBe('none');
    expect(project.projectName).toBeNull();
    expect(project.sessions).toEqual([]);
    expect(mocks.stored).toBeNull();
    expect(folder.paths()).toEqual(before);

    // The cache is empty: opening the project again reads every transcript.
    folder.reads.length = 0;
    setActivePinia(createPinia());
    await readyStore(folder);
    expect(transcriptReads(folder)).toHaveLength(1);
  });
});

describe('summaries', () => {
  const english = (n: number) => withTranslation(docAt(n));

  it('loads each session with its summary, title and status', async () => {
    const summarised = english(1);
    const folder = memoryFolder('P', {
      ...projectFiles([summarised, docAt(2)]),
      [summaryPath(summarised)]: summaryFileText(summarised),
    });
    const project = await readyStore(folder);
    const [p2, p1] = project.sessions;
    expect(p1).toMatchObject({
      title: 'Summary of P01 interview.m4a',
      status: 'ok',
      summaryFile: { kind: 'summary', conflictCopy: false },
    });
    expect(p1!.summary?.summary.themes[0]!.quotes.length).toBeGreaterThan(0);
    expect(p2).toMatchObject({
      title: 'P02 interview.m4a',
      status: 'none',
      summary: null,
      summaryFile: null,
    });
    expect(project.sessionTitle(summarised.id)).toBe('Summary of P01 interview.m4a');
    expect(project.citationFor(summarised.id, 't2')).toContain('Summary of P01 interview.m4a');
  });

  it('marks a summary out of date when the transcript changed since', async () => {
    const doc = english(1);
    const folder = memoryFolder('P', {
      ...projectFiles([doc]),
      [summaryPath(doc)]: summaryFileText(doc, { transcriptHash: 'older text' }),
    });
    const project = await readyStore(folder);
    expect(project.sessions[0]!.status).toBe('stale');
  });

  it('marks every summary out of date when the brief changes', async () => {
    const [a, b] = [english(1), english(2)];
    const folder = memoryFolder('P', {
      ...projectFiles([a, b]),
      [summaryPath(a)]: summaryFileText(a),
      [summaryPath(b)]: summaryFileText(b),
    });
    const project = await readyStore(folder);
    expect(project.sessions.map((s) => s.status)).toEqual(['ok', 'ok']);
    const saved = await project.saveBrief('P', TEST_BRIEF, project.projectStat!);
    expect(saved).toEqual({ ok: true });
    expect(project.sessions.map((s) => s.status)).toEqual(['stale', 'stale']);
  });

  it('is up to date when it was made with the current brief', async () => {
    const doc = english(1);
    const folder = memoryFolder('P', {
      ...projectFiles([doc], { brief: TEST_BRIEF }),
      [summaryPath(doc)]: summaryFileText(doc, {}, TEST_BRIEF),
    });
    const project = await readyStore(folder);
    expect(project.sessions[0]!.status).toBe('ok');
  });

  it('keeps the newest summary, lists the other as a copy, and reports an invalid one', async () => {
    const [a, b] = [english(1), english(2)];
    const copy = summaryPath(a).replace('.summary.json', '.summary-LAPTOP-123.json');
    const folder = memoryFolder('P', {
      ...projectFiles([a, b]),
      [summaryPath(a)]: summaryFileText(a, { createdAt: '2026-10-15T10:00:00.000Z' }),
      [copy]: summaryFileText(a, {
        createdAt: '2026-10-16T10:00:00.000Z',
        summary: { ...makeSummaryFile(a).summary, title: 'Newer' },
      }),
      [summaryPath(b)]: '{"kind":"describe.summary"}',
    });
    const project = await readyStore(folder);
    const p1 = project.sessions.find((s) => s.sessionId === a.id)!;
    expect(p1.title).toBe('Newer');
    expect(p1.summaryFile?.name).toBe(copy.slice('sessions/'.length));
    expect(p1.copies).toEqual([summaryPath(a).slice('sessions/'.length)]);
    expect(project.sessions.find((s) => s.sessionId === b.id)!.status).toBe('none');
    expect(project.problems).toEqual([
      {
        file: summaryPath(b).slice('sessions/'.length),
        message: "This file isn't one DeScribe can read.",
      },
    ]);
  });

  it('refresh reads only a new or changed summary', async () => {
    const [a, b] = [english(1), english(2)];
    const folder = memoryFolder('P', {
      ...projectFiles([a, b]),
      [summaryPath(a)]: summaryFileText(a),
    });
    const project = await readyStore(folder);
    folder.reads.length = 0;
    folder.put(summaryPath(b), summaryFileText(b));
    await project.refresh();
    expect(folder.reads).toEqual([summaryPath(b)]);
    expect(project.sessions.map((s) => s.status)).toEqual(['ok', 'ok']);
  });

  it('counts the themes across summaries, and can leave one session out', async () => {
    const [a, b] = [english(1), english(2)];
    const theme = (name: string) => ({
      name,
      description: 'd',
      turnIds: [],
      isNew: false,
      quotes: [],
    });
    const withThemes = (doc: TranscriptDoc, names: string[]) =>
      summaryFileText(doc, {
        summary: { ...makeSummaryFile(doc).summary, themes: names.map(theme) },
      });
    const folder = memoryFolder('P', {
      ...projectFiles([a, b]),
      [summaryPath(a)]: withThemes(a, ['charging routines', 'stigma']),
      [summaryPath(b)]: withThemes(b, ['Charging routines']),
    });
    const project = await readyStore(folder);
    // Merged across spellings (themes.ts picks the spelling).
    expect(project.themeVocabulary).toEqual([
      { name: expect.stringMatching(/^charging routines$/i), count: 2 },
      { name: 'stigma', count: 1 },
    ]);
    expect(project.themesExcept(a.id)).toEqual([{ name: 'Charging routines', count: 1 }]);
  });
});

describe('session files', () => {
  it('adds a session, lists it at once without reading it back, and refuses one that exists', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    const project = await readyStore(folder);
    folder.reads.length = 0;
    const doc = withTranslation(docAt(2));
    const { name, stat } = await project.addSessionTranscript(doc);
    expect(`sessions/${name}`).toBe(transcriptPath(doc));
    expect(stat).toEqual(await folder.stat(transcriptPath(doc)));
    expect(project.sessions.map((s) => s.sessionId)).toEqual([doc.id, docAt(1).id]);
    expect(project.sessions[0]).toMatchObject({ status: 'none', transcriptFile: { name, stat } });
    expect(folder.reads).toEqual([]);

    // Nothing to read on the next rescan either.
    await project.refresh();
    expect(transcriptReads(folder)).toEqual([]);

    await expect(project.addSessionTranscript(doc)).rejects.toMatchObject({ kind: 'changed' });
  });

  it('saves a transcript with the change check, or overwrites it for Keep mine', async () => {
    const doc = withTranslation(docAt(1));
    const folder = memoryFolder('P', {
      ...projectFiles([doc]),
      [summaryPath(doc)]: summaryFileText(doc),
    });
    const project = await readyStore(folder);
    const file = project.sessions[0]!.transcriptFile;
    const edited = {
      ...doc,
      speakers: doc.speakers.map((s, i) => (i === 0 ? { ...s, label: 'Interviewer' } : s)),
    };
    const stat = await project.saveSessionTranscript(edited, file.name, file.stat);
    expect(project.sessions[0]).toMatchObject({ status: 'stale', transcriptFile: { stat } });
    expect(project.speakerLabel(doc.id, 'speaker_0')).toBe('Interviewer');

    // Someone else wrote the file since.
    folder.put(`sessions/${file.name}`, transcriptFileText(doc));
    await expect(project.saveSessionTranscript(edited, file.name, stat)).rejects.toMatchObject({
      kind: 'changed',
    });
    await expect(project.saveSessionTranscript(edited, file.name)).resolves.toMatchObject({
      size: expect.any(Number),
    });
    expect(JSON.parse(folder.text(`sessions/${file.name}`)!).doc.speakers[0].label).toBe(
      'Interviewer',
    );
  });

  it('writes a summary next to its transcript, and the session is up to date', async () => {
    const doc = withTranslation(docAt(1));
    const folder = memoryFolder('P', projectFiles([doc]));
    const project = await readyStore(folder);
    await project.saveSessionSummary(doc.id, makeSummaryFile(doc));
    expect(folder.text(summaryPath(doc))).toBeDefined();
    expect(project.sessions[0]).toMatchObject({
      status: 'ok',
      title: 'Summary of P01 interview.m4a',
    });
  });

  it('reads a session in full, word timings included', async () => {
    const doc = docAt(1);
    const project = await readyStore(memoryFolder('P', projectFiles([doc])));
    const read = await project.readSessionDoc(doc.id);
    expect(read.doc).toEqual(doc);
    expect(read.name).toBe(transcriptPath(doc).slice('sessions/'.length));
    await expect(project.readSessionDoc('nobody')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('refuses to write until access is granted again, and notices access ending', async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    rememberFolder(folder, 'prompt');
    const waiting = useProjectStore();
    await waiting.init();
    await expect(waiting.addSessionTranscript(docAt(2))).rejects.toMatchObject({
      kind: 'permission',
    });

    setActivePinia(createPinia());
    const project = await readyStore(folder);
    folder.failAll('permission');
    await expect(project.addSessionTranscript(docAt(2))).rejects.toMatchObject({
      kind: 'permission',
    });
    expect(project.status).toBe('reconnect');
  });

  it("doesn't let a rescan that started before a write drop the new session", async () => {
    const folder = memoryFolder('P', projectFiles([docAt(1)]));
    const project = await readyStore(folder);
    folder.put(transcriptPath(docAt(3)), transcriptFileText(docAt(3)));
    const release = folder.hold();
    const refreshing = project.refresh();
    await vi.waitFor(() => expect(folder.listCount).toBeGreaterThan(1));
    // The rescan listed the folder before this write, and is reading the colleague's file.
    await project.addSessionTranscript(docAt(2));
    release();
    await refreshing;
    expect(project.sessions.map((s) => s.sessionId)).toContain(docAt(2).id);
    // The rescan runs again shortly, and then finds the colleague's session too.
    await vi.waitFor(() => expect(project.sessions.map((s) => s.sessionId)).toContain(docAt(3).id));
  });
});

describe('chats', () => {
  const chat = (n: number, overrides: Partial<ChatFile> = {}) =>
    makeChatFile({
      id: `c000000${n}-0000-4000-8000-000000000000`,
      title: `Chat ${n}`,
      createdAt: `2026-10-2${n}T09:00:00.000Z`,
      updatedAt: `2026-10-2${n}T10:00:00.000Z`,
      ...overrides,
    });
  const chatSeed = (...files: ChatFile[]) =>
    Object.fromEntries(files.map((file) => [chatPath(file), chatFileText(file)]));
  const titles = (project: ReturnType<typeof useProjectStore>) =>
    project.chats.map((c) => c.file.title);

  it('loads the saved chats after the sessions, newest activity first', async () => {
    const folder = memoryFolder('P', {
      ...projectFiles([docAt(1)]),
      // Chat 1 started first but was added to last.
      ...chatSeed(chat(1, { updatedAt: '2026-10-25T08:00:00.000Z' }), chat(2), chat(3)),
    });
    const project = await readyStore(folder);
    expect(project.chatsLoaded).toBe(true);
    expect(titles(project)).toEqual(['Chat 1', 'Chat 3', 'Chat 2']);
    expect(project.chats[0]!.name).toBe(chatPath(chat(1)).slice('chats/'.length));
    expect(project.chatProblems).toEqual([]);
  });

  it('has none, loaded, for a project without a chats folder', async () => {
    const project = await readyStore(memoryFolder('P', projectFiles([docAt(1)])));
    expect(project.chats).toEqual([]);
    expect(project.chatsLoaded).toBe(true);
  });

  it("keeps a chat's newest copy, and reports a file that can't be read", async () => {
    const older = chat(1);
    const newer = chat(1, { updatedAt: '2026-10-26T10:00:00.000Z', title: 'Newer copy' });
    const folder = memoryFolder('P', {
      ...projectFiles([]),
      [chatPath(older)]: chatFileText(older),
      [chatPath(older).replace('.chat.json', '.chat-LAPTOP-1.json')]: chatFileText(newer),
      'chats/broken.chat.json': '{',
    });
    const project = await readyStore(folder);
    expect(titles(project)).toEqual(['Newer copy']);
    expect(project.chatProblems).toEqual([
      { file: 'broken.chat.json', message: expect.any(String) },
    ]);
  });

  it("picks up a colleague's new or longer chat on refresh, reading only that file", async () => {
    const folder = memoryFolder('P', { ...projectFiles([]), ...chatSeed(chat(1), chat(2)) });
    const project = await readyStore(folder);
    const before = project.chats;
    await project.refresh();
    expect(project.chats).toBe(before);

    folder.reads.length = 0;
    folder.put(chatPath(chat(3)), chatFileText(chat(3)));
    folder.put(chatPath(chat(1)), chatFileText(chat(1, { updatedAt: '2026-10-29T10:00:00Z' })));
    await project.refresh();
    expect(titles(project)).toEqual(['Chat 1', 'Chat 3', 'Chat 2']);
    expect(folder.reads.filter((p) => p.startsWith('chats/')).sort()).toEqual(
      [chatPath(chat(1)), chatPath(chat(3))].sort(),
    );
  });

  it('saves a chat, lists it at once, and checks the file is as it was saved', async () => {
    const folder = memoryFolder('P', { ...projectFiles([]), ...chatSeed(chat(1)) });
    const project = await readyStore(folder);
    const saved = await project.saveChat(chat(2, { updatedAt: '2026-10-28T10:00:00.000Z' }), null);
    expect(titles(project)).toEqual(['Chat 2', 'Chat 1']);
    expect(folder.text(chatPath(chat(2)))).toBe(chatFileText(saved.file));
    expect(saved.stat).toEqual(await folder.stat(chatPath(chat(2))));

    const longer = chat(2, { updatedAt: '2026-10-29T10:00:00.000Z' });
    const again = await project.saveChat(longer, saved.stat);
    expect(again.name).toBe(saved.name);
    await expect(project.saveChat(longer, saved.stat)).rejects.toMatchObject({ kind: 'changed' });

    // Describe's own write is known: a refresh doesn't read it back.
    folder.reads.length = 0;
    await project.refresh();
    expect(folder.reads.filter((p) => p.startsWith('chats/'))).toEqual([]);
  });

  it('refuses to save until access is granted again', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const project = await readyStore(folder);
    folder.failAll('permission');
    await expect(project.saveChat(chat(1), null)).rejects.toMatchObject({ kind: 'permission' });
    expect(project.status).toBe('reconnect');
  });

  it('forgets the chats with the project, and drops them for another project', async () => {
    const folder = memoryFolder('P', { ...projectFiles([]), ...chatSeed(chat(1)) });
    const project = await readyStore(folder);
    await project.forget();
    expect(project.chats).toEqual([]);
    expect(project.chatsLoaded).toBe(false);

    const other = memoryFolder('Q', projectFiles([], { id: 'another-project' }));
    pickNext(other);
    await project.openProject();
    expect(project.chats).toEqual([]);
  });
});
