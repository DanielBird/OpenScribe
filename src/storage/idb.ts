// The latest transcript, autosaved to IndexedDB (DECISIONS.md D10). Audio is never stored.
// IndexedDB can be missing or fail (blocked site data, private mode, quota), so nothing here throws:
// loading falls back to `null` and saving reports whether it worked.
import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { TranscriptDoc } from '../domain/transcript';
import { z } from '../lib/zod';
import type { FileStat } from './folder';
import { STORAGE_PREFIX } from './local';
import { FileStatSchema, TranscriptDocSchema } from './schemas';

const DB_NAME = 'describe-v1';
const STORE_NAME = 'keyval';
const LAST_TRANSCRIPT_KEY = `${STORAGE_PREFIX}lastTranscript`;
const TRANSCRIPT_LINK_KEY = `${STORAGE_PREFIX}lastTranscriptLink`;

/**
 * The project file the last transcript is saved in (DECISIONS.md D25), so the change check survives a reload: the
 * file's stat when Describe last read or wrote it.
 */
export interface TranscriptLink {
  docId: string;
  projectId: string;
  projectName: string;
  fileName: string;
  stat: FileStat;
}

const TranscriptLinkSchema = z.object({
  docId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  fileName: z.string(),
  stat: FileStatSchema,
}) satisfies z.ZodType<TranscriptLink>;

let store: UseStore | null = null;

/**
 * The `describe-v1` database's key-value store, opened on first use. `null` when IndexedDB is unavailable. The
 * project folder's handle is kept here too (`folder.ts`).
 */
export function keyvalStore(): UseStore | null {
  if (store) return store;
  try {
    store = createStore(DB_NAME, STORE_NAME);
  } catch {
    store = null;
  }
  return store;
}

/** The saved transcript, or `null` if there is none, it is from another schema version, or it is damaged. */
export async function loadLastTranscript(): Promise<TranscriptDoc | null> {
  try {
    const s = keyvalStore();
    if (!s) return null;
    const parsed = TranscriptDocSchema.safeParse(await get(LAST_TRANSCRIPT_KEY, s));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Returns whether the transcript was saved. */
export async function saveLastTranscript(doc: TranscriptDoc): Promise<boolean> {
  try {
    const s = keyvalStore();
    if (!s) return false;
    await set(LAST_TRANSCRIPT_KEY, doc, s);
    return true;
  } catch {
    return false;
  }
}

export async function clearLastTranscript(): Promise<void> {
  try {
    const s = keyvalStore();
    if (s) await del(LAST_TRANSCRIPT_KEY, s);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}

/** The last transcript's project link, or `null` if there is none or it is damaged. */
export async function loadTranscriptLink(): Promise<TranscriptLink | null> {
  try {
    const s = keyvalStore();
    if (!s) return null;
    const parsed = TranscriptLinkSchema.safeParse(await get(TRANSCRIPT_LINK_KEY, s));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Saves the link, or removes it (`null`). Returns whether it worked. */
export async function saveTranscriptLink(link: TranscriptLink | null): Promise<boolean> {
  try {
    const s = keyvalStore();
    if (!s) return false;
    if (link) await set(TRANSCRIPT_LINK_KEY, link, s);
    else await del(TRANSCRIPT_LINK_KEY, s);
    return true;
  } catch {
    return false;
  }
}
