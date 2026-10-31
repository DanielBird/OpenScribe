// File names in a project folder (PROJECTS.md §5.2, reference/file-system-access.md "Rules for Phase 14"):
//   describe-project.json
//   sessions/P07-Hamburg-home-visit--3f9a1c2e.transcript.json
//   sessions/P07-Hamburg-home-visit--3f9a1c2e.summary.json
//   sessions/P07-Hamburg-home-visit--3f9a1c2e.summary-LAPTOP-123.json   (a OneDrive conflict copy)
// A session is identified by the id inside its files, never by the name.
import type { TranscriptDoc } from './transcript';

export const PROJECT_FILE = 'describe-project.json';
export const SESSIONS_DIR = 'sessions';

export type SessionFileKind = 'transcript' | 'summary';

export const SESSION_TRANSCRIPT_SCHEMA_VERSION = 1 as const;

/** `sessions/<base>.transcript.json` (PROJECTS.md §5.2). The doc is schema v1, unchanged. */
export interface SessionTranscriptFile {
  kind: 'describe.transcript';
  schemaVersion: typeof SESSION_TRANSCRIPT_SCHEMA_VERSION;
  savedAt: string; // ISO; the newest wins among copies of one session
  doc: TranscriptDoc;
}

/** The longest the recording's part of a base name can be, in characters. */
export const BASE_NAME_MAX = 60;

const COMBINING_MARKS = /\p{M}/gu;
/** Anything that isn't a letter, a digit, `-` or `_`. */
const NOT_ALLOWED = /[^\p{L}\p{N}_-]+/gu;

/** The name without its extension: the text from the last dot, if something comes before it. */
function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The base of a session's file names: the recording's name made safe for a file name, then `--` and the first 8
 * characters of the session id. Accents are removed; letters (in any script), digits, `-` and `_` are kept; every
 * other run of characters becomes one `-`. At most 60 characters before the id, and `session` if nothing is left.
 * The result has no dots, so `classifySessionFile` can find the kind after it.
 */
export function sessionBaseName(recordingName: string, sessionId: string): string {
  const slug = withoutExtension(recordingName)
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/ß/g, 'ss')
    .replace(NOT_ALLOWED, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  // Cut by code points, so a letter outside the BMP isn't split in half; a cut can leave a trailing `-`.
  const cut = [...slug].slice(0, BASE_NAME_MAX).join('').replace(/-+$/, '');
  const id = sessionId.replace(NOT_ALLOWED, '').slice(0, 8);
  return `${cut || 'session'}--${id}`;
}

export function sessionFileName(base: string, kind: SessionFileKind): string {
  return `${base}.${kind}.json`;
}

export interface SessionFileName {
  kind: SessionFileKind;
  base: string;
  /** Something sits between the kind and `.json`: a OneDrive conflict copy (`-LAPTOP-123`), Explorer's ` - Copy`, … */
  conflictCopy: boolean;
}

// `<base>.<kind><extra>.json`. Base names have no dots; a copy's extra is anything, including more dots.
const SESSION_FILE = /^([^.]+)\.(transcript|summary)(.*)\.json$/i;

/**
 * What a file in `sessions/` is: a transcript or a summary, its base name, and whether it's a conflict copy.
 * Everything else is `null` and ignored, including swap files (`*.crswap`) and names such as `x.json.txt`.
 */
export function classifySessionFile(name: string): SessionFileName | null {
  const match = SESSION_FILE.exec(name);
  if (!match) return null;
  const [, base = '', kind = '', extra = ''] = match;
  return {
    kind: kind.toLowerCase() === 'transcript' ? 'transcript' : 'summary',
    base,
    conflictCopy: extra !== '',
  };
}
