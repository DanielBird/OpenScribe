// Reading and writing saved chats in the project folder's `chats/` (DECISIONS.md D29). Files are validated when
// read; a file that doesn't match is reported as `invalid`, never repaired (D18).
import {
  CHAT_SCHEMA_VERSION,
  CHATS_DIR,
  chatBaseName,
  chatFileName,
  classifyChatFile,
  type ChatFile,
} from '../domain/chat';
import { z } from '../lib/zod';
import { FOLDER_MESSAGES, FolderError, type FileStat, type ProjectFolder } from './folder';
import { parseJsonFile, sameStat } from './projectFiles';

const ChatQuestionSchema = z.object({
  role: z.literal('user'),
  id: z.string().min(1),
  at: z.string(),
  text: z.string(),
});

const ChatAnswerSchema = z.object({
  role: z.literal('assistant'),
  id: z.string().min(1),
  at: z.string(),
  text: z.string(),
  status: z.enum(['done', 'limit', 'stopped']),
  activity: z.array(z.object({ tool: z.string(), line: z.string(), isError: z.boolean() })),
  costUsd: z.number().nullable(),
  model: z.string(),
});

const ChatCompactionSchema = z.object({
  role: z.literal('compaction'),
  id: z.string().min(1),
  at: z.string(),
  summary: z.string(),
  focus: z.string(),
  costUsd: z.number().nullable(),
  model: z.string(),
});

export const ChatFileSchema = z.object({
  kind: z.literal('describe.chat'),
  schemaVersion: z.literal(CHAT_SCHEMA_VERSION),
  id: z.string().min(1),
  projectId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: z.object({ id: z.string().min(1), name: z.string() }),
  forkedFrom: z.string().nullable(),
  sessionKeys: z.record(z.string(), z.string()),
  messages: z.array(
    z.discriminatedUnion('role', [ChatQuestionSchema, ChatAnswerSchema, ChatCompactionSchema]),
  ),
}) satisfies z.ZodType<ChatFile>;

export interface ChatFileInfo {
  name: string;
  base: string;
  conflictCopy: boolean;
  stat: FileStat;
}

const chatPath = (name: string) => `${CHATS_DIR}/${name}`;

/** A chat's file name: from when it started and its id, so it never changes. */
export function chatFileNameOf(file: ChatFile): string {
  return chatFileName(chatBaseName(file.createdAt, file.id));
}

/**
 * The chat files in `chats/`, with their sizes and dates, sorted by name. Other files are ignored. A project with no
 * `chats/` folder yet has none.
 */
export async function listChatFiles(folder: ProjectFolder): Promise<ChatFileInfo[]> {
  let entries;
  try {
    entries = await folder.list(CHATS_DIR);
  } catch (err) {
    if (err instanceof FolderError && err.kind === 'not_found') return [];
    throw err;
  }
  const files: ChatFileInfo[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    const info = classifyChatFile(entry.name);
    if (!info) continue;
    const stat = await folder.stat(chatPath(entry.name));
    if (stat === null) continue; // removed since the listing
    files.push({ name: entry.name, ...info, stat });
  }
  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Reads and validates a chat file in `chats/`. `invalid` when it can't be used. */
export async function readChatFile(
  folder: ProjectFolder,
  name: string,
): Promise<{ file: ChatFile; stat: FileStat }> {
  const path = chatPath(name);
  const { text, stat } = await folder.readText(path);
  return { file: parseJsonFile(ChatFileSchema, text, path), stat };
}

/**
 * Writes a chat under the name made from its start and id. `expected` is `null` when the file must not exist yet,
 * or the stat it must still have (`changed` otherwise). Indented: people may open these files.
 */
export async function writeChatFile(
  folder: ProjectFolder,
  file: ChatFile,
  expected: FileStat | null,
): Promise<{ name: string; stat: FileStat }> {
  const name = chatFileNameOf(file);
  const path = chatPath(name);
  const current = await folder.stat(path);
  const unchanged =
    expected === null ? current === null : current !== null && sameStat(current, expected);
  if (!unchanged) throw new FolderError('changed', FOLDER_MESSAGES.changed, path);
  const stat = await folder.writeText(path, `${JSON.stringify(file, null, 2)}\n`);
  return { name, stat };
}
