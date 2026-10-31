// Saved chats with the project agent (DECISIONS.md D27): one file per chat in the project folder's `chats/`.
//   chats/2026-10-27-1402--3f9a1c2e.chat.json
//   chats/2026-10-27-1402--3f9a1c2e.chat-LAPTOP-123.json   (a OneDrive conflict copy)
// A chat is identified by the id inside its file, never by the name. Each file has one writer: its author's
// browser. Asking in a colleague's chat saves a copy (`forkedFrom`).

export const CHATS_DIR = 'chats';
export const CHAT_SCHEMA_VERSION = 1 as const;

/** The longest a chat's title can be, in characters. */
export const CHAT_TITLE_MAX = 80;

export interface ChatFileQuestion {
  role: 'user';
  id: string;
  at: string; // ISO
  text: string;
}

/** An answer as it is saved: only answers that ended (never one streaming or failed). */
export interface ChatFileAnswer {
  role: 'assistant';
  id: string;
  at: string; // ISO
  text: string; // as the model wrote it, quote tags included; quotes are checked again when the chat opens
  status: 'done' | 'limit' | 'stopped';
  activity: { tool: string; line: string; isError: boolean }[];
  costUsd: number | null;
  model: string;
}

/**
 * A compaction (Phase 22, D33): the agent's summary of the chat before it. A resumed chat starts from the latest one,
 * with the questions and answers after it.
 */
export interface ChatFileCompaction {
  role: 'compaction';
  id: string;
  at: string; // ISO
  summary: string; // as the model wrote it, quote tags included
  focus: string; // what `/compact` was asked to keep; '' for nothing
  costUsd: number | null;
  model: string;
}

export type ChatFileMessage = ChatFileQuestion | ChatFileAnswer | ChatFileCompaction;

/** Who saved a chat: an id kept in their browser (not a person), and the name they go by. */
export interface ChatAuthor {
  id: string;
  name: string;
}

/** `chats/<base>.chat.json` (D27). */
export interface ChatFile {
  kind: 'describe.chat';
  schemaVersion: typeof CHAT_SCHEMA_VERSION;
  id: string; // uuid
  projectId: string;
  title: string; // the first question, on one line
  createdAt: string; // ISO
  updatedAt: string; // ISO; the last answer, which orders the list (newest first)
  author: ChatAuthor;
  forkedFrom: string | null; // the id of the colleague's chat this one continues
  /** Session id → its key (`s1…sN`) in this chat, so the quote refs in its answers keep their meaning. */
  sessionKeys: Record<string, string>;
  messages: ChatFileMessage[];
}

/** One question and its answer, as a resumed chat sends them back to the model. */
export interface ChatExchange {
  question: string;
  answer: string;
}

/**
 * The base of a chat's file name: when it started (UTC, `YYYY-MM-DD-HHmm`), then `--` and the first 8 characters
 * of its id. It never changes, has no dots, and sorts by date in Explorer.
 */
export function chatBaseName(createdAt: string, chatId: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(createdAt);
  const when = match ? `${match[1]}-${match[2]}${match[3]}` : 'chat';
  const id = chatId.replace(/[^\p{L}\p{N}_-]+/gu, '').slice(0, 8);
  return `${when}--${id}`;
}

export function chatFileName(base: string): string {
  return `${base}.chat.json`;
}

export interface ChatFileName {
  base: string;
  /** Something sits between `.chat` and `.json`: a OneDrive conflict copy (`-LAPTOP-123`), Explorer's ` - Copy`, … */
  conflictCopy: boolean;
}

// `<base>.chat<extra>.json`. Base names have no dots; a copy's extra is anything, including more dots.
const CHAT_FILE = /^([^.]+)\.chat(.*)\.json$/i;

/** What a file in `chats/` is. Everything else is `null` and ignored, including swap files (`*.crswap`). */
export function classifyChatFile(name: string): ChatFileName | null {
  const match = CHAT_FILE.exec(name);
  if (!match) return null;
  const [, base = '', extra = ''] = match;
  return { base, conflictCopy: extra !== '' };
}

/** A chat's title: its first question on one line, cut at `CHAT_TITLE_MAX` characters with `…`. */
export function chatTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim();
  const chars = [...line];
  if (chars.length <= CHAT_TITLE_MAX) return line;
  return `${chars
    .slice(0, CHAT_TITLE_MAX - 1)
    .join('')
    .trimEnd()}…`;
}

/** What a resumed chat sends back: the latest compaction's summary (`null`: none), then the exchanges after it. */
export interface ChatHistory {
  summary: string | null;
  exchanges: ChatExchange[];
}

/**
 * A saved chat's history (D29, D33). The exchanges after the latest compaction are each question followed by an
 * answer that finished (`done` or `limit`). A stopped answer is left out with its question, as the live conversation
 * leaves it out.
 */
export function historyOf(messages: readonly ChatFileMessage[]): ChatHistory {
  let summary: string | null = null;
  let exchanges: ChatExchange[] = [];
  messages.forEach((message, i) => {
    if (message.role === 'compaction') {
      summary = message.summary;
      exchanges = [];
      return;
    }
    const answer = messages[i + 1];
    if (message.role !== 'user' || answer?.role !== 'assistant') return;
    if (answer.status === 'done' || answer.status === 'limit') {
      exchanges.push({ question: message.text, answer: answer.text });
    }
  });
  return { summary, exchanges };
}

/** A command typed in the question box instead of a question (Phase 22). */
export interface ChatCommand {
  kind: 'compact';
  /** The text after the command: what the summary should keep. '' for nothing. */
  focus: string;
}

// `/compact`, alone or followed by whitespace and anything else; `/compactly` is a question.
const COMPACT_COMMAND = /^\/compact(?:\s+([\s\S]*))?$/i;

/** The command in `text`, or `null` when it is a question. */
export function parseChatCommand(text: string): ChatCommand | null {
  const match = COMPACT_COMMAND.exec(text.trim());
  if (!match) return null;
  return { kind: 'compact', focus: (match[1] ?? '').trim() };
}

const ADJECTIVES = [
  'Amber',
  'Bright',
  'Calm',
  'Clever',
  'Coral',
  'Gentle',
  'Golden',
  'Hazel',
  'Indigo',
  'Jade',
  'Kind',
  'Lively',
  'Lucky',
  'Mellow',
  'Misty',
  'Nimble',
  'Olive',
  'Quiet',
  'Rosy',
  'Silver',
  'Sunny',
  'Swift',
  'Teal',
  'Witty',
] as const;

const ANIMALS = [
  'Badger',
  'Beaver',
  'Crane',
  'Dolphin',
  'Falcon',
  'Finch',
  'Fox',
  'Hare',
  'Heron',
  'Ibis',
  'Koala',
  'Lark',
  'Lynx',
  'Marten',
  'Moose',
  'Otter',
  'Owl',
  'Panda',
  'Puffin',
  'Robin',
  'Seal',
  'Swan',
  'Tern',
  'Wren',
] as const;

function pick<T>(list: readonly T[], random: () => number): T {
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(random() * list.length)));
  return list[i] as T;
}

/** A name for someone who hasn't given one, e.g. "Amber Heron". `random` returns [0, 1), as `Math.random`. */
export function randomAuthorName(random: () => number): string {
  return `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`;
}
