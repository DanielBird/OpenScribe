import 'fake-indexeddb/auto';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toSessionText } from '../domain/corpus/sessionText';
import { briefHash } from '../domain/project';
import type { SessionSummaryFile } from '../domain/summary';
import type { TranscriptDoc } from '../domain/transcript';
import { staleTurnIds } from '../domain/translation';
import { ProviderError } from '../providers/errors';
import { setLlmProviderFactoryForTests } from '../providers/index';
import type { LlmProvider, StructuredRequest } from '../providers/llm/types';
import { clearCorpusCache } from '../storage/corpusCache';
import { clearLastTranscript, saveTranscriptLink } from '../storage/idb';
import { rememberFolder, resetFolderMocks } from '../testing/folderMocks';
import { memoryFolder, type MemoryFolder } from '../testing/memoryFolder';
import {
  projectFiles,
  summaryFileText,
  summaryPath,
  TEST_BRIEF,
  transcriptFileText,
  transcriptPath,
} from '../testing/projectSeed';
import { summaryReplyForInput } from '../testing/summary';
import {
  makeDoc,
  makeLargeDoc,
  withEditedTurn,
  withSourceHashes,
  withTranslation,
} from '../testing/transcriptDoc';
import { needsTranslation, PIPELINE_MESSAGES, usePipelineStore } from './pipeline';
import { useProjectStore } from './project';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';

vi.mock('../storage/folder', async (importOriginal) =>
  (await import('../testing/folderMocks')).mockFolderModule(await importOriginal()),
);

interface Request {
  schemaName: string;
  input: string;
  provider: string;
  model: string;
  apiKey: string;
}

/** Called for each request; return a reply, throw, or return `undefined` for the default reply. */
type Respond = (req: StructuredRequest<unknown>, n: number) => unknown;

/**
 * Claude, faked: translations come back as "EN <id>", summaries quote the turns they were sent, unless `respond`
 * says otherwise. `writesAt` records how many files had been written when each request was made.
 */
function fakeClaude(folder: MemoryFolder | null = null) {
  const requests: Request[] = [];
  const writesAt: number[] = [];
  const state: { respond: Respond | null } = { respond: null };
  setLlmProviderFactoryForTests((id, apiKey, model): LlmProvider => ({
    id,
    model,
    async generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
      const n =
        requests.push({
          schemaName: req.schemaName,
          input: req.input,
          provider: id,
          model,
          apiKey,
        }) - 1;
      writesAt.push(folder?.writes.length ?? 0);
      const custom = state.respond
        ? await state.respond(req as StructuredRequest<unknown>, n)
        : undefined;
      if (custom !== undefined) return custom as T;
      if (req.schemaName === 'translation_batch') {
        const { segments } = JSON.parse(req.input) as { segments: { id: string }[] };
        return { translations: segments.map((s) => ({ id: s.id, text: `EN ${s.id}` })) } as T;
      }
      return summaryReplyForInput(req.input) as T;
    },
  }));
  return { requests, writesAt, state };
}

/** A request that waits until the test lets it go. */
function held() {
  let release!: (reply?: unknown) => void;
  let fail!: (err: unknown) => void;
  const promise = new Promise<unknown>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
}

const english = (id: string, n = 1): TranscriptDoc => {
  const base = makeDoc();
  return {
    ...base,
    id,
    source: { ...base.source, fileName: `P0${n} english.m4a`, lastModified: Date.UTC(2026, 8, n) },
    result: { ...base.result, languageCode: 'eng' },
  };
};

const german = (id: string, n = 1, base = makeDoc()): TranscriptDoc => ({
  ...base,
  id,
  source: { ...base.source, fileName: `P0${n} german.m4a`, lastModified: Date.UTC(2026, 8, n) },
});

const fileJson = <T>(folder: MemoryFolder, path: string): T => JSON.parse(folder.text(path)!) as T;

const summaryOf = (folder: MemoryFolder, doc: TranscriptDoc) =>
  fileJson<SessionSummaryFile>(folder, summaryPath(doc));

const docOf = (folder: MemoryFolder, doc: TranscriptDoc) =>
  fileJson<{ doc: TranscriptDoc }>(folder, transcriptPath(doc)).doc;

async function readyProject(folder: MemoryFolder) {
  rememberFolder(folder);
  const project = useProjectStore();
  await project.init();
  expect(project.status).toBe('ready');
  return project;
}

const beforeUnloadPrevented = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

beforeEach(async () => {
  resetFolderMocks();
  localStorage.clear();
  sessionStorage.clear();
  await clearCorpusCache();
  await clearLastTranscript();
  await saveTranscriptLink(null);
  setActivePinia(createPinia());
  useSettingsStore().claudeKey = 'test-key';
});

afterEach(() => {
  setLlmProviderFactoryForTests(null);
  usePipelineStore().$dispose();
  useTranscriptStore().$dispose();
  useProjectStore().$dispose();
});

describe('needsTranslation', () => {
  it('is true for a German or French transcript without English text', () => {
    expect(needsTranslation(makeDoc())).toBe(true);
    expect(needsTranslation(withTranslation(makeDoc()))).toBe(false);
    expect(needsTranslation(english('e'))).toBe(false);
  });

  it('is true when a turn changed since it was translated (D39)', () => {
    const translated = withSourceHashes(withTranslation(makeDoc()));
    expect(needsTranslation(translated)).toBe(false);
    expect(needsTranslation(withEditedTurn(translated, 't2', 'Danke.'))).toBe(true);
    // A translation from before D39 doesn't say what it was made from: it counts as current.
    expect(needsTranslation(withEditedTurn(withTranslation(makeDoc()), 't2', 'Danke.'))).toBe(
      false,
    );
  });
});

describe('Add to project', () => {
  it('saves an English transcript first, then summarises it, and links it', async () => {
    const folder = memoryFolder('P', projectFiles([], { brief: TEST_BRIEF }));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const transcript = useTranscriptStore();
    const doc = english('en-1');
    await transcript.setDoc(doc);
    const pipeline = usePipelineStore();

    await pipeline.addCurrentTranscript();

    expect(claude.requests.map((r) => r.schemaName)).toEqual(['session_summary']);
    // The transcript was in the folder before the request was made.
    expect(claude.writesAt).toEqual([1]);
    expect(folder.writes).toEqual([transcriptPath(doc), summaryPath(doc)]);
    expect(docOf(folder, doc)).toEqual(doc);
    expect(summaryOf(folder, doc)).toMatchObject({
      kind: 'describe.summary',
      schemaVersion: 1,
      sessionId: doc.id,
      model: 'claude-sonnet-5-5',
      transcriptHash: toSessionText(doc).transcriptHash,
      briefHash: briefHash(TEST_BRIEF),
      droppedQuotes: 0,
    });
    expect(transcript.projectLink).toMatchObject({ docId: doc.id });
    expect(pipeline.statusOf(doc.id)).toBe('ok');
    expect(pipeline.current).toBeNull();
  });

  it('translates a German transcript before summarising it, and shows the English on Output', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const transcript = useTranscriptStore();
    const doc = german('de-1');
    await transcript.setDoc(doc);

    await usePipelineStore().addCurrentTranscript();

    expect(claude.requests.map((r) => r.schemaName)).toEqual([
      'translation_batch',
      'session_summary',
    ]);
    expect(transcript.doc?.translations.en).toMatchObject({
      provider: 'claude',
      model: 'claude-sonnet-5-5',
      texts: { t1: 'EN t1', t5: 'EN t5' },
    });
    expect(transcript.view).toBe('en');
    const saved = docOf(folder, doc);
    expect(saved.translations.en?.texts.t1).toBe('EN t1');
    expect(summaryOf(folder, doc).transcriptHash).toBe(toSessionText(saved).transcriptHash);
    expect(claude.requests[1]!.input).toContain('EN t2');
  });

  it('summarises a German transcript although a turn comes back empty twice (D42)', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    claude.state.respond = (req) => {
      if (req.schemaName !== 'translation_batch') return undefined;
      const { segments } = JSON.parse(req.input) as { segments: { id: string }[] };
      return {
        translations: segments.map((s) => ({ id: s.id, text: s.id === 't2' ? '' : `EN ${s.id}` })),
      };
    };
    await readyProject(folder);
    const doc = german('de-1');
    await useTranscriptStore().setDoc(doc);
    const pipeline = usePipelineStore();

    await pipeline.addCurrentTranscript();

    expect(claude.requests.map((r) => r.schemaName)).toEqual([
      'translation_batch',
      'translation_batch',
      'session_summary',
    ]);
    const saved = docOf(folder, doc);
    expect(saved.translations.en?.texts).toMatchObject({ t1: 'EN t1', t2: doc.turns[1]!.text });
    expect(staleTurnIds(saved)).toEqual([]);
    expect(summaryOf(folder, doc).transcriptHash).toBe(toSessionText(saved).transcriptHash);
    expect(pipeline.statusOf(doc.id)).toBe('ok');
  });

  it('uses the project model and the Claude key', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    useSettingsStore().projectModel = 'claude-opus-5-5';
    const doc = english('en-1');
    await useTranscriptStore().setDoc(doc);
    await usePipelineStore().addCurrentTranscript();
    expect(claude.requests[0]).toMatchObject({
      provider: 'claude',
      model: 'claude-opus-5-5',
      apiKey: 'test-key',
    });
    expect(summaryOf(folder, doc)).toMatchObject({ model: 'claude-opus-5-5', provider: 'claude' });
  });

  it('with a Gemini model, translates and summarises with Gemini and its key, and records it', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const llm = fakeClaude(folder);
    await readyProject(folder);
    const settings = useSettingsStore();
    settings.projectModel = 'gemini-4-argon';
    settings.geminiKey = 'test-key-gemini';
    const doc = german('de-1');
    await useTranscriptStore().setDoc(doc);

    await usePipelineStore().addCurrentTranscript();

    expect(llm.requests.map((r) => [r.schemaName, r.provider, r.model, r.apiKey])).toEqual([
      ['translation_batch', 'gemini', 'gemini-4-argon', 'test-key-gemini'],
      ['session_summary', 'gemini', 'gemini-4-argon', 'test-key-gemini'],
    ]);
    expect(docOf(folder, doc).translations.en).toMatchObject({
      provider: 'gemini',
      model: 'gemini-4-argon',
    });
    expect(summaryOf(folder, doc)).toMatchObject({ model: 'gemini-4-argon', provider: 'gemini' });
  });

  it('asks for the Gemini key when a Gemini model has none, and stops', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const llm = fakeClaude(folder);
    await readyProject(folder);
    const settings = useSettingsStore();
    settings.projectModel = 'gemini-3.8-flash';
    settings.geminiKey = '';
    const doc = english('en-1');
    await useTranscriptStore().setDoc(doc);
    const pipeline = usePipelineStore();
    expect(pipeline.needsKey).toBe(true);
    settings.projectModel = 'claude-sonnet-5-5';
    expect(pipeline.needsKey).toBe(false);
    settings.projectModel = 'gemini-3.8-flash';

    await pipeline.addCurrentTranscript();
    expect(llm.requests).toEqual([]);
    expect(pipeline.failureFor(doc.id)?.error).toMatchObject({
      kind: 'auth',
      userMessage: PIPELINE_MESSAGES.keyMissing.gemini,
    });
  });

  it('a failed summary leaves the session in the project, and Resume summarises only', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const doc = english('en-1');
    await useTranscriptStore().setDoc(doc);
    claude.state.respond = () => {
      throw new ProviderError('server', 'Claude is busy. Try again.');
    };
    const pipeline = usePipelineStore();

    await pipeline.addCurrentTranscript();

    expect(folder.text(transcriptPath(doc))).toBeDefined();
    expect(folder.text(summaryPath(doc))).toBeUndefined();
    expect(pipeline.statusOf(doc.id)).toBe('failed');
    expect(pipeline.failureFor(doc.id)).toMatchObject({
      step: 'summarise',
      error: { kind: 'server', userMessage: 'Claude is busy. Try again.' },
    });

    claude.state.respond = null;
    const writes = folder.writes.length;
    await pipeline.resume();
    expect(folder.writes.slice(writes)).toEqual([summaryPath(doc)]);
    expect(pipeline.statusOf(doc.id)).toBe('ok');
    expect(pipeline.failureFor(doc.id)).toBeNull();
  });

  it('a failed translation resumes from the batches it finished', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const doc = german('de-1', 1, makeLargeDoc(150));
    await useTranscriptStore().setDoc(doc);
    claude.state.respond = (_req, n) => {
      if (n === 1) throw new ProviderError('network', 'No connection.');
      return undefined;
    };
    const pipeline = usePipelineStore();

    await pipeline.addCurrentTranscript();
    expect(pipeline.failureFor(doc.id)).toMatchObject({ step: 'translate' });
    expect(Object.keys(pipeline.failureFor(doc.id)!.partial?.texts ?? {})).toHaveLength(60);

    claude.state.respond = null;
    await pipeline.resume();
    const batches = claude.requests.filter((r) => r.schemaName === 'translation_batch');
    // Batch 1 once, batch 2 twice (failed, then again), batch 3 once.
    expect(batches).toHaveLength(4);
    expect(batches[2]!.input).toContain('"t61"');
    expect(pipeline.statusOf(doc.id)).toBe('ok');
  });

  it('Resume translates again a finished turn that was edited after the failure', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const doc = german('de-1', 1, makeLargeDoc(150));
    const transcript = useTranscriptStore();
    await transcript.setDoc(doc);
    claude.state.respond = (_req, n) => {
      if (n === 1) throw new ProviderError('network', 'No connection.');
      return undefined;
    };
    const pipeline = usePipelineStore();
    await pipeline.addCurrentTranscript();
    expect(pipeline.failureFor(doc.id)).toMatchObject({ step: 'translate' });

    transcript.editTurnText('t5', 'Korrigiert.');
    claude.state.respond = null;
    await pipeline.resume();

    const batches = claude.requests.filter((r) => r.schemaName === 'translation_batch');
    // Batch 1, batch 2 (failed), then batch 1 again for the edited turn, batch 2 and batch 3.
    expect(batches).toHaveLength(5);
    expect(batches[2]!.input).toContain('Korrigiert.');
    expect(staleTurnIds(transcript.doc!)).toEqual([]);
    expect(pipeline.statusOf(doc.id)).toBe('ok');
  });

  it('a save that fails stops before any request, and Resume saves', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const doc = english('en-1');
    await useTranscriptStore().setDoc(doc);
    folder.failOn(transcriptPath(doc), 'io');
    const pipeline = usePipelineStore();

    await pipeline.addCurrentTranscript();
    expect(claude.requests).toEqual([]);
    expect(pipeline.failureFor(doc.id)).toMatchObject({ step: 'save', error: { kind: 'io' } });

    folder.failOn(transcriptPath(doc), null);
    await pipeline.resume();
    expect(pipeline.statusOf(doc.id)).toBe('ok');
  });

  it('Cancel stops cleanly: the saved transcript stays, and a late reply is ignored', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const doc = english('en-1');
    await useTranscriptStore().setDoc(doc);
    const reply = held();
    claude.state.respond = () => reply.promise;
    const pipeline = usePipelineStore();

    const done = pipeline.addCurrentTranscript();
    await vi.waitFor(() => expect(pipeline.current?.current).toBe('summarise'));
    pipeline.cancel();
    await done;
    expect(pipeline.current).toBeNull();
    expect(pipeline.isBusy).toBe(false);

    reply.release(summaryReplyForInput(claude.requests[0]!.input));
    await flushPromises();
    expect(folder.text(transcriptPath(doc))).toBeDefined();
    expect(folder.text(summaryPath(doc))).toBeUndefined();
    expect(pipeline.statusOf(doc.id)).toBe('none');
  });

  it('keeps the "Leave site?" warning up while it works', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    await useTranscriptStore().setDoc(english('en-1'));
    const reply = held();
    claude.state.respond = () => reply.promise;
    const pipeline = usePipelineStore();

    expect(beforeUnloadPrevented()).toBe(false);
    const done = pipeline.addCurrentTranscript();
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));
    expect(beforeUnloadPrevented()).toBe(true);
    reply.release();
    await done;
    expect(beforeUnloadPrevented()).toBe(false);
  });

  it('writes the translation into the file when the transcript is replaced on Output meanwhile', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const transcript = useTranscriptStore();
    const doc = german('de-1');
    await transcript.setDoc(doc);
    const reply = held();
    claude.state.respond = (req) =>
      req.schemaName === 'translation_batch' ? reply.promise : undefined;

    const done = usePipelineStore().addCurrentTranscript();
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));
    await transcript.setDoc(english('other'));
    reply.release();
    await done;

    expect(docOf(folder, doc).translations.en?.texts.t1).toBe('EN t1');
    expect(transcript.doc?.id).toBe('other');
    expect(summaryOf(folder, doc).sessionId).toBe(doc.id);
  });

  it('asks for the key when it is missing, and stops', async () => {
    const folder = memoryFolder('P', projectFiles([]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    useSettingsStore().claudeKey = '';
    const doc = english('en-1');
    await useTranscriptStore().setDoc(doc);
    const pipeline = usePipelineStore();
    expect(pipeline.needsKey).toBe(true);

    await pipeline.addCurrentTranscript();
    expect(claude.requests).toEqual([]);
    expect(pipeline.failureFor(doc.id)?.error).toMatchObject({
      kind: 'auth',
      userMessage: PIPELINE_MESSAGES.keyMissing.claude,
    });
    expect(pipeline.stopped).not.toBeNull();
  });
});

describe('Summarise in Project mode', () => {
  it('translates a session that is only in the folder, in its file, then summarises it', async () => {
    const doc = german('de-1');
    const folder = memoryFolder('P', projectFiles([doc]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const pipeline = usePipelineStore();

    await pipeline.summarise([doc.id]);

    expect(claude.requests.map((r) => r.schemaName)).toEqual([
      'translation_batch',
      'session_summary',
    ]);
    expect(docOf(folder, doc).translations.en?.texts.t3).toBe('EN t3');
    expect(useTranscriptStore().doc).toBeNull();
    expect(pipeline.statusOf(doc.id)).toBe('ok');
  });

  it('translates again only the batch of a turn corrected since the translation, then summarises it (D39)', async () => {
    const base = german('de-1', 1, makeLargeDoc(150));
    const old = Object.fromEntries(base.turns.map((t) => [t.id, `Old ${t.id}`]));
    const doc = withEditedTurn(withSourceHashes(withTranslation(base, old)), 't140', 'Neuer Text.');
    const folder = memoryFolder('P', projectFiles([doc]));
    const claude = fakeClaude(folder);
    const project = await readyProject(folder);
    expect(project.session(doc.id)?.text.turns.find((t) => t.id === 't140')?.en).toBeNull();
    const pipeline = usePipelineStore();

    await pipeline.summarise([doc.id]);

    expect(claude.requests.map((r) => r.schemaName)).toEqual([
      'translation_batch',
      'session_summary',
    ]);
    expect(claude.requests[0]!.input).toContain('Neuer Text.');
    expect(claude.requests[0]!.input).not.toContain('"t1"');
    const saved = docOf(folder, doc);
    expect(saved.translations.en?.texts.t140).toBe('EN t140');
    expect(saved.translations.en?.texts.t1).toBe('Old t1');
    expect(staleTurnIds(saved)).toEqual([]);
    expect(claude.requests[1]!.input).toContain('EN t140');
    expect(claude.requests[1]!.input).not.toContain('Old t140');
    expect(pipeline.statusOf(doc.id)).toBe('ok');
  });

  it('summarises a session open on Output through the Output tab, saving its changes first', async () => {
    const doc = withTranslation(german('de-1'));
    const folder = memoryFolder('P', projectFiles([doc]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const transcript = useTranscriptStore();
    await transcript.openFromProject(doc.id);
    transcript.renameSpeaker('speaker_0', 'Interviewer');

    await usePipelineStore().summarise([doc.id]);

    expect(claude.requests[0]!.input).toContain('Interviewer (speaker_0)');
    expect(docOf(folder, doc).speakers[0]!.label).toBe('Interviewer');
    expect(usePipelineStore().statusOf(doc.id)).toBe('ok');
  });

  it("gives the theme names of the other sessions, not the session's own", async () => {
    const [a, b] = [withTranslation(german('a', 1)), withTranslation(german('b', 2))];
    const theme = (name: string) => ({
      name,
      description: 'd',
      turnIds: [],
      isNew: false,
      quotes: [],
    });
    const withThemes = (doc: TranscriptDoc, names: string[]) =>
      summaryFileText(doc, {
        summary: { ...summaryReplyForInput(''), themes: names.map(theme) },
      });
    const folder = memoryFolder('P', {
      ...projectFiles([a, b]),
      [summaryPath(a)]: withThemes(a, ['stigma']),
      [summaryPath(b)]: withThemes(b, ['charging routines']),
    });
    const claude = fakeClaude(folder);
    await readyProject(folder);

    await usePipelineStore().summarise([a.id]);
    const input = claude.requests[0]!.input;
    expect(input).toContain('charging routines (1)');
    expect(input).not.toContain('stigma');
  });

  it('runs one session at a time, and moves on past a failure', async () => {
    const docs = [1, 2, 3].map((n) => withTranslation(german(`s${n}`, n)));
    const folder = memoryFolder('P', projectFiles(docs));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const pipeline = usePipelineStore();
    const first = held();
    claude.state.respond = (req, n) => {
      if (n === 0) return first.promise;
      if (req.input.includes('P02 german')) throw new ProviderError('server', 'Busy.');
      return undefined;
    };

    const done = pipeline.summarise(docs.map((d) => d.id));
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));
    expect(pipeline.statusOf('s1')).toBe('running');
    expect(pipeline.statusOf('s2')).toBe('queued');
    expect(pipeline.queued.map((j) => j.sessionId)).toEqual(['s2', 's3']);
    expect(pipeline.queueProgress).toEqual({ done: 0, total: 3 });
    first.release();
    await done;

    expect(claude.requests).toHaveLength(3);
    expect(docs.map((d) => pipeline.statusOf(d.id))).toEqual(['ok', 'failed', 'ok']);
    expect(pipeline.stopped).toBeNull();
    expect(pipeline.summariseAllIds).toEqual(['s2']);
  });

  it.each(['auth', 'quota'] as const)('stops the queue on %s', async (kind) => {
    const docs = [1, 2, 3].map((n) => withTranslation(german(`s${n}`, n)));
    const folder = memoryFolder('P', projectFiles(docs));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    claude.state.respond = (_req, n) => {
      if (n === 1) throw new ProviderError(kind, 'Stop.');
      return undefined;
    };
    const pipeline = usePipelineStore();

    await pipeline.summarise(docs.map((d) => d.id));
    expect(claude.requests).toHaveLength(2);
    expect(docs.map((d) => pipeline.statusOf(d.id))).toEqual(['ok', 'failed', 'none']);
    expect(pipeline.stopped).toMatchObject({ kind });
    expect(pipeline.isBusy).toBe(false);
    if (kind === 'auth') expect(pipeline.needsKey).toBe(true);
  });

  it('stops the queue on a Gemini rate limit, but not on a Claude one', async () => {
    const docs = [1, 2, 3].map((n) => withTranslation(german(`s${n}`, n)));
    const folder = memoryFolder('P', projectFiles(docs));
    const llm = fakeClaude(folder);
    await readyProject(folder);
    const settings = useSettingsStore();
    settings.geminiKey = 'test-key-gemini';
    llm.state.respond = (_req, n) => {
      if (n === 1) throw new ProviderError('rate_limit', 'Busy.');
      return undefined;
    };
    const pipeline = usePipelineStore();

    settings.projectModel = 'gemini-3.8-flash';
    await pipeline.summarise(docs.map((d) => d.id));
    expect(docs.map((d) => pipeline.statusOf(d.id))).toEqual(['ok', 'failed', 'none']);
    expect(pipeline.stopped).toMatchObject({ kind: 'rate_limit' });

    settings.projectModel = 'claude-sonnet-5-5';
    llm.requests.length = 0;
    llm.state.respond = (_req, n) => {
      if (n === 0) throw new ProviderError('rate_limit', 'Busy.');
      return undefined;
    };
    await pipeline.summarise(['s2', 's3']);
    expect(llm.requests).toHaveLength(2);
    expect(pipeline.stopped).toBeNull();
    expect(pipeline.statusOf('s3')).toBe('ok');
  });

  it('puts Add to project right after the running session', async () => {
    const docs = [1, 2].map((n) => withTranslation(german(`s${n}`, n)));
    const folder = memoryFolder('P', projectFiles(docs));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    await useTranscriptStore().setDoc(english('added', 9));
    const first = held();
    claude.state.respond = (_req, n) => (n === 0 ? first.promise : undefined);
    const pipeline = usePipelineStore();

    const done = pipeline.summarise(docs.map((d) => d.id));
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));
    void pipeline.addCurrentTranscript();
    expect(pipeline.queued.map((j) => j.sessionId)).toEqual(['added', 's2']);
    first.release();
    await done;
    expect(claude.requests.map((r) => /Recording: ([^·]+)/.exec(r.input)?.[1]?.trim())).toEqual([
      'P01 german.m4a',
      'P09 english.m4a',
      'P02 german.m4a',
    ]);
  });

  it('stamps a summary with the brief it was made with, when the brief changes meanwhile', async () => {
    const doc = withTranslation(german('s1'));
    const folder = memoryFolder('P', projectFiles([doc], { brief: TEST_BRIEF }));
    const claude = fakeClaude(folder);
    const project = await readyProject(folder);
    const reply = held();
    claude.state.respond = () => reply.promise;
    const pipeline = usePipelineStore();

    const done = pipeline.summarise([doc.id]);
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));
    const edited = { ...TEST_BRIEF, researchQuestions: ['A new question?'] };
    await expect(project.saveBrief('P', edited, project.projectStat!)).resolves.toEqual({
      ok: true,
    });
    reply.release();
    await done;

    expect(summaryOf(folder, doc).briefHash).toBe(briefHash(TEST_BRIEF));
    expect(pipeline.statusOf(doc.id)).toBe('stale');
    expect(pipeline.summariseAllIds).toEqual([doc.id]);
  });

  it("doesn't attach a translation to text a colleague changed meanwhile; Resume translates what changed", async () => {
    const doc = german('de-1', 1, makeLargeDoc(150));
    const folder = memoryFolder('P', projectFiles([doc]));
    const claude = fakeClaude(folder);
    await readyProject(folder);
    const first = held();
    claude.state.respond = (_req, n) => (n === 0 ? first.promise : undefined);
    const pipeline = usePipelineStore();

    const done = pipeline.summarise([doc.id]);
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));
    // A colleague corrects a turn in the last batch, and OneDrive syncs it.
    const edited: TranscriptDoc = {
      ...doc,
      turns: doc.turns.map((t) => (t.id === 't140' ? { ...t, text: 'Neuer Text.' } : t)),
    };
    folder.put(transcriptPath(doc), transcriptFileText(edited));
    first.release();
    await done;

    expect(pipeline.failureFor(doc.id)).toMatchObject({
      step: 'translate',
      error: { kind: 'changed' },
    });
    expect(docOf(folder, doc)).toEqual(edited);
    expect(folder.text(summaryPath(doc))).toBeUndefined();

    const before = claude.requests.length;
    await pipeline.resume();
    const again = claude.requests.slice(before).filter((r) => r.schemaName === 'translation_batch');
    expect(again).toHaveLength(1);
    expect(again[0]!.input).toContain('Neuer Text.');
    const saved = docOf(folder, doc);
    expect(saved.turns.find((t) => t.id === 't140')?.text).toBe('Neuer Text.');
    expect(Object.keys(saved.translations.en?.texts ?? {})).toHaveLength(150);
    expect(pipeline.statusOf(doc.id)).toBe('ok');
    expect(summaryOf(folder, doc).transcriptHash).toBe(toSessionText(saved).transcriptHash);
  });

  it('cancels the work and forgets failures when another project opens', async () => {
    const doc = withTranslation(german('s1'));
    const folder = memoryFolder('P', projectFiles([doc]));
    const claude = fakeClaude(folder);
    const project = await readyProject(folder);
    claude.state.respond = () => {
      throw new ProviderError('server', 'Busy.');
    };
    const pipeline = usePipelineStore();
    await pipeline.summarise([doc.id]);
    expect(pipeline.statusOf(doc.id)).toBe('failed');

    await project.forget();
    expect(pipeline.failures.size).toBe(0);
  });
});
