import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionText } from '../domain/corpus/sessionText';
import type { LlmProviderId } from '../domain/transcript';
import { EMPTY_BRIEF, type ProjectFile } from '../domain/project';
import type { SessionSummaryFile } from '../domain/summary';
import { parseAnswer } from '../features/agent/answer';
import { COMPACTED_LEAD, compactedHistory, compactPrompt } from '../features/agent/compact';
import { AGENT_LIMITS } from '../features/agent/limits';
import { ProviderError } from '../providers/errors';
import { setAgentProviderFactoryForTests } from '../providers/index';
import type {
  AgentConversation,
  AgentExchange,
  AgentRunRequest,
  AgentRunResult,
  AgentUsage,
} from '../providers/llm/types';
import { chatTitle, type ChatFile, type ChatFileAnswer } from '../domain/chat';
import { FolderError, type FileStat } from '../storage/folder';
import {
  COLLEAGUE,
  FUTURE_FIELD,
  makeChatFile,
  withFutureChatFields,
} from '../testing/projectSeed';
import { makeProjectSession, makeSessionText } from '../testing/projectSessions';
import { makeSummaryReply } from '../testing/summary';
import {
  CHAT_MESSAGES,
  useChatStore,
  type ChatAssistantMessage,
  type ChatCompactionMessage,
} from './chat';
import { useProjectStore } from './project';
import { useSettingsStore } from './settings';

vi.mock('../features/agent/answer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/agent/answer')>();
  return { ...actual, parseAnswer: vi.fn(actual.parseAnswer) };
});

const USAGE: AgentUsage = {
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const conversationOf = (n: number) =>
  ({ model: 'claude-sonnet-5-5', n }) as unknown as AgentConversation;

type Run = (req: AgentRunRequest) => Promise<AgentRunResult>;

/** A fake agent: run n is `runs[n]`. Every request, every provider made and every history resumed is kept. */
function fakeAgent(runs: Run[]) {
  const requests: AgentRunRequest[] = [];
  const made: { id: LlmProviderId; apiKey: string; model: string }[] = [];
  const resumed: (readonly AgentExchange[])[] = [];
  setAgentProviderFactoryForTests((id, apiKey, model) => {
    made.push({ id, apiKey, model });
    return {
      model,
      run: (req) => {
        requests.push(req);
        const run = runs[requests.length - 1];
        if (!run) throw new Error(`no run ${requests.length}`);
        return run(req);
      },
      resume: (history) => {
        resumed.push(history);
        return { model, resumed: history } as unknown as AgentConversation;
      },
    };
  });
  return { requests, made, resumed };
}

/** The history a request's conversation was resumed from (`fakeAgent`), or `undefined`. */
const resumedFrom = (req: AgentRunRequest) =>
  (req.conversation as unknown as { resumed?: readonly AgentExchange[] } | null)?.resumed;

/** A run that streams `text` and a search, then finishes. */
const answers =
  (text: string, opts: { stopped?: 'done' | 'limit'; n?: number } = {}): Run =>
  async (req) => {
    req.onEvent({
      type: 'tool',
      name: 'search_transcripts',
      activity: 'Searched "charg*"',
      isError: false,
    });
    req.onEvent({ type: 'usage', usage: USAGE });
    req.onEvent({ type: 'text', delta: text });
    return {
      text,
      conversation: conversationOf(opts.n ?? 1),
      usage: USAGE,
      stopped: opts.stopped ?? 'done',
    };
  };

/** A run that streams `text`, then waits until it is aborted. */
const hangs =
  (text: string): Run =>
  (req) => {
    req.onEvent({ type: 'text', delta: text });
    return new Promise((_, reject) =>
      req.signal.addEventListener('abort', () => reject(new ProviderError('aborted', 'Stopped.'))),
    );
  };

/** A run that streams `text`, sends its request again (taking the text back), streams it again, then waits. */
const resends =
  (text: string): Run =>
  (req) => {
    req.onEvent({ type: 'text', delta: text });
    req.onEvent({ type: 'retry', discard: text.length });
    req.onEvent({ type: 'text', delta: text });
    return new Promise((_, reject) =>
      req.signal.addEventListener('abort', () => reject(new ProviderError('aborted', 'Stopped.'))),
    );
  };

const fails =
  (error: ProviderError, text = ''): Run =>
  async (req) => {
    if (text) req.onEvent({ type: 'text', delta: text });
    throw error;
  };

function summaryFile(text: SessionText, createdAt: string): SessionSummaryFile {
  return {
    kind: 'describe.summary',
    schemaVersion: 1,
    sessionId: text.sessionId,
    createdAt,
    model: 'claude-sonnet-5-5',
    transcriptHash: text.transcriptHash,
    briefHash: 'brief',
    droppedQuotes: 0,
    summary: makeSummaryReply(text, { title: `${text.recordingName} title` }),
  };
}

const projectFile = (id = 'project-1'): ProjectFile => ({
  kind: 'describe.project',
  schemaVersion: 1,
  id,
  name: 'Hearing at home',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  brief: { ...EMPTY_BRIEF, researchQuestions: ['How do people charge?'] },
});

/** A project with two sessions, the first summarised. */
function seedProject() {
  const project = useProjectStore();
  const one = makeSessionText(1);
  const two = makeSessionText(2);
  project.project = projectFile();
  project.corpus = [one, two];
  project.sessions = [
    makeProjectSession(one, [], { file: summaryFile(one, '2026-10-02T00:00:00.000Z') }),
    makeProjectSession(two),
  ];
  return { project, one, two };
}

/** Animation frames, run by hand. */
let frames: FrameRequestCallback[] = [];
const runFrames = () => {
  const now = frames;
  frames = [];
  now.forEach((f) => f(0));
};

const answer = (chat: ReturnType<typeof useChatStore>) =>
  chat.messages[chat.messages.length - 1] as ChatAssistantMessage;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setActivePinia(createPinia());
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.mocked(parseAnswer).mockClear();
  useSettingsStore().setKey('claude', 'test-key');
});

afterEach(() => {
  setAgentProviderFactoryForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chat store', () => {
  it('asks with a snapshot made once, and a follow-up starts from the earlier text (D47)', async () => {
    seedProject();
    const { requests, made } = fakeAgent([
      answers('First.', { n: 1 }),
      answers('Second.', { n: 2 }),
    ]);
    const chat = useChatStore();

    await chat.ask('  Who charges at night?  ');
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(chat.messages[0]).toMatchObject({ role: 'user', text: 'Who charges at night?' });
    expect(answer(chat)).toMatchObject({ status: 'done', text: 'First.', error: null });
    expect(answer(chat).activity).toEqual([
      { tool: 'search_transcripts', line: 'Searched "charg*"', isError: false },
    ]);
    expect(answer(chat).costUsd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6);
    expect(chat.model).toBe('claude-sonnet-5-5');
    expect(made[0]).toEqual({ id: 'claude', apiKey: 'test-key', model: 'claude-sonnet-5-5' });

    const context = requests[0]!.context;
    expect(context).toContain('Project: Hearing at home');
    expect(context).toContain('1. How do people charge?');
    expect(context).toContain('Sessions (2)');
    expect(requests[0]!.conversation).toBeNull();

    // A session added meanwhile isn't in this chat's context.
    const project = useProjectStore();
    const three = makeSessionText(3);
    project.corpus = [...project.corpus, three];
    project.sessions = [...project.sessions, makeProjectSession(three)];

    await chat.ask('And who helps?');
    expect(requests[1]!.context).toBe(context);
    // Not the first question's conversation, with its tool results: its question and answer as text.
    expect(resumedFrom(requests[1]!)).toEqual([
      { question: 'Who charges at night?', answer: 'First.' },
    ]);
    expect(chat.messages).toHaveLength(4);
  });

  it('parses the streamed text at most once per animation frame', async () => {
    seedProject();
    let release: () => void = () => undefined;
    fakeAgent([
      (req) => {
        for (const delta of ['One ', 'two ', 'three.']) req.onEvent({ type: 'text', delta });
        return new Promise((resolve) => {
          release = () =>
            resolve({
              text: 'One two three.',
              conversation: conversationOf(1),
              usage: USAGE,
              stopped: 'done',
            });
        });
      },
    ]);
    const chat = useChatStore();
    const asking = chat.ask('Count');
    await Promise.resolve();

    expect(frames).toHaveLength(1);
    expect(answer(chat).text).toBe('');
    runFrames();
    expect(answer(chat).text).toBe('One two three.');
    expect(answer(chat).blocks).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'One two three.' }] },
    ]);
    const streamed = vi.mocked(parseAnswer).mock.calls.filter((c) => c[2]?.streaming);
    expect(streamed).toHaveLength(1);
    expect(chat.running).toBe(true);

    release();
    await asking;
    expect(chat.running).toBe(false);
    expect(answer(chat).status).toBe('done');
  });

  it('marks an answer that hit the backstop', async () => {
    seedProject();
    fakeAgent([answers('Partial.', { stopped: 'limit' })]);
    const chat = useChatStore();
    await chat.ask('Everything');
    expect(answer(chat).status).toBe('limit');
  });

  it('shows an error in place of the answer, keeps the conversation, and Try again asks again', async () => {
    seedProject();
    const { requests } = fakeAgent([
      answers('First.', { n: 1 }),
      fails(new ProviderError('rate_limit', 'Too many requests. Wait a minute.'), 'half an'),
      answers('Second.', { n: 2 }),
    ]);
    const chat = useChatStore();
    await chat.ask('One');
    await chat.ask('Two');
    expect(answer(chat)).toMatchObject({ status: 'error', text: '', blocks: [] });
    expect(answer(chat).error?.userMessage).toBe('Too many requests. Wait a minute.');

    await chat.retry();
    expect(chat.messages.map((m) => (m.role === 'user' ? m.text : m.status))).toEqual([
      'One',
      'done',
      'Two',
      'done',
    ]);
    expect(requests[2]!.userMessage).toBe('Two');
    expect(resumedFrom(requests[2]!)).toEqual([{ question: 'One', answer: 'First.' }]);
  });

  it('turns an unexpected throw into a message', async () => {
    seedProject();
    fakeAgent([() => Promise.reject(new TypeError('boom'))]);
    const chat = useChatStore();
    await chat.ask('One');
    expect(answer(chat).error).toMatchObject({
      kind: 'unknown',
      userMessage: 'Something went wrong. Try again.',
    });
  });

  it('Stop keeps the partial answer, and the next question goes on from before it', async () => {
    seedProject();
    const { requests } = fakeAgent([
      answers('First.', { n: 1 }),
      hangs('People charge'),
      answers('Third.', { n: 3 }),
    ]);
    const chat = useChatStore();
    await chat.ask('One');
    const asking = chat.ask('Two');
    await Promise.resolve();
    chat.stop();
    await asking;

    expect(answer(chat)).toMatchObject({ status: 'stopped', text: 'People charge' });
    expect(chat.running).toBe(false);
    runFrames(); // A frame already asked for changes nothing now.
    expect(answer(chat).status).toBe('stopped');

    await chat.ask('Three');
    expect(resumedFrom(requests[2]!)).toEqual([{ question: 'One', answer: 'First.' }]);
    expect(answer(chat)).toMatchObject({ status: 'done', text: 'Third.' });
  });

  it('a follow-up takes back the text of an answer stopped at a limit, unless it has none', async () => {
    seedProject();
    const { requests } = fakeAgent([
      answers('Partial.', { stopped: 'limit' }),
      answers('', { stopped: 'limit' }),
      answers('Third.'),
    ]);
    const chat = useChatStore();
    await chat.ask('One');
    await chat.ask('Two');
    await chat.ask('Three');
    expect(resumedFrom(requests[1]!)).toEqual([{ question: 'One', answer: 'Partial.' }]);
    // An empty answer can't go back to the provider, so it is left out with its question.
    expect(resumedFrom(requests[2]!)).toEqual([{ question: 'One', answer: 'Partial.' }]);
  });

  it('ignores a question while an answer is written, and a blank one', async () => {
    seedProject();
    const { requests } = fakeAgent([hangs('…')]);
    const chat = useChatStore();
    await chat.ask('   ');
    expect(chat.messages).toHaveLength(0);
    void chat.ask('One');
    await chat.ask('Two');
    expect(requests).toHaveLength(1);
    chat.stop();
  });

  it('New chat forgets everything, and the next question takes a new snapshot', async () => {
    const { project } = seedProject();
    const { requests } = fakeAgent([answers('First.'), answers('Again.')]);
    const chat = useChatStore();
    await chat.ask('One');
    const settings = useSettingsStore();
    settings.projectModel = 'claude-opus-5-5';
    const three = makeSessionText(3);
    project.corpus = [...project.corpus, three];
    project.sessions = [...project.sessions, makeProjectSession(three)];

    chat.newChat();
    expect(chat.messages).toEqual([]);
    expect(chat.model).toBeNull();
    expect(chat.corpus).toBeNull();
    expect(chat.newSessionCount).toBe(0);

    await chat.ask('One again');
    expect(requests[1]!.conversation).toBeNull();
    expect(requests[1]!.context).toContain('Sessions (3)');
    expect(chat.model).toBe('claude-opus-5-5');
  });

  it('counts sessions added or summarised since the chat started', async () => {
    const { project, two } = seedProject();
    fakeAgent([answers('First.')]);
    const chat = useChatStore();
    expect(chat.newSessionCount).toBe(0);
    await chat.ask('One');
    expect(chat.newSessionCount).toBe(0);

    const three = makeSessionText(3);
    project.sessions = [
      project.sessions[0]!,
      makeProjectSession(two, [], { file: summaryFile(two, '2026-10-20T00:00:00.000Z') }),
      makeProjectSession(three),
    ];
    expect(chat.newSessionCount).toBe(2);
  });

  it('notices a model change during the chat', async () => {
    seedProject();
    fakeAgent([answers('First.')]);
    const chat = useChatStore();
    const settings = useSettingsStore();
    settings.projectModel = 'claude-opus-5-5';
    expect(chat.modelChanged).toBe(false); // No chat yet.
    await chat.ask('One');
    expect(chat.model).toBe('claude-opus-5-5');
    settings.projectModel = 'claude-sonnet-5-5';
    expect(chat.modelChanged).toBe(true);
  });

  it('asks Gemini with the Gemini key for a Gemini model, and keeps it when the model changes', async () => {
    seedProject();
    const { made } = fakeAgent([answers('First.'), answers('Second.', { n: 2 })]);
    const chat = useChatStore();
    const settings = useSettingsStore();
    settings.setKey('gemini', 'gemini-key');
    settings.projectModel = 'gemini-3.8-flash';
    expect(chat.provider).toBe('gemini');

    await chat.ask('One');
    expect(made[0]).toEqual({ id: 'gemini', apiKey: 'gemini-key', model: 'gemini-3.8-flash' });
    // 1000 in × $1.50 + 200 out × $7.50, per million.
    expect(answer(chat).costUsd).toBeCloseTo((1000 * 1.5 + 200 * 7.5) / 1e6);

    settings.projectModel = 'claude-opus-5-5';
    expect(chat.modelChanged).toBe(true);
    expect(chat.provider).toBe('gemini');
    await chat.ask('Two');
    expect(made[1]).toEqual({ id: 'gemini', apiKey: 'gemini-key', model: 'gemini-3.8-flash' });

    chat.newChat();
    expect(chat.provider).toBe('claude');
    expect(chat.modelChanged).toBe(false);
  });

  it('notices a long chat from the size of the latest request', async () => {
    seedProject();
    const big =
      (inputTokens: number): Run =>
      async (req) => {
        req.onEvent({
          type: 'usage',
          usage: {
            inputTokens,
            outputTokens: 10,
            cacheReadTokens: 400_000,
            cacheWriteTokens: 1_000,
          },
        });
        return { text: 'Ok.', conversation: conversationOf(1), usage: USAGE, stopped: 'done' };
      };
    fakeAgent([big(1_000), big(AGENT_LIMITS.longChatTokens)]);
    const chat = useChatStore();
    await chat.ask('One');
    expect(chat.isLong).toBe(false);
    await chat.ask('Two');
    expect(chat.isLong).toBe(true);
  });

  it('needs the key when it is missing or was refused', async () => {
    seedProject();
    fakeAgent([fails(new ProviderError('auth', 'Check the Claude API key.'))]);
    const chat = useChatStore();
    const settings = useSettingsStore();
    settings.setKey('claude', '');
    expect(chat.needsKey).toBe(true);
    settings.setKey('claude', 'test-key');
    expect(chat.needsKey).toBe(false);
    await chat.ask('One');
    expect(chat.needsKey).toBe(true);
  });

  it('needs the Gemini key for a Gemini model, whatever the Claude key', () => {
    const chat = useChatStore();
    const settings = useSettingsStore();
    settings.projectModel = 'gemini-4-argon';
    expect(chat.needsKey).toBe(true);
    settings.setKey('gemini', 'gemini-key');
    expect(chat.needsKey).toBe(false);
    settings.setKey('claude', '');
    expect(chat.needsKey).toBe(false);
  });

  it('starts afresh in another project', async () => {
    const { project } = seedProject();
    fakeAgent([answers('First.')]);
    const chat = useChatStore();
    await chat.ask('One');
    project.project = projectFile('project-2');
    await vi.waitFor(() => expect(chat.messages).toEqual([]));
  });

  it('writes no browser storage while chatting: chats go to the project folder', async () => {
    seedProject();
    fakeAgent([answers('First.'), hangs('Half'), answers('Again.')]);
    const chat = useChatStore();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });

    await chat.ask('One');
    const asking = chat.ask('Two');
    await Promise.resolve();
    chat.stop();
    await asking;
    chat.newChat();
    await chat.ask('Three');

    expect(setItem).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

/** Stands in for the project folder: every save is kept, and gets the next stat. */
function folderSaves(failures: Error[] = []) {
  const project = useProjectStore();
  const saves: { file: ChatFile; expected: FileStat | null }[] = [];
  let n = 0;
  project.saveChat = vi.fn(async (file: ChatFile, expected: FileStat | null) => {
    const failure = failures.shift();
    if (failure) throw failure;
    saves.push({ file: structuredClone(file), expected });
    n++;
    return { file, name: `${file.id}.chat.json`, stat: { size: n, lastModified: n } };
  });
  return saves;
}

/** A saved chat about sessions 1 and 2, with keys they wouldn't get today, quoting session 1. */
function savedChat(overrides: Partial<ChatFile> = {}) {
  const file = makeChatFile({
    projectId: 'project-1',
    sessionKeys: { 'session-1': 's7', 'session-2': 's3' },
    messages: [
      { role: 'user', id: 'q1', at: '2026-10-20T14:02:00.000Z', text: 'Where do they charge?' },
      {
        role: 'assistant',
        id: 'a1',
        at: '2026-10-20T14:03:00.000Z',
        text: 'By the bed.\n<quote ref="s7/t2">I put them on the charger by the bed.</quote>',
        status: 'done',
        activity: [{ tool: 'read_transcript', line: 'Read s7', isError: false }],
        costUsd: 0.2,
        model: 'claude-sonnet-5-5',
      },
      { role: 'user', id: 'q2', at: '2026-10-20T14:04:00.000Z', text: 'And at work?' },
      {
        role: 'assistant',
        id: 'a2',
        at: '2026-10-20T14:05:00.000Z',
        text: 'Half an ans',
        status: 'stopped',
        activity: [],
        costUsd: 0.01,
        model: 'claude-sonnet-5-5',
      },
    ],
    ...overrides,
  });
  return { file, name: 'saved.chat.json', stat: { size: 100, lastModified: 100 } };
}

/** `chat` as another computer saved it later: one more question and answer, and a new stat. */
function newerVersion(chat: ReturnType<typeof savedChat>) {
  const file: ChatFile = {
    ...chat.file,
    updatedAt: '2026-10-21T09:01:00.000Z',
    messages: [
      ...chat.file.messages,
      { role: 'user', id: 'q3', at: '2026-10-21T09:00:00.000Z', text: 'At night?' },
      {
        role: 'assistant',
        id: 'a3',
        at: '2026-10-21T09:01:00.000Z',
        text: 'Mostly.',
        status: 'done',
        activity: [],
        costUsd: 0.1,
        model: 'claude-sonnet-5-5',
      },
    ],
  };
  return { ...chat, file, stat: { size: 200, lastModified: 200 } };
}

describe('saved chats (D29)', () => {
  it('saves the chat after each answer that ends, under one id, with the stat it was last saved with', async () => {
    seedProject();
    const saves = folderSaves();
    fakeAgent([answers('First.'), answers('Second.')]);
    const chat = useChatStore();
    const me = useSettingsStore().chatAuthor;

    await chat.ask('Who charges at night?');
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    const [first] = saves;
    expect(first!.expected).toBeNull();
    expect(first!.file).toMatchObject({
      kind: 'describe.chat',
      schemaVersion: 1,
      projectId: 'project-1',
      title: chatTitle('Who charges at night?'),
      author: me,
      forkedFrom: null,
      sessionKeys: { 'session-1': 's1', 'session-2': 's2' },
    });
    expect(first!.file.messages).toMatchObject([
      { role: 'user', text: 'Who charges at night?' },
      {
        role: 'assistant',
        text: 'First.',
        status: 'done',
        model: 'claude-sonnet-5-5',
        activity: [{ tool: 'search_transcripts', line: 'Searched "charg*"', isError: false }],
      },
    ]);
    expect(chat.chatId).toBe(first!.file.id);
    expect(chat.ownerName).toBeNull();

    await chat.ask('And who helps?');
    await vi.waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]!.file.id).toBe(first!.file.id);
    expect(saves[1]!.file.createdAt).toBe(first!.file.createdAt);
    expect(saves[1]!.expected).toEqual({ size: 1, lastModified: 1 });
    expect(saves[1]!.file.messages).toHaveLength(4);
    expect(chat.saveError).toBeNull();
  });

  it('saves a stopped answer, never a failed one', async () => {
    seedProject();
    const saves = folderSaves();
    fakeAgent([
      answers('First.'),
      fails(new ProviderError('server', 'The service is busy.')),
      hangs('Half'),
    ]);
    const chat = useChatStore();
    await chat.ask('One');
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    await chat.ask('Two');
    expect(answer(chat).status).toBe('error');

    const asking = chat.ask('Three');
    await Promise.resolve();
    chat.stop();
    await asking;
    await vi.waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]!.file.messages.map((m) => [m.role, 'text' in m ? m.text : m.summary])).toEqual([
      ['user', 'One'],
      ['assistant', 'First.'],
      ['user', 'Three'],
      ['assistant', 'Half'],
    ]);
  });

  it('shows and saves the text of a request sent again once, when Stop ends it', async () => {
    seedProject();
    const saves = folderSaves();
    fakeAgent([resends('Let me look.')]);
    const chat = useChatStore();
    const asking = chat.ask('One');
    await Promise.resolve();
    runFrames();
    expect(answer(chat)).toMatchObject({ status: 'streaming', text: 'Let me look.' });

    chat.stop();
    await asking;
    expect(answer(chat)).toMatchObject({ status: 'stopped', text: 'Let me look.' });
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.file.messages.map((m) => [m.role, 'text' in m ? m.text : m.summary])).toEqual([
      ['user', 'One'],
      ['assistant', 'Let me look.'],
    ]);
  });

  it('opens a saved chat with its quotes checked, and resumes it with its keys', async () => {
    seedProject();
    const saves = folderSaves();
    const { requests, resumed } = fakeAgent([answers('Yes.')]);
    const settings = useSettingsStore();
    const opened = savedChat({ author: { ...settings.chatAuthor } });
    const chat = useChatStore();

    chat.open(opened);
    expect(chat.chatId).toBe(opened.file.id);
    expect(chat.ownerName).toBeNull();
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const first = chat.messages[1] as ChatAssistantMessage;
    expect(first).toMatchObject({ status: 'done', costUsd: 0.2, error: null });
    expect(first.blocks.find((b) => b.kind === 'quote')).toMatchObject({
      ref: 's7/t2',
      sessionId: 'session-1',
      check: { status: 'verified' },
    });
    expect(chat.corpus?.byKey('s7')?.text.sessionId).toBe('session-1');
    expect(chat.model).toBeNull();

    await chat.ask('Even on trips?');
    // Only the answer that finished goes back; the stopped one is left out with its question.
    expect(resumed).toEqual([
      [
        {
          question: 'Where do they charge?',
          answer: 'By the bed.\n<quote ref="s7/t2">I put them on the charger by the bed.</quote>',
        },
      ],
    ]);
    expect((requests[0]!.conversation as unknown as { resumed: unknown }).resumed).toBe(resumed[0]);
    expect(requests[0]!.context).toContain('s7');

    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.file.id).toBe(opened.file.id);
    expect(saves[0]!.expected).toEqual(opened.stat);
    expect(saves[0]!.file.createdAt).toBe(opened.file.createdAt);
    expect(saves[0]!.file.sessionKeys).toEqual({ 'session-1': 's7', 'session-2': 's3' });
    expect(saves[0]!.file.messages).toHaveLength(6);
  });

  it("reads a colleague's chat, and asking saves a copy as yours", async () => {
    seedProject();
    const saves = folderSaves();
    fakeAgent([answers('Yes.')]);
    const opened = savedChat();
    const chat = useChatStore();

    chat.open(opened);
    expect(chat.ownerName).toBe(COLLEAGUE.name);

    await chat.ask('Even on trips?');
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    const copy = saves[0]!;
    expect(copy.expected).toBeNull();
    expect(copy.file.id).not.toBe(opened.file.id);
    expect(copy.file).toMatchObject({
      forkedFrom: opened.file.id,
      title: opened.file.title,
      author: useSettingsStore().chatAuthor,
    });
    expect(copy.file.messages).toHaveLength(6);
    expect(chat.chatId).toBe(copy.file.id);
    expect(chat.ownerName).toBeNull();
  });

  it('keeps fields a newer build added when it saves your chat again (D38)', async () => {
    seedProject();
    const saves = folderSaves();
    fakeAgent([answers('Yes.')]);
    const opened = savedChat({ author: { ...useSettingsStore().chatAuthor } });
    const future = { ...opened, file: withFutureChatFields(opened.file) };
    const chat = useChatStore();

    chat.open(future);
    await chat.ask('Even on trips?');
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    const saved = saves[0]!.file;
    expect(saved).toMatchObject({ ...FUTURE_FIELD, author: FUTURE_FIELD });
    expect(saved.messages.slice(0, 4)).toEqual(future.file.messages);
    expect(saved.messages[5]).not.toHaveProperty('addedLater');
  });

  it("a copy of a colleague's chat keeps what a newer build added to its messages only (D38)", async () => {
    seedProject();
    const saves = folderSaves();
    fakeAgent([answers('Yes.')]);
    const opened = savedChat();
    const future = { ...opened, file: withFutureChatFields(opened.file) };
    const chat = useChatStore();

    chat.open(future);
    await chat.ask('Even on trips?');
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    const copy = saves[0]!.file;
    expect(copy.forkedFrom).toBe(opened.file.id);
    expect(copy).not.toHaveProperty('addedLater');
    expect(copy.author).not.toHaveProperty('addedLater');
    expect(copy.messages.slice(0, 4)).toEqual(future.file.messages);
  });

  it('saves as a copy when the file changed elsewhere since it was read', async () => {
    seedProject();
    const saves = folderSaves([new FolderError('changed', 'Changed.')]);
    fakeAgent([answers('Yes.')]);
    const opened = savedChat({ author: { ...useSettingsStore().chatAuthor } });
    const chat = useChatStore();
    chat.open(opened);
    await chat.ask('More?');
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.expected).toBeNull();
    expect(saves[0]!.file).toMatchObject({ forkedFrom: opened.file.id });
    expect(chat.chatId).toBe(saves[0]!.file.id);
    expect(chat.saveError).toBeNull();
  });

  it('says when a save failed, and saves again on Try again or when access comes back', async () => {
    const { project } = seedProject();
    const saves = folderSaves([
      new FolderError('io', 'Failed.'),
      new FolderError('permission', 'No access.'),
    ]);
    fakeAgent([answers('First.')]);
    const chat = useChatStore();
    await chat.ask('One');
    await vi.waitFor(() => expect(chat.saveError).not.toBeNull());

    await chat.saveAgain();
    expect(saves).toHaveLength(0);
    expect(chat.saveError).not.toBeNull();

    project.status = 'reconnect';
    await Promise.resolve();
    project.status = 'ready';
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(chat.saveError).toBeNull();
  });

  it('opening a chat ends a running answer; opening the open one again changes nothing', async () => {
    seedProject();
    folderSaves();
    fakeAgent([hangs('Half')]);
    const chat = useChatStore();
    const asking = chat.ask('One');
    await Promise.resolve();
    const opened = savedChat();
    chat.open(opened);
    await asking;
    expect(chat.running).toBe(false);
    expect(chat.messages).toHaveLength(4);
    const before = chat.messages;
    chat.open(opened);
    expect(chat.messages).toBe(before);

    chat.newChat();
    expect(chat.chatId).toBeNull();
    expect(chat.ownerName).toBeNull();
    expect(chat.messages).toEqual([]);
  });

  it('opening the open chat again reads it again when its file changed meanwhile (audit BUG-9)', async () => {
    seedProject();
    const saves = folderSaves();
    const { resumed } = fakeAgent([answers('Yes.')]);
    const opened = savedChat({ author: { ...useSettingsStore().chatAuthor } });
    const newer = newerVersion(opened);
    const chat = useChatStore();

    chat.open(opened);
    chat.open(newer);
    expect(chat.chatId).toBe(opened.file.id);
    expect(chat.messages.map((m) => m.id)).toEqual(['q1', 'a1', 'q2', 'a2', 'q3', 'a3']);

    await chat.ask('Even on trips?');
    expect(resumed).toEqual([
      [
        {
          question: 'Where do they charge?',
          answer: 'By the bed.\n<quote ref="s7/t2">I put them on the charger by the bed.</quote>',
        },
        { question: 'At night?', answer: 'Mostly.' },
      ],
    ]);
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.file.id).toBe(opened.file.id);
    expect(saves[0]!.expected).toEqual(newer.stat);
    expect(saves[0]!.file.messages).toHaveLength(8);
  });

  it('opening a newer version of the open chat leaves a running answer running', async () => {
    seedProject();
    folderSaves();
    fakeAgent([hangs('Half')]);
    const opened = savedChat({ author: { ...useSettingsStore().chatAuthor } });
    const chat = useChatStore();
    chat.open(opened);
    const asking = chat.ask('Even on trips?');
    await Promise.resolve();
    const before = chat.messages;

    chat.open(newerVersion(opened));
    expect(chat.running).toBe(true);
    expect(chat.messages).toBe(before);
    chat.stop();
    await asking;
  });

  it('opening a newer version of the open chat keeps an answer that failed to save', async () => {
    seedProject();
    folderSaves([new FolderError('io', 'Failed.')]);
    fakeAgent([answers('Yes.')]);
    const opened = savedChat({ author: { ...useSettingsStore().chatAuthor } });
    const chat = useChatStore();
    chat.open(opened);
    await chat.ask('Even on trips?');
    await vi.waitFor(() => expect(chat.saveError).not.toBeNull());
    const before = chat.messages;

    chat.open(newerVersion(opened));
    expect(chat.messages).toBe(before);
    expect(answer(chat).text).toBe('Yes.');
  });

  it('saves nothing when no answer has ended', async () => {
    seedProject();
    const saves = folderSaves();
    fakeAgent([fails(new ProviderError('server', 'Busy.'))]);
    const chat = useChatStore();
    await chat.ask('One');
    await Promise.resolve();
    expect(saves).toEqual([]);
    expect(chat.chatId).toBeNull();
  });
});

describe('/compact (D33)', () => {
  const SUMMARY = 'You asked who charges: Mary, by the bed.';

  /** A summary run: it reports its usage, then finishes with `text`. */
  const summarises =
    (text: string): Run =>
    async (req) => {
      req.onEvent({ type: 'usage', usage: USAGE });
      req.onEvent({ type: 'text', delta: text });
      return { text, conversation: conversationOf(99), usage: USAGE, stopped: 'done' };
    };

  /** An answer run whose request was `inputTokens` big. */
  const sized =
    (text: string, inputTokens: number): Run =>
    async (req) => {
      req.onEvent({ type: 'usage', usage: { ...USAGE, inputTokens } });
      return { text, conversation: conversationOf(1), usage: USAGE, stopped: 'done' };
    };

  const compaction = (chat: ReturnType<typeof useChatStore>) =>
    chat.messages.find((m) => m.role === 'compaction') as ChatCompactionMessage | undefined;

  it('says there is nothing to compact before an answer, or right after a compaction', async () => {
    seedProject();
    const { requests } = fakeAgent([answers('First.'), summarises(SUMMARY)]);
    const chat = useChatStore();

    await chat.submit('/compact');
    expect(chat.commandNote).toBe(CHAT_MESSAGES.nothingToCompact);
    expect(chat.messages).toEqual([]);
    expect(requests).toEqual([]);

    await chat.submit('Who charges?');
    expect(chat.commandNote).toBeNull();
    await chat.submit('/compact');
    expect(compaction(chat)?.status).toBe('done');
    await chat.submit('/COMPACT');
    expect(chat.commandNote).toBe(CHAT_MESSAGES.nothingToCompact);
    expect(requests).toHaveLength(2);

    chat.newChat();
    expect(chat.commandNote).toBeNull();
  });

  it('summarises on the same context, then the next question goes on from the summary alone', async () => {
    seedProject();
    const saves = folderSaves();
    const { requests, resumed } = fakeAgent([
      sized('First.', AGENT_LIMITS.longChatTokens + 1),
      summarises(SUMMARY),
      answers('After.'),
    ]);
    const chat = useChatStore();

    await chat.submit('Who charges?');
    expect(chat.isLong).toBe(true);
    const compacting = chat.submit('/compact  keep the quotes ');
    expect(chat.running).toBe(true);
    expect(compaction(chat)).toMatchObject({ status: 'running', focus: 'keep the quotes' });
    await compacting;

    const summary = requests[1]!;
    expect(summary.userMessage).toBe(compactPrompt('keep the quotes'));
    expect(summary.context).toBe(requests[0]!.context);
    expect(summary.instructions).toBe(requests[0]!.instructions);
    expect(summary.tools.map((t) => t.name)).toEqual(requests[0]!.tools.map((t) => t.name));
    expect(summary.maxIterations).toBe(AGENT_LIMITS.compactIterations);
    expect((summary.conversation as unknown as { n: number }).n).toBe(1);

    expect(chat.running).toBe(false);
    expect(chat.isLong).toBe(false);
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'compaction']);
    expect(compaction(chat)).toMatchObject({ status: 'done', summary: SUMMARY, error: null });
    expect(compaction(chat)!.costUsd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6);
    expect(compaction(chat)!.blocks.map((b) => b.kind)).toEqual(['paragraph']);
    expect(resumed).toEqual([compactedHistory(SUMMARY)]);

    await chat.submit('And at work?');
    expect(resumedFrom(requests[2]!)).toEqual(compactedHistory(SUMMARY));
    await vi.waitFor(() => expect(saves).toHaveLength(3));
    expect(saves[1]!.file.messages.at(-1)).toMatchObject({
      role: 'compaction',
      summary: SUMMARY,
      focus: 'keep the quotes',
      model: 'claude-sonnet-5-5',
    });
    expect(saves[2]!.file.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'compaction',
      'user',
      'assistant',
    ]);
  });

  it('Stop takes the compaction away, and the chat goes on as before it', async () => {
    seedProject();
    const saves = folderSaves();
    const { requests } = fakeAgent([
      answers('First.', { n: 1 }),
      hangs('Half a summ'),
      answers('Next.'),
    ]);
    const chat = useChatStore();
    await chat.ask('One');
    await vi.waitFor(() => expect(saves).toHaveLength(1));

    const compacting = chat.submit('/compact');
    await Promise.resolve();
    chat.stop();
    await compacting;
    expect(chat.running).toBe(false);
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(saves).toHaveLength(1);

    await chat.ask('Two');
    expect(resumedFrom(requests[2]!)).toEqual([{ question: 'One', answer: 'First.' }]);
  });

  it('shows an error in the compaction, keeps the conversation, and Try again compacts again', async () => {
    seedProject();
    const saves = folderSaves();
    const { requests } = fakeAgent([
      answers('First.', { n: 1 }),
      fails(new ProviderError('server', 'The service is busy.')),
      summarises(SUMMARY),
    ]);
    const chat = useChatStore();
    await chat.ask('One');
    await chat.submit('/compact charging');
    expect(compaction(chat)).toMatchObject({ status: 'error', error: { kind: 'server' } });
    expect(chat.running).toBe(false);
    await Promise.resolve();
    expect(saves).toHaveLength(1);

    await chat.retry();
    expect(requests[2]!.userMessage).toBe(compactPrompt('charging'));
    expect((requests[2]!.conversation as unknown as { n: number }).n).toBe(1);
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'compaction']);
    expect(compaction(chat)?.status).toBe('done');
  });

  it('needs the key again when a compaction was refused for it', async () => {
    seedProject();
    fakeAgent([answers('First.'), fails(new ProviderError('auth', 'Check the Claude API key.'))]);
    const chat = useChatStore();
    await chat.ask('One');
    expect(chat.needsKey).toBe(false);
    await chat.submit('/compact');
    expect(chat.needsKey).toBe(true);
  });

  it('reopens a compacted chat with its divider, and resumes it from the latest summary', async () => {
    seedProject();
    folderSaves();
    const { resumed } = fakeAgent([answers('Yes.')]);
    const base = savedChat({ author: { ...useSettingsStore().chatAuthor } });
    const [q1, a1] = base.file.messages;
    const opened = savedChat({
      author: { ...useSettingsStore().chatAuthor },
      messages: [
        q1!,
        a1!,
        {
          role: 'compaction',
          id: 'c1',
          at: '2026-10-20T14:04:00.000Z',
          summary: 'Old summary.',
          focus: '',
          costUsd: 0.02,
          model: 'claude-sonnet-5-5',
        },
        { role: 'user', id: 'q2', at: '2026-10-20T14:05:00.000Z', text: 'At work?' },
        { ...(a1 as ChatFileAnswer), id: 'a2', text: 'In a drawer.' },
      ],
    });
    const chat = useChatStore();
    chat.open(opened);
    expect(chat.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'compaction',
      'user',
      'assistant',
    ]);
    expect(compaction(chat)).toMatchObject({ status: 'done', summary: 'Old summary.' });

    await chat.ask('Even on trips?');
    expect(resumed).toEqual([
      [
        { question: COMPACTED_LEAD, answer: 'Old summary.' },
        { question: 'At work?', answer: 'In a drawer.' },
      ],
    ]);
  });

  it("compacting a colleague's chat saves a copy as yours, resumed from its text", async () => {
    seedProject();
    const saves = folderSaves();
    const { requests, resumed } = fakeAgent([summarises(SUMMARY)]);
    const opened = savedChat();
    const chat = useChatStore();
    chat.open(opened);

    await chat.submit('/compact');
    expect((requests[0]!.conversation as unknown as { resumed: unknown }).resumed).toBe(resumed[0]);
    expect(resumed[1]).toEqual(compactedHistory(SUMMARY));
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.expected).toBeNull();
    expect(saves[0]!.file.forkedFrom).toBe(opened.file.id);
    expect(saves[0]!.file.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'compaction',
    ]);
  });
});
