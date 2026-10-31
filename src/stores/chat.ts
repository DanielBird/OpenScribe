import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import {
  CHAT_SCHEMA_VERSION,
  chatTitle,
  historyOf,
  parseChatCommand,
  type ChatAuthor,
  type ChatExchange,
  type ChatFile,
  type ChatFileMessage,
  type ChatFileQuestion,
} from '../domain/chat';
import { EMPTY_BRIEF } from '../domain/project';
import type { SessionSummary } from '../domain/summary';
import { parseAnswer, type AnswerBlock } from '../features/agent/answer';
import { askProject } from '../features/agent/ask';
import { compactChat, compactedHistory } from '../features/agent/compact';
import { renderContext } from '../features/agent/context';
import { createCorpusReader, type CorpusReader } from '../features/agent/corpus';
import { AGENT_LIMITS } from '../features/agent/limits';
import { ProviderError } from '../providers/errors';
import { getAgentProvider } from '../providers/index';
import { estimateCostUsd, projectProviderOf } from '../providers/llm/models';
import {
  addUsage,
  NO_USAGE,
  type AgentConversation,
  type AgentEvent,
  type AgentUsage,
} from '../providers/llm/types';
import { FolderError, type FileStat } from '../storage/folder';
import { useProjectStore, type ProjectChat } from './project';
import { useSettingsStore } from './settings';

export interface ChatUserMessage {
  role: 'user';
  id: string;
  text: string;
  /** When it was asked (ISO); saved with the chat. */
  at?: string;
}

/** One tool call, as the answer's details list it. */
export interface ChatActivity {
  tool: string;
  line: string;
  isError: boolean;
}

export interface ChatAssistantMessage {
  role: 'assistant';
  id: string;
  text: string;
  blocks: AnswerBlock[];
  activity: ChatActivity[];
  usage: AgentUsage;
  costUsd: number | null;
  status: 'streaming' | 'done' | 'stopped' | 'limit' | 'error';
  error: ProviderError | null;
  /** When it ended (ISO), and the model that wrote it; saved with the chat. */
  at?: string;
  model?: string;
}

/** A `/compact` (Phase 22, D33): the summary that later questions start from. */
export interface ChatCompactionMessage {
  role: 'compaction';
  id: string;
  summary: string;
  blocks: AnswerBlock[];
  /** What `/compact` was asked to keep; '' for nothing. */
  focus: string;
  usage: AgentUsage;
  costUsd: number | null;
  status: 'running' | 'done' | 'error';
  error: ProviderError | null;
  /** When it ended (ISO), and the model that wrote it; saved with the chat. */
  at?: string;
  model?: string;
}

export type ChatMessage = ChatUserMessage | ChatAssistantMessage | ChatCompactionMessage;

export const CHAT_MESSAGES = {
  unexpected: 'Something went wrong. Try again.',
  notSaved: "DeScribe couldn't save this chat to the project folder.",
  nothingToCompact: 'Nothing to compact yet.',
} as const;

/** What a conversation is frozen with when it starts (PROJECTS.md §5.5): the corpus, its context, the summaries. */
interface Snapshot {
  corpus: CorpusReader;
  context: string;
  /** Session id → its summary's `createdAt` (`null`: none), to notice sessions added or summarised later. */
  summaryStamps: ReadonlyMap<string, string | null>;
}

/**
 * The open chat's file (D29): its id and what stays the same in it, and the stat it was last saved or read with
 * (`null` before it has a file). Saves for a chat go through its own object, so a save that ends after **New chat**
 * still updates the right file.
 */
interface ChatTarget {
  id: string;
  createdAt: string;
  title: string;
  author: ChatAuthor;
  forkedFrom: string | null;
  stat: FileStat | null;
  /** A save failed; the next one, or a reconnect, tries again. */
  dirty: boolean;
}

const now = () => new Date().toISOString();

/** What went wrong, as a `ProviderError` the chat can show. */
function chatError(err: unknown): ProviderError {
  return err instanceof ProviderError
    ? err
    : new ProviderError('unknown', CHAT_MESSAGES.unexpected, {
        detail: err instanceof Error ? err.message : String(err),
      });
}

/**
 * The messages a file keeps: each question with an answer that ended (D29), and each compaction that did (D33).
 * Failed and running ones are left out.
 */
function settledMessages(list: readonly ChatMessage[]): ChatFileMessage[] {
  const kept: ChatFileMessage[] = [];
  list.forEach((message, i) => {
    if (message.role === 'compaction') {
      if (message.status !== 'done') return;
      kept.push({
        role: 'compaction',
        id: message.id,
        at: message.at ?? now(),
        summary: message.summary,
        focus: message.focus,
        costUsd: message.costUsd,
        model: message.model ?? '',
      });
      return;
    }
    const answer = list[i + 1];
    if (message.role !== 'user' || answer?.role !== 'assistant') return;
    if (answer.status !== 'done' && answer.status !== 'limit' && answer.status !== 'stopped')
      return;
    kept.push(
      { role: 'user', id: message.id, at: message.at ?? now(), text: message.text },
      {
        role: 'assistant',
        id: answer.id,
        at: answer.at ?? now(),
        text: answer.text,
        status: answer.status,
        activity: answer.activity,
        costUsd: answer.costUsd,
        model: answer.model ?? '',
      },
    );
  });
  return kept;
}

/**
 * The project chat (Phase 17): one conversation with the project agent. The model (and so its provider, Claude or
 * Gemini), the sessions and the brief are frozen at the first question, so the cached context and the session keys
 * stay the same for the whole chat. Streamed text is parsed into blocks at most once per animation frame.
 *
 * Chats are saved in the project folder (D29) after each answer that ends, and saved ones can be opened again. An
 * opened chat goes on from its questions and answers as text, with its session keys kept. Asking in a colleague's
 * chat saves a copy of your own, so each file has one writer.
 *
 * `/compact` (D33) replaces the conversation with one that starts from the agent's summary of it. The messages stay
 * on screen and in the file, with the compaction among them.
 */
export const useChatStore = defineStore('chat', () => {
  const project = useProjectStore();
  const settings = useSettingsStore();

  const messages = shallowRef<readonly ChatMessage[]>([]);
  /** Frozen at the first question; `null` before it. */
  const model = ref<string | null>(null);
  const snapshot = shallowRef<Snapshot | null>(null);
  /** The size of the latest request, in tokens, for the long-chat notice. */
  const lastRequestTokens = ref(0);
  /** The open chat's id, once it has been saved or was opened; `null` for a new chat. */
  const chatId = ref<string | null>(null);
  /** Who saved the open chat. */
  const owner = shallowRef<ChatAuthor | null>(null);
  /** Why the open chat isn't saved, after a save failed. */
  const saveError = ref<string | null>(null);
  /** Why the last command did nothing; cleared by the next one, or a question. */
  const commandNote = ref<string | null>(null);

  let conversation: AgentConversation | null = null;
  /** An opened chat's questions and answers (after its summary, if any), sent back with its next question. */
  let history: ChatExchange[] = [];
  let target: ChatTarget | null = null;
  let saving: Promise<void> = Promise.resolve();
  let controller: AbortController | null = null;
  let lastQuestion = '';
  /**
   * Ends the running answer as stopped, keeping what was written, or takes the running compaction away. Set while
   * either runs.
   */
  let stopDraft: (() => void) | null = null;

  const last = computed(() => messages.value[messages.value.length - 1] ?? null);
  /** An answer or a compaction is running. */
  const running = computed(() => {
    const m = last.value;
    return (
      (m?.role === 'assistant' && m.status === 'streaming') ||
      (m?.role === 'compaction' && m.status === 'running')
    );
  });

  /** Sessions added, or summarised again, since the chat started. */
  const newSessionCount = computed(() => {
    const stamps = snapshot.value?.summaryStamps;
    if (!stamps) return 0;
    return project.sessions.filter((s) => {
      if (!stamps.has(s.sessionId)) return true;
      const now = s.summary?.createdAt ?? null;
      return now !== null && now !== stamps.get(s.sessionId);
    }).length;
  });
  const modelChanged = computed(
    () => model.value !== null && settings.projectModel !== model.value,
  );
  const isLong = computed(() => lastRequestTokens.value > AGENT_LIMITS.longChatTokens);
  /** The provider of the chat's model, or of the project model for a new chat (DECISIONS.md D26). */
  const provider = computed(() => projectProviderOf(model.value ?? settings.projectModel));
  /** The colleague whose chat is open, or `null` for your own or a new one. Asking saves a copy as yours. */
  const ownerName = computed(() => {
    const o = owner.value;
    return o && o.id !== settings.chatAuthor.id ? o.name : null;
  });

  /** The provider's key is missing, or the last answer or compaction said it doesn't work. */
  const needsKey = computed(() => {
    if (settings.keyFor(provider.value).trim() === '') return true;
    const m = last.value;
    return m !== null && m.role !== 'user' && m.status === 'error' && m.error?.kind === 'auth';
  });

  /** `fixedKeys`: an opened chat's session keys, which its answers' quote refs use. */
  function takeSnapshot(fixedKeys: Readonly<Record<string, string>> = {}): Snapshot {
    const summaries = new Map<string, SessionSummary>();
    const summaryStamps = new Map<string, string | null>();
    for (const s of project.sessions) {
      if (s.summary) summaries.set(s.sessionId, s.summary.summary);
      summaryStamps.set(s.sessionId, s.summary?.createdAt ?? null);
    }
    const corpus = createCorpusReader(project.corpus, summaries, fixedKeys);
    const open = project.project;
    return {
      corpus,
      context: renderContext(open?.name ?? '', open?.brief ?? EMPTY_BRIEF, corpus),
      summaryStamps,
    };
  }

  /** Replaces the last message (the answer being written). */
  function replaceLast(patch: Partial<ChatAssistantMessage>): void {
    const list = messages.value;
    const answer = list[list.length - 1];
    if (answer?.role !== 'assistant') return;
    messages.value = [...list.slice(0, -1), { ...answer, ...patch }];
  }

  /** Replaces the compaction with this id. */
  function patchCompaction(id: string, patch: Partial<ChatCompactionMessage>): void {
    messages.value = messages.value.map((m) =>
      m.id === id && m.role === 'compaction' ? { ...m, ...patch } : m,
    );
  }

  // --- Saving (D29) -------------------------------------------------------------------------------

  /** Writes one version of a chat; on `changed`, as a copy, so nothing is lost. */
  async function write(to: ChatTarget, file: ChatFile): Promise<void> {
    try {
      let saved: ProjectChat;
      try {
        saved = await project.saveChat(file, to.stat);
      } catch (err) {
        if (!(err instanceof FolderError && err.kind === 'changed')) throw err;
        // Someone else's browser wrote this file meanwhile (the same person on another computer).
        Object.assign(to, { id: crypto.randomUUID(), createdAt: now(), forkedFrom: file.id });
        if (to === target) chatId.value = to.id;
        saved = await project.saveChat(
          { ...file, id: to.id, createdAt: to.createdAt, forkedFrom: to.forkedFrom },
          null,
        );
      }
      to.stat = saved.stat;
      to.dirty = false;
      if (to === target) saveError.value = null;
    } catch {
      to.dirty = true;
      if (to === target) saveError.value = CHAT_MESSAGES.notSaved;
    }
  }

  /**
   * Saves the open chat as it is now, after any save already under way. A colleague's chat becomes a copy of your
   * own first. Nothing is saved before an answer has ended.
   */
  function persist(): void {
    const kept = settledMessages(messages.value);
    const current = project.project;
    const corpus = snapshot.value?.corpus;
    const first = kept.find((m): m is ChatFileQuestion => m.role === 'user');
    if (!first || !current || !corpus) return;
    const author = settings.chatAuthor;
    if (!target || target.author.id !== author.id) {
      target = {
        id: crypto.randomUUID(),
        // A copy of a colleague's chat starts now; a new chat, at its first question.
        createdAt: target ? now() : first.at,
        title: target?.title ?? chatTitle(first.text),
        author,
        forkedFrom: target?.id ?? null,
        stat: null,
        dirty: false,
      };
      chatId.value = target.id;
      owner.value = author;
    }
    const to = target;
    to.author = author; // Your name may have changed.
    const file: ChatFile = {
      kind: 'describe.chat',
      schemaVersion: CHAT_SCHEMA_VERSION,
      id: to.id,
      projectId: current.id,
      title: to.title,
      createdAt: to.createdAt,
      updatedAt: now(),
      author: { id: author.id, name: author.name },
      forkedFrom: to.forkedFrom,
      sessionKeys: Object.fromEntries(corpus.sessions.map((s) => [s.text.sessionId, s.key])),
      messages: kept,
    };
    saving = saving.then(() => write(to, file));
  }

  /** **Try again** after a save failed. */
  function saveAgain(): Promise<void> {
    persist();
    return saving;
  }

  // Access came back after it was lost: save what couldn't be saved.
  watch(
    () => project.status,
    (status) => {
      if (status === 'ready' && target?.dirty) persist();
    },
  );

  // --- Asking -------------------------------------------------------------------------------------

  /** What the question box sent: a command (`/compact`, D33) or a question. */
  async function submit(text: string): Promise<void> {
    commandNote.value = null;
    const command = parseChatCommand(text);
    if (command) await compact(command.focus);
    else await ask(text);
  }

  async function ask(question: string): Promise<void> {
    const text = question.trim();
    if (text === '' || running.value) return;

    snapshot.value ??= takeSnapshot();
    model.value ??= settings.projectModel;
    const { corpus, context } = snapshot.value;
    const frozenModel = model.value;
    lastQuestion = text;

    const answerId = crypto.randomUUID();
    messages.value = [
      ...messages.value,
      { role: 'user', id: crypto.randomUUID(), text, at: now() },
      {
        role: 'assistant',
        id: answerId,
        text: '',
        blocks: [],
        activity: [],
        usage: NO_USAGE,
        costUsd: null,
        status: 'streaming',
        error: null,
        model: frozenModel,
      },
    ];

    const ctrl = new AbortController();
    controller = ctrl;
    const isCurrent = () => controller === ctrl && !ctrl.signal.aborted;

    // The answer so far; published at most once per frame.
    let draft = '';
    let activity: ChatActivity[] = [];
    let usage: AgentUsage = NO_USAGE;
    let frame: number | null = null;

    const flush = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (!isCurrent() || last.value?.id !== answerId) return;
      replaceLast({
        text: draft,
        blocks: parseAnswer(draft, corpus, { streaming: true }),
        activity,
        usage,
      });
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(flush);
    };
    stopDraft = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      replaceLast({
        text: draft,
        blocks: parseAnswer(draft, corpus, { streaming: true }),
        activity,
        usage,
        costUsd: estimateCostUsd(frozenModel, usage),
        status: 'stopped',
        at: now(),
      });
      persist();
    };

    const onEvent = (event: AgentEvent) => {
      if (!isCurrent()) return;
      if (event.type === 'text') draft += event.delta;
      else if (event.type === 'tool')
        activity = [
          ...activity,
          { tool: event.name, line: event.activity, isError: event.isError },
        ];
      else {
        usage = addUsage(usage, event.usage);
        const u = event.usage;
        lastRequestTokens.value = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
      }
      schedule();
    };

    try {
      const id = projectProviderOf(frozenModel);
      const agent = getAgentProvider(id, settings.keyFor(id).trim(), frozenModel);
      // An opened chat goes on from its questions and answers (D29).
      if (conversation === null && history.length > 0) conversation = agent.resume(history);
      const result = await askProject({
        provider: agent,
        corpus,
        context,
        conversation,
        question: text,
        signal: ctrl.signal,
        onEvent,
      });
      if (!isCurrent()) return;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      conversation = result.conversation;
      replaceLast({
        text: result.text,
        blocks: result.blocks,
        activity,
        usage: result.usage,
        costUsd: estimateCostUsd(frozenModel, result.usage),
        status: result.stopped === 'limit' ? 'limit' : 'done',
        at: now(),
      });
      persist();
    } catch (err) {
      if (!isCurrent()) return;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      // Text may have streamed before a refusal or a dropped connection: the partial answer goes (Phase 16 Handoff).
      replaceLast({
        text: '',
        blocks: [],
        activity,
        usage,
        costUsd: estimateCostUsd(frozenModel, usage),
        status: 'error',
        error: chatError(err),
      });
    } finally {
      if (controller === ctrl) {
        controller = null;
        stopDraft = null;
      }
    }
  }

  /** An answer that finished since the last compaction: something for `/compact` to summarise. */
  function hasNewAnswers(): boolean {
    for (const m of [...messages.value].reverse()) {
      if (m.role === 'compaction' && m.status === 'done') return false;
      if (m.role === 'assistant' && (m.status === 'done' || m.status === 'limit')) return true;
    }
    return false;
  }

  /**
   * `/compact` (D33): the agent summarises the conversation, and the chat goes on from the summary alone. On an error
   * or **Stop** the conversation is as it was.
   */
  async function compact(focus = ''): Promise<void> {
    if (running.value) return;
    const opened = snapshot.value;
    if (!opened || !hasNewAnswers()) {
      commandNote.value = CHAT_MESSAGES.nothingToCompact;
      return;
    }
    model.value ??= settings.projectModel;
    const { corpus, context } = opened;
    const frozenModel = model.value;

    const entryId = crypto.randomUUID();
    messages.value = [
      ...messages.value,
      {
        role: 'compaction',
        id: entryId,
        summary: '',
        blocks: [],
        focus,
        usage: NO_USAGE,
        costUsd: null,
        status: 'running',
        error: null,
        model: frozenModel,
      },
    ];

    const ctrl = new AbortController();
    controller = ctrl;
    const isCurrent = () => controller === ctrl && !ctrl.signal.aborted;
    let usage: AgentUsage = NO_USAGE;
    stopDraft = () => {
      messages.value = messages.value.filter((m) => m.id !== entryId);
    };

    try {
      const id = projectProviderOf(frozenModel);
      const agent = getAgentProvider(id, settings.keyFor(id).trim(), frozenModel);
      // An opened chat goes on from its questions and answers (D29); `hasNewAnswers` means there are some.
      conversation ??= agent.resume(history);
      const result = await compactChat({
        provider: agent,
        corpus,
        context,
        conversation,
        focus,
        signal: ctrl.signal,
        // The summary isn't shown as it streams; only its cost is kept.
        onEvent: (event) => {
          if (isCurrent() && event.type === 'usage') usage = addUsage(usage, event.usage);
        },
      });
      if (!isCurrent()) return;
      conversation = result.conversation;
      history = [];
      // The next request is small again, and its size will say so.
      lastRequestTokens.value = 0;
      patchCompaction(entryId, {
        summary: result.summary,
        blocks: parseAnswer(result.summary, corpus),
        usage: result.usage,
        costUsd: estimateCostUsd(frozenModel, result.usage),
        status: 'done',
        at: now(),
      });
      persist();
    } catch (err) {
      if (!isCurrent()) return;
      patchCompaction(entryId, {
        usage,
        costUsd: estimateCostUsd(frozenModel, usage),
        status: 'error',
        error: chatError(err),
      });
    } finally {
      if (controller === ctrl) {
        controller = null;
        stopDraft = null;
      }
    }
  }

  /**
   * Ends the running answer at once: it stays as written so far, and the conversation is as before the question. A
   * running compaction goes, and the conversation is as before it.
   */
  function stop(): void {
    if (!controller) return;
    const finish = stopDraft;
    controller.abort();
    controller = null;
    stopDraft = null;
    finish?.();
  }

  /** The last question, or compaction, again after an error. */
  async function retry(): Promise<void> {
    const m = last.value;
    if (running.value || m === null || m.role === 'user' || m.status !== 'error') return;
    if (m.role === 'compaction') {
      messages.value = messages.value.slice(0, -1);
      await compact(m.focus);
      return;
    }
    if (!lastQuestion) return;
    messages.value = messages.value.slice(0, -2);
    await ask(lastQuestion);
  }

  /** Forgets the conversation, and its snapshot: the next question starts afresh. Saved chats stay saved. */
  function newChat(): void {
    controller?.abort();
    controller = null;
    stopDraft = null;
    messages.value = [];
    model.value = null;
    snapshot.value = null;
    conversation = null;
    history = [];
    target = null;
    chatId.value = null;
    owner.value = null;
    saveError.value = null;
    commandNote.value = null;
    lastQuestion = '';
    lastRequestTokens.value = 0;
  }

  /**
   * Opens a saved chat (D29): its messages, with the quotes checked again against the sessions as they are now, and
   * its session keys kept. Its next question sends the earlier ones back as text: from its latest summary, if it was
   * compacted (D33).
   */
  function open(chat: ProjectChat): void {
    if (chatId.value === chat.file.id) return;
    newChat();
    const { file } = chat;
    target = {
      id: file.id,
      createdAt: file.createdAt,
      title: file.title,
      author: file.author,
      forkedFrom: file.forkedFrom,
      stat: chat.stat,
      dirty: false,
    };
    chatId.value = file.id;
    owner.value = file.author;
    const opened = takeSnapshot(file.sessionKeys);
    snapshot.value = opened;
    messages.value = file.messages.map((m): ChatMessage => {
      switch (m.role) {
        case 'user':
          return { role: 'user', id: m.id, text: m.text, at: m.at };
        case 'assistant':
          return {
            role: 'assistant',
            id: m.id,
            text: m.text,
            blocks: parseAnswer(m.text, opened.corpus),
            activity: m.activity,
            usage: NO_USAGE,
            costUsd: m.costUsd,
            status: m.status,
            error: null,
            at: m.at,
            model: m.model,
          };
        case 'compaction':
          return {
            role: 'compaction',
            id: m.id,
            summary: m.summary,
            blocks: parseAnswer(m.summary, opened.corpus),
            focus: m.focus,
            usage: NO_USAGE,
            costUsd: m.costUsd,
            status: 'done',
            error: null,
            at: m.at,
            model: m.model,
          };
      }
    });
    const { summary, exchanges } = historyOf(file.messages);
    history = summary === null ? exchanges : compactedHistory(summary, exchanges);
  }

  // A chat belongs to the project it was started in.
  watch(
    () => project.project?.id,
    (id, before) => {
      if (id !== before) newChat();
    },
  );

  onScopeDispose(() => controller?.abort());

  /** The corpus the current chat reads, for showing its quotes (`null` before the first question). */
  const corpus = computed(() => snapshot.value?.corpus ?? null);

  return {
    messages,
    running,
    model,
    corpus,
    newSessionCount,
    modelChanged,
    isLong,
    provider,
    needsKey,
    chatId,
    ownerName,
    saveError,
    commandNote,
    submit,
    ask,
    compact,
    retry,
    stop,
    newChat,
    open,
    saveAgain,
  };
});
