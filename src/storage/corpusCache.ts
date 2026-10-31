// The session-text cache (DECISIONS.md T12): each computer reads a project's transcript files once, and keeps their
// text here, keyed by project id and file name, with the size and modification time it was made from. OneDrive keeps
// both when it frees or downloads a file (reference/file-system-access.md F8), so a hit means the file is unchanged.
// Its own database, because idb-keyval can't add a store to `describe-v1`. Without IndexedDB every read is a miss,
// so a project still loads, just more slowly.
import { clear, createStore, delMany, get, keys, set, type UseStore } from 'idb-keyval';
import type { SessionText } from '../domain/corpus/sessionText';
import { z } from '../lib/zod';
import type { FileStat } from './folder';
import { SessionTextSchema } from './schemas';

const DB_NAME = 'describe-v1-corpus';
const STORE_NAME = 'sessions';

/** What the cache keeps for a transcript file: its text, and the `savedAt` that decides between copies. */
export interface CachedSession {
  savedAt: string;
  text: SessionText;
}

const EntrySchema = z.object({
  size: z.number(),
  lastModified: z.number(),
  savedAt: z.string(),
  text: SessionTextSchema,
});

let store: UseStore | null = null;

function getStore(): UseStore | null {
  if (store) return store;
  try {
    store = createStore(DB_NAME, STORE_NAME);
  } catch {
    store = null;
  }
  return store;
}

const keyOf = (projectId: string, file: string) => `${projectId}/${file}`;

/** The cached text of a file, or `null` if there is none, the file has changed, or the entry is damaged. */
export async function getCachedSession(
  projectId: string,
  file: string,
  stat: FileStat,
): Promise<CachedSession | null> {
  try {
    const s = getStore();
    if (!s) return null;
    const parsed = EntrySchema.safeParse(await get(keyOf(projectId, file), s));
    if (!parsed.success) return null;
    const entry = parsed.data;
    if (entry.size !== stat.size || entry.lastModified !== stat.lastModified) return null;
    return { savedAt: entry.savedAt, text: entry.text };
  } catch {
    return null;
  }
}

export async function putCachedSession(
  projectId: string,
  file: string,
  stat: FileStat,
  session: CachedSession,
): Promise<void> {
  try {
    const s = getStore();
    if (!s) return;
    const entry: z.infer<typeof EntrySchema> = {
      size: stat.size,
      lastModified: stat.lastModified,
      savedAt: session.savedAt,
      text: session.text,
    };
    await set(keyOf(projectId, file), entry, s);
  } catch {
    // Not cached: the file is read again next time.
  }
}

/** Removes the project's entries for files that are no longer in `keep`. Other projects' entries stay. */
export async function pruneCorpusCache(projectId: string, keep: readonly string[]): Promise<void> {
  try {
    const s = getStore();
    if (!s) return;
    const prefix = keyOf(projectId, '');
    const kept = new Set(keep.map((file) => keyOf(projectId, file)));
    const gone = (await keys(s)).filter(
      (key) => typeof key === 'string' && key.startsWith(prefix) && !kept.has(key),
    );
    if (gone.length > 0) await delMany(gone, s);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}

/** Empties the cache for every project (Clear saved data). */
export async function clearCorpusCache(): Promise<void> {
  try {
    const s = getStore();
    if (s) await clear(s);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}
