// The corpus as the project agent sees it (PROJECTS.md §5.5): every session with its short key (`s1…sN`), its
// title, its text and its summary, prepared once for search.
import { assignSessionKeys } from '../../domain/corpus/sessionKeys';
import type { Query } from '../../domain/corpus/query';
import {
  prepareCorpus,
  search,
  type SearchOptions,
  type SearchResult,
} from '../../domain/corpus/search';
import type { SessionText } from '../../domain/corpus/sessionText';
import type { SessionSummary } from '../../domain/summary';

export interface CorpusSession {
  key: string; // 's1'…'sN'
  title: string; // the summary's title, or the recording's file name
  text: SessionText;
  summary: SessionSummary | null;
}

export interface CorpusReader {
  /** In key order: oldest recording first. */
  readonly sessions: readonly CorpusSession[];
  byKey(key: string): CorpusSession | undefined;
  byId(sessionId: string): CorpusSession | undefined;
  search(query: Query, options: SearchOptions): SearchResult;
}

/**
 * `summaries` is keyed by session id. Sessions without one are still searched and read. `fixedKeys` are a saved
 * chat's session keys, kept when it is resumed (`assignSessionKeys`).
 */
export function createCorpusReader(
  texts: readonly SessionText[],
  summaries: ReadonlyMap<string, SessionSummary>,
  fixedKeys: Readonly<Record<string, string>> = {},
): CorpusReader {
  const keys = assignSessionKeys(texts, fixedKeys);
  const sessions = texts
    .map((text): CorpusSession => {
      const summary = summaries.get(text.sessionId) ?? null;
      return {
        key: keys.get(text.sessionId) ?? '',
        title: summary?.title.trim() || text.recordingName,
        text,
        summary,
      };
    })
    .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
  const byKey = new Map(sessions.map((s) => [s.key, s]));
  const byId = new Map(sessions.map((s) => [s.text.sessionId, s]));
  const searchable = prepareCorpus(sessions.map((s) => s.text));

  return {
    sessions,
    byKey: (key) => byKey.get(key.trim().toLowerCase()),
    byId: (sessionId) => byId.get(sessionId),
    search: (query, options) => search(searchable, query, options),
  };
}
