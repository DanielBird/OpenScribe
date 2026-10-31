// Keyword search over many sessions (PROJECTS.md §5.4, DECISIONS.md T12): a scan over every turn's normalised
// text, like grep, with no index to build or keep up to date. The researchers' search box and the agent's
// search tool both use it.
import { matchString, wordsWithOffsets, type MatchWord } from './normalize';
import type { Query, TermPattern } from './query';
import { englishText, isEnglishSession, type SessionText } from './sessionText';

export type SearchField = 'english' | 'original' | 'both';

export interface SearchOptions {
  field: SearchField;
  sessionIds?: readonly string[]; // default: all
  maxHitsPerSession: number;
  offset?: number; // in sessions; default 0
  limit?: number; // sessions per page; default all
}

export interface SearchHit {
  turnId: string;
  start: number;
  speakerId: string;
  field: 'english' | 'original';
  snippet: string;
  marks: [start: number, end: number][]; // within snippet
  turnText: string; // the whole text the snippet is from: the translation for an English hit
  turnMarks: [start: number, end: number][]; // within turnText
  // The snippet's words within turnText: the snippet is turnText.slice(snippetStart, snippetEnd), with `…` where the
  // turn goes on.
  snippetStart: number;
  snippetEnd: number;
}

export interface SessionHits {
  sessionId: string;
  hitCount: number;
  hits: SearchHit[];
}

export interface SearchResult {
  totalHits: number;
  totalSessions: number;
  sessions: SessionHits[];
  nextOffset: number | null;
}

/** Words of context shown either side of the first match in a snippet. */
export const SNIPPET_CONTEXT_WORDS = 12;

interface PreparedSession {
  readonly session: SessionText;
  /** Per turn: the `matchString` of its English text, or `null` if it has none yet. */
  readonly english: readonly (string | null)[];
  /** Per turn: the `matchString` of its original text. The same string as `english` in an English session. */
  readonly original: readonly string[];
}

/** Sessions prepared for `search()` by `prepareCorpus()`. Its fields are internal to this module. */
export interface SearchableCorpus {
  readonly sessions: readonly PreparedSession[];
}

/**
 * Prepared sessions, by `SessionText` object. A `SessionText` is never changed once made, so a corpus rebuilt
 * after a rescan only normalises the sessions that are new.
 */
const preparedSessions = new WeakMap<SessionText, PreparedSession>();

function prepareSession(session: SessionText): PreparedSession {
  const cached = preparedSessions.get(session);
  if (cached) return cached;
  const isEnglish = isEnglishSession(session);
  const original = session.turns.map((turn) => matchString(turn.text));
  const english = session.turns.map((turn, i) => {
    const text = turn.en ?? (isEnglish ? turn.text : null); // englishText(), without the per-turn language check
    if (text === null) return null;
    return text === turn.text ? original[i] : matchString(text);
  });
  const prepared: PreparedSession = { session, english, original };
  preparedSessions.set(session, prepared);
  return prepared;
}

/** Normalises every turn once, so `search()` only scans. Rebuild it when the sessions change. */
export function prepareCorpus(sessions: readonly SessionText[]): SearchableCorpus {
  return { sessions: sessions.map(prepareSession) };
}

function matches(text: string, query: Query): boolean {
  for (const clause of query.clauses) {
    if (!clause.some((pattern) => text.includes(pattern.needle))) return false;
  }
  return !query.exclusions.some((pattern) => text.includes(pattern.needle));
}

/** Which text of a turn the query matches, preferring English, or `null`. */
function matchTurn(
  prepared: PreparedSession,
  index: number,
  query: Query,
  field: SearchField,
): SearchHit['field'] | null {
  const english = prepared.english[index];
  const original = prepared.original[index];
  if (field !== 'original' && english !== null && matches(english, query)) return 'english';
  // In an English session both are the same text, already tested.
  if (field === 'original' || (field === 'both' && english !== original)) {
    if (matches(original, query)) return 'original';
  }
  return null;
}

function patternAt(words: readonly MatchWord[], index: number, pattern: TermPattern): boolean {
  const last = pattern.words.length - 1;
  for (let k = 0; k <= last; k++) {
    const word = words[index + k]?.word;
    const target = pattern.words[k] ?? '';
    if (word === undefined) return false;
    if (k === last && pattern.prefix ? !word.startsWith(target) : word !== target) return false;
  }
  return true;
}

/** Every run of words matched by one of the query's terms, as `[first, last]` word indexes, in text order. */
function matchedRuns(words: readonly MatchWord[], query: Query): [number, number][] {
  const runs: [number, number][] = [];
  for (const pattern of query.clauses.flat()) {
    for (let i = 0; i + pattern.words.length <= words.length; i++) {
      if (patternAt(words, i, pattern)) runs.push([i, i + pattern.words.length - 1]);
    }
  }
  return runs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * The runs within words `from`–`to` as character ranges, moved by `shift` and merged where they overlap or touch.
 */
function markRanges(
  words: readonly MatchWord[],
  runs: readonly [number, number][],
  from: number,
  to: number,
  shift: number,
): [number, number][] {
  const marks: [number, number][] = [];
  for (const [a, b] of runs) {
    if (b < from || a > to) continue;
    const start = (words[Math.max(a, from)]?.start ?? 0) + shift;
    const end = (words[Math.min(b, to)]?.end ?? 0) + shift;
    const previous = marks[marks.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else marks.push([start, end]);
  }
  return marks;
}

/**
 * About `SNIPPET_CONTEXT_WORDS` words either side of the first match, cut at word boundaries and marked with `…`
 * where the turn goes on. `marks` are the matched ranges within the snippet; `turnMarks`, within the whole text.
 */
function makeSnippet(
  text: string,
  query: Query,
): Pick<SearchHit, 'snippet' | 'marks' | 'turnText' | 'turnMarks' | 'snippetStart' | 'snippetEnd'> {
  const words = wordsWithOffsets(text);
  const lastWord = words.length - 1;
  if (lastWord < 0) {
    return {
      snippet: text,
      marks: [],
      turnText: text,
      turnMarks: [],
      snippetStart: 0,
      snippetEnd: text.length,
    };
  }
  const runs = matchedRuns(words, query);
  const [firstStart, firstEnd] = runs[0] ?? [0, 0];
  const from = Math.max(0, firstStart - SNIPPET_CONTEXT_WORDS);
  const to = Math.min(lastWord, firstEnd + SNIPPET_CONTEXT_WORDS);

  const sliceStart = from === 0 ? 0 : (words[from]?.start ?? 0);
  const sliceEnd = to === lastWord ? text.length : (words[to]?.end ?? text.length);
  const lead = from === 0 ? '' : '…';
  const snippet = `${lead}${text.slice(sliceStart, sliceEnd)}${to === lastWord ? '' : '…'}`;
  return {
    snippet,
    marks: markRanges(words, runs, from, to, lead.length - sliceStart),
    turnText: text,
    turnMarks: markRanges(words, runs, 0, lastWord, 0),
    snippetStart: sliceStart,
    snippetEnd: sliceEnd,
  };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface SessionMatch {
  prepared: PreparedSession;
  hitCount: number;
  hits: { index: number; field: SearchHit['field'] }[]; // the first maxHitsPerSession
}

function toHit(
  prepared: PreparedSession,
  hit: SessionMatch['hits'][number],
  query: Query,
): SearchHit {
  const { session } = prepared;
  const turn = session.turns[hit.index];
  if (!turn) throw new Error(`search: no turn ${hit.index}`);
  const text = hit.field === 'english' ? (englishText(session, turn) ?? turn.text) : turn.text;
  return {
    turnId: turn.id,
    start: turn.start,
    speakerId: turn.speakerId,
    field: hit.field,
    ...makeSnippet(text, query),
  };
}

/**
 * Scans every turn and returns the hits grouped by session: sessions with the most hits first (then the newest),
 * hits in turn order. `field: 'both'` reports a turn once, as an English hit when its English text matches.
 */
export function search(
  corpus: SearchableCorpus,
  query: Query,
  options: SearchOptions,
): SearchResult {
  const only = options.sessionIds ? new Set(options.sessionIds) : null;
  const maxHits = Math.max(0, options.maxHitsPerSession);
  const found: SessionMatch[] = [];
  let totalHits = 0;

  for (const prepared of corpus.sessions) {
    if (only && !only.has(prepared.session.sessionId)) continue;
    let hitCount = 0;
    const hits: SessionMatch['hits'] = [];
    for (let index = 0; index < prepared.original.length; index++) {
      const field = matchTurn(prepared, index, query, options.field);
      if (field === null) continue;
      hitCount++;
      if (hits.length < maxHits) hits.push({ index, field });
    }
    if (hitCount > 0) {
      found.push({ prepared, hitCount, hits });
      totalHits += hitCount;
    }
  }

  found.sort(
    (a, b) =>
      b.hitCount - a.hitCount ||
      b.prepared.session.recordedAt - a.prepared.session.recordedAt ||
      compareIds(a.prepared.session.sessionId, b.prepared.session.sessionId),
  );

  const offset = Math.max(0, options.offset ?? 0);
  const end = options.limit === undefined ? found.length : offset + Math.max(1, options.limit);
  return {
    totalHits,
    totalSessions: found.length,
    sessions: found.slice(offset, end).map(({ prepared, hitCount, hits }) => ({
      sessionId: prepared.session.sessionId,
      hitCount,
      hits: hits.map((hit) => toHit(prepared, hit, query)),
    })),
    nextOffset: end < found.length ? end : null,
  };
}
