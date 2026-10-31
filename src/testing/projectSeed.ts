// Test only: the files of a project folder, as text, for unit tests (memoryFolder) and the e2e folder harness. It
// imports only domain code, so Playwright can import it too.
import {
  CHAT_SCHEMA_VERSION,
  CHATS_DIR,
  chatBaseName,
  chatFileName,
  type ChatFile,
} from '../domain/chat';
import { toSessionText } from '../domain/corpus/sessionText';
import { briefHash, EMPTY_BRIEF, type ProjectBrief, type ProjectFile } from '../domain/project';
import {
  PROJECT_FILE,
  sessionBaseName,
  sessionFileName,
  SESSIONS_DIR,
  type SessionTranscriptFile,
} from '../domain/sessionFiles';
import type { SessionSummaryFile } from '../domain/summary';
import type { TranscriptDoc } from '../domain/transcript';
import { makeSummaryReply } from './summary';

export const TEST_PROJECT_ID = '11111111-2222-4333-8444-555555555555';

export function makeProjectFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    kind: 'describe.project',
    schemaVersion: 1,
    id: TEST_PROJECT_ID,
    name: 'Hearing at home 2026',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    brief: structuredClone(EMPTY_BRIEF),
    ...overrides,
  };
}

export function projectFileText(overrides: Partial<ProjectFile> = {}): string {
  return `${JSON.stringify(makeProjectFile(overrides), null, 2)}\n`;
}

export const TEST_BRIEF: ProjectBrief = {
  researchQuestions: ['How do people fit charging into their day?', 'Who helps them?'],
  context: 'Home visits with hearing-aid users.',
  metadataFields: ['Age', 'Country'],
};

/** `sessions/<base>.transcript.json` for a doc. */
export function transcriptPath(doc: TranscriptDoc): string {
  return `${SESSIONS_DIR}/${sessionFileName(sessionBaseName(doc.source.fileName, doc.id), 'transcript')}`;
}

export function transcriptFileText(doc: TranscriptDoc, savedAt = doc.createdAt): string {
  const file: SessionTranscriptFile = {
    kind: 'describe.transcript',
    schemaVersion: 1,
    savedAt,
    doc,
  };
  return JSON.stringify(file);
}

/** `sessions/<base>.summary.json` for a doc. */
export function summaryPath(doc: TranscriptDoc): string {
  return `${SESSIONS_DIR}/${sessionFileName(sessionBaseName(doc.source.fileName, doc.id), 'summary')}`;
}

/**
 * An up-to-date summary file for a doc (made from its current text and `brief`), quoting its real turns. The
 * session must have English text.
 */
export function makeSummaryFile(
  doc: TranscriptDoc,
  overrides: Partial<SessionSummaryFile> = {},
  brief: ProjectBrief = EMPTY_BRIEF,
): SessionSummaryFile {
  const text = toSessionText(doc);
  return {
    kind: 'describe.summary',
    schemaVersion: 1,
    sessionId: doc.id,
    createdAt: '2026-10-15T10:00:00.000Z',
    model: 'claude-sonnet-5-5',
    provider: 'claude',
    transcriptHash: text.transcriptHash,
    briefHash: briefHash(brief),
    droppedQuotes: 0,
    summary: makeSummaryReply(text, { title: `Summary of ${doc.source.fileName}` }),
    ...overrides,
  };
}

export function summaryFileText(
  doc: TranscriptDoc,
  overrides: Partial<SessionSummaryFile> = {},
  brief: ProjectBrief = EMPTY_BRIEF,
): string {
  return `${JSON.stringify(makeSummaryFile(doc, overrides, brief), null, 2)}\n`;
}

/** A colleague's id and name, as their browser writes them into the chats they save. */
export const COLLEAGUE = { id: 'colleague-browser-id', name: 'Anna' } as const;

/**
 * A saved chat with one question and its answer, by a colleague unless `author` says otherwise. `sessionKeys`
 * should map the sessions its answer quotes.
 */
export function makeChatFile(overrides: Partial<ChatFile> = {}): ChatFile {
  return {
    kind: 'describe.chat',
    schemaVersion: CHAT_SCHEMA_VERSION,
    id: '3f9a1c2e-7b1d-4c3a-9e0f-1234567890ab',
    projectId: TEST_PROJECT_ID,
    title: 'How do people charge them?',
    createdAt: '2026-10-20T14:02:00.000Z',
    updatedAt: '2026-10-20T14:03:00.000Z',
    author: { ...COLLEAGUE },
    forkedFrom: null,
    sessionKeys: {},
    messages: [
      {
        role: 'user',
        id: 'q1',
        at: '2026-10-20T14:02:00.000Z',
        text: 'How do people charge them?',
      },
      {
        role: 'assistant',
        id: 'a1',
        at: '2026-10-20T14:03:00.000Z',
        text: 'Mostly overnight.',
        status: 'done',
        activity: [{ tool: 'search_transcripts', line: 'Searched "charg*"', isError: false }],
        costUsd: 0.12,
        model: 'claude-sonnet-5-5',
      },
    ],
    ...overrides,
  };
}

/** `chats/<base>.chat.json` for a chat. */
export function chatPath(file: ChatFile): string {
  return `${CHATS_DIR}/${chatFileName(chatBaseName(file.createdAt, file.id))}`;
}

export function chatFileText(file: ChatFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A project folder's files: the project file and one transcript file per doc. */
export function projectFiles(
  docs: readonly TranscriptDoc[],
  project: Partial<ProjectFile> = {},
): Record<string, string> {
  const files: Record<string, string> = { [PROJECT_FILE]: projectFileText(project) };
  for (const doc of docs) files[transcriptPath(doc)] = transcriptFileText(doc);
  return files;
}
