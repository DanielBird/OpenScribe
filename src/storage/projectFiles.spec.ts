import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_FILE } from '../domain/sessionFiles';
import { memoryFolder } from '../testing/memoryFolder';
import {
  FUTURE_FIELD,
  makeProjectFile,
  makeSummaryFile,
  projectFileText,
  summaryPath,
  TEST_BRIEF,
  transcriptFileText,
  transcriptPath,
} from '../testing/projectSeed';
import { makeDoc, withFutureFields, withTranslation } from '../testing/transcriptDoc';
import {
  createProject,
  listSessionFiles,
  readProject,
  readSummaryFile,
  readTranscriptFile,
  sameStat,
  writeProject,
  writeSummaryFile,
  writeTranscriptFile,
} from './projectFiles';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the project file', () => {
  it('creates a project with the given name, an id and an empty brief', async () => {
    const folder = memoryFolder('Hearing at home');
    const { project, stat } = await createProject(folder, 'Hearing at home');
    expect(project).toMatchObject({
      kind: 'describe.project',
      schemaVersion: 1,
      name: 'Hearing at home',
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z',
      brief: { researchQuestions: [], context: '', metadataFields: [] },
    });
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await folder.stat(PROJECT_FILE)).toEqual(stat);
    await expect(readProject(folder)).resolves.toEqual({ project, stat });
  });

  it('refuses to create a project where there is one already', async () => {
    const folder = memoryFolder('P', { [PROJECT_FILE]: projectFileText() });
    await expect(createProject(folder, 'P')).rejects.toMatchObject({ kind: 'changed' });
    expect(folder.writes).toEqual([]);
  });

  it('opens an existing project', async () => {
    const folder = memoryFolder('P', { [PROJECT_FILE]: projectFileText({ brief: TEST_BRIEF }) });
    const { project } = await readProject(folder);
    expect(project).toEqual(makeProjectFile({ brief: TEST_BRIEF }));
  });

  it('reports a folder without a project file as not_found', async () => {
    await expect(readProject(memoryFolder())).rejects.toMatchObject({ kind: 'not_found' });
  });

  it.each([
    ['not JSON', '{nope'],
    ['another kind', JSON.stringify({ ...makeProjectFile(), kind: 'describe.summary' })],
    ['a newer schema', JSON.stringify({ ...makeProjectFile(), schemaVersion: 2 })],
    ['a brief without questions', JSON.stringify({ ...makeProjectFile(), brief: { context: '' } })],
  ])('reports %s as invalid, naming the file', async (_name, text) => {
    const folder = memoryFolder('P', { [PROJECT_FILE]: text });
    await expect(readProject(folder)).rejects.toMatchObject({
      kind: 'invalid',
      path: PROJECT_FILE,
    });
  });

  it('writes the project when the file is unchanged', async () => {
    const folder = memoryFolder('P', { [PROJECT_FILE]: projectFileText() });
    const { project, stat } = await readProject(folder);
    const next = { ...project, name: 'Renamed', brief: TEST_BRIEF };
    const newStat = await writeProject(folder, next, stat);
    expect(sameStat(newStat, stat)).toBe(false);
    await expect(readProject(folder)).resolves.toEqual({ project: next, stat: newStat });
  });

  it('keeps fields a newer build added, in the file and its brief, and writes them back (D38)', async () => {
    const future = {
      ...makeProjectFile({ brief: { ...TEST_BRIEF, ...FUTURE_FIELD } }),
      ...FUTURE_FIELD,
    };
    const folder = memoryFolder('P', { [PROJECT_FILE]: JSON.stringify(future) });
    const { project, stat } = await readProject(folder);
    expect(project).toEqual(future);
    await writeProject(folder, { ...project, name: 'Renamed' }, stat);
    expect(JSON.parse(folder.text(PROJECT_FILE)!)).toEqual({ ...future, name: 'Renamed' });
  });

  it('refuses to overwrite a project file someone else changed', async () => {
    const folder = memoryFolder('P', { [PROJECT_FILE]: projectFileText() });
    const { project, stat } = await readProject(folder);
    folder.put(PROJECT_FILE, projectFileText({ name: 'Theirs' }));
    await expect(writeProject(folder, project, stat)).rejects.toMatchObject({
      kind: 'changed',
      path: PROJECT_FILE,
    });
    expect((await readProject(folder)).project.name).toBe('Theirs');
  });

  it('refuses when the project file was deleted', async () => {
    const folder = memoryFolder('P', { [PROJECT_FILE]: projectFileText() });
    const { project, stat } = await readProject(folder);
    folder.remove(PROJECT_FILE);
    await expect(writeProject(folder, project, stat)).rejects.toMatchObject({ kind: 'changed' });
  });
});

describe('session files', () => {
  it('lists transcripts, summaries and conflict copies, with their stats, and ignores the rest', async () => {
    const folder = memoryFolder('P', {
      [PROJECT_FILE]: projectFileText(),
      'sessions/b--22222222.transcript.json': '{}',
      'sessions/a--11111111.summary.json': '{}',
      'sessions/a--11111111.transcript-LAPTOP-123.json': '{}',
      'sessions/a--11111111.transcript.json.crswap': '',
      'sessions/notes.txt': 'x',
      'sessions/old/c--33333333.transcript.json': '{}',
    });
    const files = await listSessionFiles(folder);
    expect(
      files.map(({ name, kind, base, conflictCopy }) => ({ name, kind, base, conflictCopy })),
    ).toEqual([
      {
        name: 'a--11111111.summary.json',
        kind: 'summary',
        base: 'a--11111111',
        conflictCopy: false,
      },
      {
        name: 'a--11111111.transcript-LAPTOP-123.json',
        kind: 'transcript',
        base: 'a--11111111',
        conflictCopy: true,
      },
      {
        name: 'b--22222222.transcript.json',
        kind: 'transcript',
        base: 'b--22222222',
        conflictCopy: false,
      },
    ]);
    expect(files[0]!.stat).toEqual(await folder.stat('sessions/a--11111111.summary.json'));
  });

  it('has no session files before sessions/ exists', async () => {
    await expect(listSessionFiles(memoryFolder('P', { [PROJECT_FILE]: '{}' }))).resolves.toEqual(
      [],
    );
  });

  it('passes on a lost permission while listing', async () => {
    const folder = memoryFolder('P', { 'sessions/a--1.transcript.json': '{}' });
    folder.failAll('permission');
    await expect(listSessionFiles(folder)).rejects.toMatchObject({ kind: 'permission' });
  });

  it('round-trips a transcript file, translation included', async () => {
    const folder = memoryFolder();
    const doc = withTranslation(makeDoc());
    const { name, stat } = await writeTranscriptFile(folder, doc);
    expect(name).toBe('interview--00000000.transcript.json');
    const read = await readTranscriptFile(folder, name);
    expect(read.stat).toEqual(stat);
    expect(read.file).toEqual({
      kind: 'describe.transcript',
      schemaVersion: 1,
      savedAt: '2026-10-20T10:00:00.000Z',
      doc,
    });
  });

  it('writes under a given name', async () => {
    const folder = memoryFolder();
    const { name } = await writeTranscriptFile(folder, makeDoc(), { name: 'kept.transcript.json' });
    expect(name).toBe('kept.transcript.json');
    expect(folder.paths()).toEqual(['sessions/kept.transcript.json']);
  });

  it('reads files the seed builder makes', async () => {
    const doc = makeDoc();
    const folder = memoryFolder('P', {
      [transcriptPath(doc)]: transcriptFileText(doc, '2026-10-02T00:00:00Z'),
    });
    const { file } = await readTranscriptFile(
      folder,
      transcriptPath(doc).slice('sessions/'.length),
    );
    expect(file.savedAt).toBe('2026-10-02T00:00:00Z');
    expect(file.doc).toEqual(doc);
  });

  it('keeps fields a newer build added to the doc, and writes them back (D38)', async () => {
    const doc = withFutureFields(withTranslation(makeDoc()));
    const path = transcriptPath(doc);
    const name = path.slice('sessions/'.length);
    const folder = memoryFolder('P', { [path]: transcriptFileText(doc) });
    const read = await readTranscriptFile(folder, name);
    expect(read.file.doc).toEqual(doc);
    await writeTranscriptFile(folder, read.file.doc, { name, expected: read.stat });
    expect((JSON.parse(folder.text(path)!) as { doc: unknown }).doc).toEqual(doc);
  });

  it.each([
    ['not JSON', '{'],
    ['a summary file', JSON.stringify({ kind: 'describe.summary', schemaVersion: 1 })],
    [
      'a damaged doc',
      JSON.stringify({
        kind: 'describe.transcript',
        schemaVersion: 1,
        savedAt: 'x',
        doc: { id: 1 },
      }),
    ],
  ])('reports a transcript file with %s as invalid', async (_name, text) => {
    const folder = memoryFolder('P', { 'sessions/x--1.transcript.json': text });
    await expect(readTranscriptFile(folder, 'x--1.transcript.json')).rejects.toMatchObject({
      kind: 'invalid',
      path: 'sessions/x--1.transcript.json',
    });
  });

  describe('the expected check', () => {
    it('writes when expected is null and the file is new, and refuses when it exists', async () => {
      const folder = memoryFolder();
      const { name } = await writeTranscriptFile(folder, makeDoc(), { expected: null });
      await expect(
        writeTranscriptFile(folder, makeDoc(), { name, expected: null }),
      ).rejects.toMatchObject({
        kind: 'changed',
      });
    });

    it('writes when the file still has the expected stat', async () => {
      const folder = memoryFolder();
      const first = await writeTranscriptFile(folder, makeDoc());
      const second = await writeTranscriptFile(folder, makeDoc({ id: makeDoc().id }), {
        name: first.name,
        expected: first.stat,
      });
      expect(second.stat.lastModified).toBeGreaterThan(first.stat.lastModified);
    });

    it('refuses when someone else changed or removed the file', async () => {
      const folder = memoryFolder();
      const { name, stat } = await writeTranscriptFile(folder, makeDoc());
      folder.put(`sessions/${name}`, 'their edit');
      await expect(
        writeTranscriptFile(folder, makeDoc(), { name, expected: stat }),
      ).rejects.toMatchObject({
        kind: 'changed',
        path: `sessions/${name}`,
      });
      folder.remove(`sessions/${name}`);
      await expect(
        writeTranscriptFile(folder, makeDoc(), { name, expected: stat }),
      ).rejects.toMatchObject({
        kind: 'changed',
      });
      expect(folder.text(`sessions/${name}`)).toBeUndefined();
    });

    it('writes without a check when expected is left out', async () => {
      const folder = memoryFolder();
      const { name } = await writeTranscriptFile(folder, makeDoc());
      folder.put(`sessions/${name}`, 'their edit');
      await expect(writeTranscriptFile(folder, makeDoc(), { name })).resolves.toMatchObject({
        name,
      });
    });
  });
});

describe('summary files', () => {
  const doc = withTranslation(makeDoc());
  const name = summaryPath(doc).slice('sessions/'.length);

  it('writes a summary indented, and reads it back unchanged', async () => {
    const folder = memoryFolder();
    const file = makeSummaryFile(doc);
    const { stat } = await writeSummaryFile(folder, file, name);
    expect(folder.text(summaryPath(doc))).toBe(`${JSON.stringify(file, null, 2)}\n`);
    await expect(readSummaryFile(folder, name)).resolves.toEqual({ file, stat });
  });

  it('refuses a summary file that is damaged or of another kind', async () => {
    const valid = makeSummaryFile(doc);
    const folder = memoryFolder('P', {
      'sessions/a--1.summary.json': '{not json',
      'sessions/b--2.summary.json': JSON.stringify({ ...valid, kind: 'describe.transcript' }),
      'sessions/c--3.summary.json': JSON.stringify({ ...valid, schemaVersion: 2 }),
      'sessions/d--4.summary.json': JSON.stringify({ ...valid, summary: { title: 'x' } }),
    });
    for (const file of ['a--1', 'b--2', 'c--3', 'd--4']) {
      await expect(readSummaryFile(folder, `${file}.summary.json`)).rejects.toMatchObject({
        kind: 'invalid',
        path: `sessions/${file}.summary.json`,
      });
    }
  });

  it('keeps the provider, and reads a file without one, or with one it does not know, as having none', async () => {
    const { provider: _none, ...older } = makeSummaryFile(doc);
    const folder = memoryFolder('P', {
      'sessions/a--1.summary.json': JSON.stringify({ ...older, provider: 'gemini' }),
      'sessions/b--2.summary.json': JSON.stringify(older),
      'sessions/c--3.summary.json': JSON.stringify({ ...older, provider: 'mistral' }),
    });
    const providerOf = async (file: string) =>
      (await readSummaryFile(folder, `${file}.summary.json`)).file.provider;
    expect(await providerOf('a--1')).toBe('gemini');
    expect(await providerOf('b--2')).toBeUndefined();
    expect(await providerOf('c--3')).toBeUndefined();
  });
});
