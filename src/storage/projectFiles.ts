// Reading and writing the project's own files (PROJECTS.md §5.2): `describe-project.json`, and the session
// transcripts and summaries in `sessions/`. Files are validated when read; a file that doesn't match is reported as
// `invalid`, never repaired (D18).
import {
  EMPTY_BRIEF,
  PROJECT_SCHEMA_VERSION,
  type ProjectBrief,
  type ProjectFile,
} from '../domain/project';
import {
  classifySessionFile,
  PROJECT_FILE,
  SESSION_TRANSCRIPT_SCHEMA_VERSION,
  sessionBaseName,
  sessionFileName,
  SESSIONS_DIR,
  type SessionFileKind,
  type SessionTranscriptFile,
} from '../domain/sessionFiles';
import { SUMMARY_SCHEMA_VERSION, type SessionSummaryFile } from '../domain/summary';
import type { TranscriptDoc } from '../domain/transcript';
import { z } from '../lib/zod';
import { FOLDER_MESSAGES, FolderError, type FileStat, type ProjectFolder } from './folder';
import { SessionSummarySchema, TranscriptDocSchema } from './schemas';

const BriefSchema = z.object({
  researchQuestions: z.array(z.string()),
  context: z.string(),
  metadataFields: z.array(z.string()),
}) satisfies z.ZodType<ProjectBrief>;

export const ProjectFileSchema = z.object({
  kind: z.literal('describe.project'),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  brief: BriefSchema,
}) satisfies z.ZodType<ProjectFile>;

export const SessionTranscriptFileSchema = z.object({
  kind: z.literal('describe.transcript'),
  schemaVersion: z.literal(SESSION_TRANSCRIPT_SCHEMA_VERSION),
  savedAt: z.string(),
  doc: TranscriptDocSchema,
}) satisfies z.ZodType<SessionTranscriptFile>;

export const SessionSummaryFileSchema = z.object({
  kind: z.literal('describe.summary'),
  schemaVersion: z.literal(SUMMARY_SCHEMA_VERSION),
  sessionId: z.string().min(1),
  createdAt: z.string(),
  model: z.string(),
  // Optional, so files from before Phase 19 still read (D18); a provider this build doesn't know reads as missing.
  provider: z.enum(['claude', 'gemini']).optional().catch(undefined),
  transcriptHash: z.string(),
  briefHash: z.string(),
  droppedQuotes: z.number(),
  summary: SessionSummarySchema,
}) satisfies z.ZodType<SessionSummaryFile>;

export interface SessionFileInfo {
  name: string;
  kind: SessionFileKind;
  base: string;
  conflictCopy: boolean;
  stat: FileStat;
}

/** Whether a file is still as it was: same size and same modification time (the cache key, T12). */
export function sameStat(a: FileStat, b: FileStat): boolean {
  return a.size === b.size && a.lastModified === b.lastModified;
}

const sessionPath = (name: string) => `${SESSIONS_DIR}/${name}`;

/** Parses and validates a JSON file's text: `invalid` when it can't be used, never repaired (D18). */
export function parseJsonFile<T>(schema: z.ZodType<T>, text: string, path: string): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FolderError('invalid', FOLDER_MESSAGES.invalid, path);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new FolderError('invalid', FOLDER_MESSAGES.invalid, path);
  return parsed.data;
}

function changed(path: string): FolderError {
  return new FolderError('changed', FOLDER_MESSAGES.changed, path);
}

// --- describe-project.json ----------------------------------------------------------------------------

/** `not_found` when the folder isn't a project; `invalid` when the file can't be used. */
export async function readProject(
  folder: ProjectFolder,
): Promise<{ project: ProjectFile; stat: FileStat }> {
  const { text, stat } = await folder.readText(PROJECT_FILE);
  return { project: parseJsonFile(ProjectFileSchema, text, PROJECT_FILE), stat };
}

/** Writes a new project file with an empty brief. Refuses (`changed`) if the folder already has one. */
export async function createProject(
  folder: ProjectFolder,
  name: string,
): Promise<{ project: ProjectFile; stat: FileStat }> {
  if ((await folder.stat(PROJECT_FILE)) !== null) throw changed(PROJECT_FILE);
  const now = new Date().toISOString();
  const project: ProjectFile = {
    kind: 'describe.project',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    brief: structuredClone(EMPTY_BRIEF),
  };
  const stat = await folder.writeText(PROJECT_FILE, serializeProject(project));
  return { project, stat };
}

/**
 * Writes the project file as given. Refuses (`changed`) if the file changed since `expected` was read, so a
 * colleague's brief is never overwritten without a choice.
 */
export async function writeProject(
  folder: ProjectFolder,
  project: ProjectFile,
  expected: FileStat,
): Promise<FileStat> {
  const current = await folder.stat(PROJECT_FILE);
  if (current === null || !sameStat(current, expected)) throw changed(PROJECT_FILE);
  return folder.writeText(PROJECT_FILE, serializeProject(project));
}

/** Indented: people may open this one file to see what it holds. */
function serializeProject(project: ProjectFile): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

// --- sessions/ ----------------------------------------------------------------------------------------

/**
 * The transcript and summary files in `sessions/`, with their sizes and dates, sorted by name. Other files are
 * ignored. A project with no `sessions/` folder yet has none.
 */
export async function listSessionFiles(folder: ProjectFolder): Promise<SessionFileInfo[]> {
  let entries;
  try {
    entries = await folder.list(SESSIONS_DIR);
  } catch (err) {
    if (err instanceof FolderError && err.kind === 'not_found') return [];
    throw err;
  }
  const files: SessionFileInfo[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    const info = classifySessionFile(entry.name);
    if (!info) continue;
    const stat = await folder.stat(sessionPath(entry.name));
    if (stat === null) continue; // removed since the listing
    files.push({ name: entry.name, ...info, stat });
  }
  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Reads and validates a transcript file in `sessions/`. `invalid` when it can't be used. */
export async function readTranscriptFile(
  folder: ProjectFolder,
  name: string,
): Promise<{ file: SessionTranscriptFile; stat: FileStat }> {
  const path = sessionPath(name);
  const { text, stat } = await folder.readText(path);
  return { file: parseJsonFile(SessionTranscriptFileSchema, text, path), stat };
}

/**
 * Writes a transcript file, by default under the name made from the recording and the session id. `expected`:
 * leave it out for no check, `null` when the file must not exist yet, or the stat it must still have (`changed`
 * otherwise).
 */
export async function writeTranscriptFile(
  folder: ProjectFolder,
  doc: TranscriptDoc,
  opts: { name?: string; expected?: FileStat | null } = {},
): Promise<{ name: string; stat: FileStat; savedAt: string }> {
  const name =
    opts.name ?? sessionFileName(sessionBaseName(doc.source.fileName, doc.id), 'transcript');
  const path = sessionPath(name);
  if (opts.expected !== undefined) {
    const current = await folder.stat(path);
    const unchanged =
      opts.expected === null
        ? current === null
        : current !== null && sameStat(current, opts.expected);
    if (!unchanged) throw changed(path);
  }
  const file: SessionTranscriptFile = {
    kind: 'describe.transcript',
    schemaVersion: SESSION_TRANSCRIPT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    doc,
  };
  // Not indented: with word timings these files are large, and only Describe reads them.
  const stat = await folder.writeText(path, JSON.stringify(file));
  return { name, stat, savedAt: file.savedAt };
}

/** Reads and validates a summary file in `sessions/`. `invalid` when it can't be used. */
export async function readSummaryFile(
  folder: ProjectFolder,
  name: string,
): Promise<{ file: SessionSummaryFile; stat: FileStat }> {
  const path = sessionPath(name);
  const { text, stat } = await folder.readText(path);
  return { file: parseJsonFile(SessionSummaryFileSchema, text, path), stat };
}

/**
 * Writes a summary file under `name`. There is no change check: a summary is regenerated, never edited, so the
 * newest one wins (PROJECTS.md §5.2).
 */
export async function writeSummaryFile(
  folder: ProjectFolder,
  file: SessionSummaryFile,
  name: string,
): Promise<{ name: string; stat: FileStat }> {
  // Indented: summaries are small.
  const stat = await folder.writeText(sessionPath(name), `${JSON.stringify(file, null, 2)}\n`);
  return { name, stat };
}
