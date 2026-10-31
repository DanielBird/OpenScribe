import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import { formatCitation } from '../domain/corpus/citation';
import { parseQuery } from '../domain/corpus/query';
import {
  prepareCorpus,
  search as searchCorpus,
  type SearchResult,
  type SessionHits,
} from '../domain/corpus/search';
import {
  englishText,
  isEnglishSession,
  toSessionText,
  type SessionText,
} from '../domain/corpus/sessionText';
import type { ChatFile } from '../domain/chat';
import { briefHash, cleanLines, type ProjectBrief, type ProjectFile } from '../domain/project';
import { classifySessionFile, PROJECT_FILE, sessionFileName } from '../domain/sessionFiles';
import type { SessionSummaryFile } from '../domain/summary';
import type { TranscriptDoc } from '../domain/transcript';
import { themeVocabulary as vocabularyOf, type ThemeCount } from '../features/summary/themes';
import { listChatFiles, readChatFile, writeChatFile } from '../storage/chatFiles';
import {
  clearCorpusCache,
  getCachedSession,
  pruneCorpusCache,
  putCachedSession,
} from '../storage/corpusCache';
import {
  FOLDER_MESSAGES,
  FolderError,
  folderPermission,
  forgetFolderHandle,
  isFolderAccessSupported,
  loadFolderHandle,
  openFolder,
  pickFolder,
  requestFolderPermission,
  saveFolderHandle,
  type FileStat,
  type ProjectFolder,
} from '../storage/folder';
import {
  createProject,
  listSessionFiles,
  readProject,
  readSummaryFile,
  readTranscriptFile,
  sameStat,
  writeProject,
  writeSummaryFile,
  writeTranscriptFile,
  type SessionFileInfo,
} from '../storage/projectFiles';

export type ProjectStatus = 'unsupported' | 'none' | 'reconnect' | 'loading' | 'ready' | 'error';

/**
 * A summary's status as the files show it (PROJECTS.md §5.3): none yet, up to date, or out of date because the
 * transcript or the brief changed. The pipeline adds `queued`, `running` and `failed` (`pipeline.statusOf`).
 */
export type FileSummaryStatus = 'none' | 'ok' | 'stale';

export interface ProjectSession {
  sessionId: string;
  /** The summary's title, or the recording's name until there is one. */
  title: string;
  transcriptFile: SessionFileInfo;
  text: SessionText;
  summary: SessionSummaryFile | null;
  summaryFile: SessionFileInfo | null;
  status: FileSummaryStatus;
  /** Other files with the same session id (conflict copies), which lost to the newest `savedAt` / `createdAt`. */
  copies: string[];
}

/** A saved chat in the project folder (DECISIONS.md D29), with the name and stat of its file. */
export interface ProjectChat {
  file: ChatFile;
  name: string;
  stat: FileStat;
}

/** A file that couldn't be read, and why. */
export interface FileProblem {
  file: string;
  message: string;
}

export type SearchOutcome =
  { kind: 'result'; result: SearchResult } | { kind: 'error'; message: string };

export type SaveBriefResult =
  { ok: true } | { ok: false; reason: 'changed' | 'failed'; message: string };

/** A transcript read from the project folder, with the name and stat of its file. */
export interface SessionDocFile {
  doc: TranscriptDoc;
  name: string;
  stat: FileStat;
}

/** Sessions per page of search results; **More** loads the next page. */
export const SEARCH_PAGE_SESSIONS = 20;
/** Hits listed per session on a page; **Show all** lists the rest (`searchSession`). */
export const SEARCH_HITS_PER_SESSION = 4;
/** Focus and `visibilitychange` often come together: one rescan, this long after the last. */
export const REFRESH_DELAY_MS = 300;

export const PROJECT_MESSAGES = {
  notAProject:
    "This folder isn't a DeScribe project. Choose the project folder, or use New project.",
  projectFileMissing:
    "The project's describe-project.json is missing. Open the project folder again.",
  projectFileInvalid: "DeScribe can't read this project's describe-project.json.",
  briefChanged: 'Someone else changed the brief. Reload to see their version.',
  accessRefused:
    "The browser didn't let DeScribe use this folder. Try again and allow access. If it keeps failing, ask IT " +
    'whether folder access is blocked.',
  unexpected: 'Something went wrong. Try again.',
} as const;

/** What Describe knows about a transcript file it has read: the stat it was read at, and its text. */
interface KnownFile {
  stat: FileStat;
  savedAt: string;
  text: SessionText;
}

/** A chat file Describe has read or written. Chats are small and aren't cached. */
interface KnownChat {
  stat: FileStat;
  file: ChatFile;
  conflictCopy: boolean;
}

/** A summary file Describe has read. Summaries are small and aren't cached (Phase 15). */
interface KnownSummary {
  stat: FileStat;
  file: SessionSummaryFile;
}

function messageOf(err: unknown): string {
  return err instanceof FolderError && err.userMessage
    ? err.userMessage
    : PROJECT_MESSAGES.unexpected;
}

const isPermissionError = (err: unknown) => err instanceof FolderError && err.kind === 'permission';

function projectFileMessage(err: unknown): string {
  if (err instanceof FolderError && err.path === PROJECT_FILE) {
    if (err.kind === 'not_found') return PROJECT_MESSAGES.projectFileMissing;
    if (err.kind === 'invalid') return PROJECT_MESSAGES.projectFileInvalid;
  }
  return messageOf(err);
}

/**
 * For a folder just picked, before it's adopted. Access to it was never granted, so a permission error means the
 * browser refused it (a declined prompt, or a policy that blocks folder access): there is nothing to reconnect.
 */
function pickedFolderMessage(err: unknown): string {
  return isPermissionError(err) ? PROJECT_MESSAGES.accessRefused : projectFileMessage(err);
}

function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
}

interface Candidate<T, I extends { name: string; conflictCopy: boolean } = SessionFileInfo> {
  info: I;
  time: number;
  value: T;
}

/** Newest first; a file that isn't a conflict copy wins a tie. */
function newestFirst<T, I extends { name: string; conflictCopy: boolean }>(
  a: Candidate<T, I>,
  b: Candidate<T, I>,
): number {
  return (
    b.time - a.time ||
    Number(a.info.conflictCopy) - Number(b.info.conflictCopy) ||
    (a.info.name < b.info.name ? -1 : 1)
  );
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Groups the files by session id and sorts the sessions newest recording first. For duplicates, the newest
 * `savedAt` (transcripts) or `createdAt` (summaries) wins, and the others are listed as copies.
 */
function groupSessions(
  listing: readonly SessionFileInfo[],
  known: ReadonlyMap<string, KnownFile>,
  summaries: ReadonlyMap<string, KnownSummary>,
  currentBriefHash: string,
): ProjectSession[] {
  const transcriptsById = new Map<string, Candidate<KnownFile>[]>();
  const summariesById = new Map<string, Candidate<KnownSummary>[]>();
  for (const info of listing) {
    if (info.kind === 'transcript') {
      const file = known.get(info.name);
      if (!file) continue;
      push(transcriptsById, file.text.sessionId, {
        info: { ...info, stat: file.stat },
        time: timeOf(file.savedAt),
        value: file,
      });
    } else {
      const summary = summaries.get(info.name);
      if (!summary) continue;
      push(summariesById, summary.file.sessionId, {
        info: { ...info, stat: summary.stat },
        time: timeOf(summary.file.createdAt),
        value: summary,
      });
    }
  }

  const sessions: ProjectSession[] = [];
  for (const [sessionId, group] of transcriptsById) {
    const [winner, ...others] = group.sort(newestFirst);
    if (!winner) continue;
    const [summary, ...otherSummaries] = (summariesById.get(sessionId) ?? []).sort(newestFirst);
    const text = winner.value.text;
    const file = summary?.value.file ?? null;
    sessions.push({
      sessionId,
      title: file?.summary.title || text.recordingName,
      transcriptFile: winner.info,
      text,
      summary: file,
      summaryFile: summary?.info ?? null,
      status: !file
        ? 'none'
        : file.transcriptHash === text.transcriptHash && file.briefHash === currentBriefHash
          ? 'ok'
          : 'stale',
      copies: [...others, ...otherSummaries].map((o) => o.info.name),
    });
  }
  return sessions.sort(
    (a, b) =>
      b.text.recordedAt - a.text.recordedAt ||
      a.text.recordingName.localeCompare(b.text.recordingName) ||
      (a.sessionId < b.sessionId ? -1 : 1),
  );
}

/**
 * One entry per chat, newest activity first. Of a chat's copies (a OneDrive conflict copy), the newest `updatedAt`
 * wins, and a file that isn't a copy wins a tie.
 */
function groupChats(known: ReadonlyMap<string, KnownChat>): ProjectChat[] {
  const byId = new Map<string, Candidate<KnownChat, { name: string; conflictCopy: boolean }>[]>();
  for (const [name, chat] of known) {
    push(byId, chat.file.id, {
      info: { name, conflictCopy: chat.conflictCopy },
      time: timeOf(chat.file.updatedAt),
      value: chat,
    });
  }
  const chats: ProjectChat[] = [];
  for (const group of byId.values()) {
    const [winner] = group.sort(newestFirst);
    if (winner)
      chats.push({ file: winner.value.file, name: winner.info.name, stat: winner.value.stat });
  }
  return chats.sort(
    (a, b) => timeOf(b.file.updatedAt) - timeOf(a.file.updatedAt) || (a.name < b.name ? -1 : 1),
  );
}

const sameProblems = (a: readonly FileProblem[], b: readonly FileProblem[]) =>
  a.length === b.length && a.every((p, i) => p.file === b[i]?.file && p.message === b[i]?.message);

/** Puts `info` into a listing in place of a file with the same name. */
function withFile(listing: readonly SessionFileInfo[], info: SessionFileInfo): SessionFileInfo[] {
  return [...listing.filter((f) => f.name !== info.name), info];
}

function fileInfo(name: string, stat: FileStat): SessionFileInfo {
  const parsed = classifySessionFile(name);
  if (!parsed) throw new FolderError('invalid', FOLDER_MESSAGES.badPath, name);
  return { name, ...parsed, stat };
}

// The project folder in Project mode (PROJECTS.md §5.2, §5.4): connecting, the project file and its brief, the
// sessions with their text (cached per computer) and their summaries, the rescan on focus, keyword search, and the
// writes the pipeline and the Output tab make. Sessions and the corpus are shallowRefs, replaced and never mutated
// (AGENTS.md rule 8). This store is the only one that holds the folder.
export const useProjectStore = defineStore('project', () => {
  const status = ref<ProjectStatus>(isFolderAccessSupported() ? 'none' : 'unsupported');
  /** The project's name: the remembered one before access is granted, then the project file's. */
  const projectName = ref<string | null>(null);
  const project = shallowRef<ProjectFile | null>(null);
  /** The project file's stat when it was last read or written, for the change check. */
  const projectStat = shallowRef<FileStat | null>(null);
  const sessions = shallowRef<ProjectSession[]>([]);
  const corpus = shallowRef<SessionText[]>([]);
  /** Rebuilt only when the corpus changes; unchanged sessions are reused (search.ts). */
  const searchable = computed(() => prepareCorpus(corpus.value));
  const sessionById = computed(() => new Map(corpus.value.map((s) => [s.sessionId, s])));
  const sessionMap = computed(() => new Map(sessions.value.map((s) => [s.sessionId, s])));
  const progress = ref({ done: 0, total: 0 });
  const problems = shallowRef<FileProblem[]>([]);
  /** Why the project couldn't be loaded (status `error`). */
  const error = ref<string | null>(null);
  /** A message about the last Open or New, e.g. a folder that isn't a project. */
  const notice = ref<string | null>(null);
  /** The saved chats (D29), newest activity first, and the chat files that couldn't be read. */
  const chats = shallowRef<ProjectChat[]>([]);
  const chatProblems = shallowRef<FileProblem[]>([]);
  /** Whether the chats have been read since the project opened, so "No chats yet" isn't shown too soon. */
  const chatsLoaded = ref(false);

  /** The hash of the current brief; a summary made with another brief is out of date. */
  const currentBriefHash = computed(() => (project.value ? briefHash(project.value.brief) : ''));
  /** Every theme name in the project's summaries, with how often it is used (A3). */
  const themeVocabulary = computed(() => vocabularyOf(summariesOf(sessions.value)));

  let handle: FileSystemDirectoryHandle | null = null;
  let folder: ProjectFolder | null = null;
  /** The transcript and summary files in the last listing, updated by Describe's own writes. */
  let listing: SessionFileInfo[] = [];
  /** Transcript files read so far, by file name. */
  let known = new Map<string, KnownFile>();
  /** Summary files read so far, by file name. */
  let knownSummaries = new Map<string, KnownSummary>();
  /** Chat files read or written so far, by file name. */
  let knownChats = new Map<string, KnownChat>();
  /** Bumped whenever the current folder or load changes; older work sees it and stops. */
  let seq = 0;
  /** Bumped by every write, so a rescan that started before it doesn't publish an older view. */
  let writes = 0;
  let initStarted = false;
  let refreshing = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  function summariesOf(list: readonly ProjectSession[]) {
    return list.flatMap((s) => (s.summary ? [s.summary.summary] : []));
  }

  function rebuild(): void {
    const grouped = groupSessions(listing, known, knownSummaries, currentBriefHash.value);
    sessions.value = grouped;
    // The corpus keeps its identity when no text changed (a new summary, a brief edit), so search isn't redone.
    const texts = grouped.map((s) => s.text);
    const before = corpus.value;
    if (texts.length !== before.length || texts.some((t, i) => t !== before[i])) {
      corpus.value = texts;
      prepareSearchSoon();
    }
  }

  function setProject(next: ProjectFile, stat: FileStat): void {
    const hashBefore = currentBriefHash.value;
    project.value = next;
    projectStat.value = stat;
    projectName.value = next.name;
    // A brief edit makes every summary made with the old brief out of date.
    if (currentBriefHash.value !== hashBefore && sessions.value.length > 0) rebuild();
  }

  function clearSessions(): void {
    listing = [];
    known = new Map();
    knownSummaries = new Map();
    sessions.value = [];
    corpus.value = [];
    problems.value = [];
    knownChats = new Map();
    chats.value = [];
    chatProblems.value = [];
    chatsLoaded.value = false;
  }

  function publish(
    files: SessionFileInfo[],
    next: Map<string, KnownFile>,
    nextSummaries: Map<string, KnownSummary>,
    failed: FileProblem[],
  ): void {
    listing = files;
    known = next;
    knownSummaries = nextSummaries;
    problems.value = failed;
    rebuild();
  }

  /**
   * Normalises new sessions for search once the list is painted, so the first query doesn't pay for it (about
   * 300 ms for 300 hours, Phase 14's perf test). Later rebuilds only normalise sessions that are new (search.ts).
   */
  function prepareSearchSoon(): void {
    const prepare = () => void searchable.value;
    if (typeof requestIdleCallback === 'function') requestIdleCallback(prepare, { timeout: 2000 });
    else setTimeout(prepare, 0);
  }

  /** A transcript's text: what was read already, the cache, or the file itself. `permission` is passed on. */
  async function readSession(
    f: ProjectFolder,
    projectId: string,
    info: SessionFileInfo,
  ): Promise<KnownFile | FileProblem> {
    const prior = known.get(info.name);
    if (prior && sameStat(prior.stat, info.stat)) return prior;
    const cached = await getCachedSession(projectId, info.name, info.stat);
    if (cached) return { stat: info.stat, ...cached };
    try {
      const { file, stat } = await readTranscriptFile(f, info.name);
      const read: KnownFile = { stat, savedAt: file.savedAt, text: toSessionText(file.doc) };
      await putCachedSession(projectId, info.name, stat, {
        savedAt: read.savedAt,
        text: read.text,
      });
      return read;
    } catch (err) {
      if (isPermissionError(err)) throw err;
      return { file: info.name, message: messageOf(err) };
    }
  }

  /** A summary: what was read already, or the file itself. `permission` is passed on. */
  async function readSummary(
    f: ProjectFolder,
    info: SessionFileInfo,
  ): Promise<KnownSummary | FileProblem> {
    const prior = knownSummaries.get(info.name);
    if (prior && sameStat(prior.stat, info.stat)) return prior;
    try {
      return await readSummaryFile(f, info.name);
    } catch (err) {
      if (isPermissionError(err)) throw err;
      return { file: info.name, message: messageOf(err) };
    }
  }

  /**
   * Reads every file in `files` that isn't known yet (or changed), one at a time (reference doc Rule 6). Each
   * session's summaries are read right after its transcript, so `onSession` counts sessions. Resolves `null` if
   * the run went stale.
   */
  async function readAll(
    f: ProjectFolder,
    projectId: string,
    files: readonly SessionFileInfo[],
    stale: () => boolean,
    onSession?: () => void,
  ): Promise<{
    next: Map<string, KnownFile>;
    nextSummaries: Map<string, KnownSummary>;
    failed: FileProblem[];
  } | null> {
    const next = new Map<string, KnownFile>();
    const nextSummaries = new Map<string, KnownSummary>();
    const failed: FileProblem[] = [];
    const summariesByBase = new Map<string, SessionFileInfo[]>();
    for (const info of files) if (info.kind === 'summary') push(summariesByBase, info.base, info);

    const takeSummaries = async (list: readonly SessionFileInfo[]) => {
      for (const info of list) {
        const result = await readSummary(f, info);
        if (stale()) return false;
        if ('stat' in result) nextSummaries.set(info.name, result);
        else failed.push(result);
      }
      return true;
    };

    for (const info of files) {
      if (info.kind !== 'transcript') continue;
      const result = await readSession(f, projectId, info);
      if (stale()) return null;
      if ('text' in result) next.set(info.name, result);
      else failed.push(result);
      const own = summariesByBase.get(info.base);
      summariesByBase.delete(info.base);
      if (own && !(await takeSummaries(own))) return null;
      onSession?.();
    }
    // Summaries whose base has no transcript: usually orphans, but read them, as the id inside decides.
    for (const list of summariesByBase.values()) {
      if (!(await takeSummaries(list))) return null;
    }
    return { next, nextSummaries, failed };
  }

  /**
   * Reads the chat files that are new or changed since the last look, one at a time, and publishes the list. A lost
   * permission is passed on. If Describe saved a chat meanwhile, nothing is published and a rescan follows.
   */
  async function scanChats(f: ProjectFolder, stale: () => boolean): Promise<void> {
    const writesAtStart = writes;
    const files = await listChatFiles(f);
    if (stale()) return;
    const next = new Map<string, KnownChat>();
    const failed: FileProblem[] = [];
    for (const info of files) {
      const prior = knownChats.get(info.name);
      if (prior && sameStat(prior.stat, info.stat)) {
        next.set(info.name, prior);
        continue;
      }
      try {
        const { file, stat } = await readChatFile(f, info.name);
        next.set(info.name, { file, stat, conflictCopy: info.conflictCopy });
      } catch (err) {
        if (isPermissionError(err)) throw err;
        failed.push({ file: info.name, message: messageOf(err) });
      }
      if (stale()) return;
    }
    if (writes !== writesAtStart) {
      scheduleRefresh();
      return;
    }
    const unchanged =
      chatsLoaded.value &&
      next.size === knownChats.size &&
      [...next].every(([name, chat]) => knownChats.get(name) === chat) &&
      sameProblems(failed, chatProblems.value);
    knownChats = next;
    chatsLoaded.value = true;
    if (unchanged) return;
    chatProblems.value = failed;
    chats.value = groupChats(next);
  }

  // --- Loading -------------------------------------------------------------------------------------

  /** Reads the project file and every session's files, with progress, then the chats. */
  async function load(): Promise<void> {
    const f = folder;
    if (!f) return;
    const run = ++seq;
    const stale = () => run !== seq;
    status.value = 'loading';
    error.value = null;
    progress.value = { done: 0, total: 0 };
    try {
      const opened = await readProject(f);
      if (stale()) return;
      if (project.value?.id !== opened.project.id) clearSessions();
      setProject(opened.project, opened.stat);
      const files = await listSessionFiles(f);
      if (stale()) return;
      const total = files.filter((x) => x.kind === 'transcript').length;
      progress.value = { done: 0, total };
      const read = await readAll(f, opened.project.id, files, stale, () => {
        progress.value = { done: progress.value.done + 1, total };
      });
      if (!read || stale()) return;
      publish(files, read.next, read.nextSummaries, read.failed);
      status.value = 'ready';
      await pruneCorpusCache(opened.project.id, [...read.next.keys()]);
      // The sessions show first; the chats follow. Other failures wait for the next rescan.
      try {
        await scanChats(f, stale);
      } catch (err) {
        if (!stale() && isPermissionError(err)) status.value = 'reconnect';
      }
    } catch (err) {
      if (stale()) return;
      if (isPermissionError(err)) {
        status.value = 'reconnect';
      } else {
        error.value = projectFileMessage(err);
        status.value = 'error';
      }
    }
  }

  /**
   * Rescans in the background: the project file's stat, the listing, and only new or changed files. It never
   * blocks the UI, and is skipped while another runs (a listing can take ~11 s while OneDrive catches up, Rule 7).
   */
  async function refresh(): Promise<void> {
    const f = folder;
    const current = project.value;
    if (status.value !== 'ready' || refreshing || !f || !current) return;
    const run = seq;
    const writesAtStart = writes;
    const stale = () => run !== seq;
    refreshing = true;
    try {
      const stat = await f.stat(PROJECT_FILE);
      if (stale()) return;
      if (stat && projectStat.value && !sameStat(stat, projectStat.value)) {
        try {
          const reread = await readProject(f);
          if (stale()) return;
          if (reread.project.id === current.id) setProject(reread.project, reread.stat);
        } catch (err) {
          if (isPermissionError(err)) throw err;
          // Keep the brief that's shown; the next load reports the problem.
        }
      }

      const files = await listSessionFiles(f);
      if (stale()) return;
      const read = await readAll(f, current.id, files, stale);
      if (!read || stale()) return;
      // Describe wrote a file meanwhile: this listing may predate it. Look again shortly.
      if (writes !== writesAtStart) {
        scheduleRefresh();
        return;
      }
      const { next, nextSummaries, failed } = read;
      const unchanged =
        next.size === known.size &&
        [...next].every(([name, file]) => known.get(name) === file) &&
        nextSummaries.size === knownSummaries.size &&
        [...nextSummaries].every(([name, file]) => knownSummaries.get(name) === file) &&
        sameProblems(failed, problems.value);
      if (!unchanged) {
        publish(files, next, nextSummaries, failed);
        await pruneCorpusCache(current.id, [...next.keys()]);
      }
      // Colleagues' chats arrive through OneDrive too.
      await scanChats(f, stale);
    } catch (err) {
      if (!stale() && isPermissionError(err)) status.value = 'reconnect';
      // Anything else: keep what's shown, and try again on the next focus.
    } finally {
      refreshing = false;
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, REFRESH_DELAY_MS);
  }

  // Colleagues' new sessions arrive through OneDrive: rescan when the window comes back.
  const onFocus = () => scheduleRefresh();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') scheduleRefresh();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);
  onScopeDispose(() => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (refreshTimer !== null) clearTimeout(refreshTimer);
  });

  // --- Connecting ----------------------------------------------------------------------------------

  /** At app start: the remembered folder, and whether access must be asked for again. Reads no file until it has. */
  async function init(): Promise<void> {
    if (initStarted) return;
    initStarted = true;
    if (!isFolderAccessSupported()) {
      status.value = 'unsupported';
      return;
    }
    const run = seq;
    const stored = await loadFolderHandle();
    if (run !== seq) return; // the user opened a project meanwhile
    if (!stored) {
      status.value = 'none';
      return;
    }
    handle = stored.handle;
    folder = openFolder(stored.handle);
    projectName.value = stored.projectName;
    const permission = await folderPermission(stored.handle);
    if (run !== seq) return;
    // On file:// access ends with every browser session (F5); `denied` was never seen and is treated alike.
    if (permission === 'granted') await load();
    else status.value = 'reconnect';
  }

  /** Makes the picked folder current, remembers it, and loads it. */
  async function adopt(
    picked: FileSystemDirectoryHandle,
    f: ProjectFolder,
    name: string,
  ): Promise<void> {
    handle = picked;
    folder = f;
    projectName.value = name;
    await saveFolderHandle(picked, name);
    await load();
  }

  /** Asks for a folder. `null` if the picker was dismissed or failed (then `notice` says why). */
  async function pick(): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await pickFolder();
    } catch (err) {
      if (!(err instanceof FolderError && err.kind === 'cancelled')) {
        notice.value = pickedFolderMessage(err);
      }
      return null;
    }
  }

  /**
   * **Open project…**, from a click. A folder without a project file is refused with a notice, and the current
   * project, if any, stays. Resolves whether a project was opened.
   */
  async function openProject(): Promise<boolean> {
    notice.value = null;
    const picked = await pick();
    if (!picked) return false;
    const f = openFolder(picked);
    let opened: ProjectFile;
    try {
      opened = (await readProject(f)).project;
    } catch (err) {
      notice.value =
        err instanceof FolderError && err.kind === 'not_found'
          ? PROJECT_MESSAGES.notAProject
          : pickedFolderMessage(err);
      return false;
    }
    await adopt(picked, f, opened.name);
    return true;
  }

  /**
   * **New project…**, from a click. A folder that's already a project simply opens. Resolves `{ created }`, or
   * `null` if nothing was opened.
   */
  async function newProject(): Promise<{ created: boolean } | null> {
    notice.value = null;
    const picked = await pick();
    if (!picked) return null;
    const f = openFolder(picked);
    try {
      let created = false;
      let name: string;
      if ((await f.stat(PROJECT_FILE)) === null) {
        try {
          name = (await createProject(f, f.name)).project.name;
          created = true;
        } catch (err) {
          // Someone made one meanwhile: open it.
          if (!(err instanceof FolderError && err.kind === 'changed')) throw err;
          name = (await readProject(f)).project.name;
        }
      } else {
        name = (await readProject(f)).project.name;
      }
      await adopt(picked, f, name);
      return { created };
    } catch (err) {
      notice.value = pickedFolderMessage(err);
      return null;
    }
  }

  /** **Reconnect**, from a click: asks the browser for access again, then loads. Resolves whether it's ready. */
  async function reconnect(): Promise<boolean> {
    const h = handle;
    if (!h) return false;
    notice.value = null;
    // Before any other await: the browser only shows its prompt during the click.
    if (await requestFolderPermission(h)) await load();
    return status.value === 'ready';
  }

  /** **Try again** after an error. */
  function retry(): Promise<void> {
    return load();
  }

  // --- The brief -----------------------------------------------------------------------------------

  /**
   * Saves the name and the brief. `base` is the project file's stat when the editing started, so a colleague's
   * change in between is never overwritten without a choice (`changed`: offer **Reload**).
   */
  async function saveBrief(
    name: string,
    brief: ProjectBrief,
    base: FileStat,
  ): Promise<SaveBriefResult> {
    const f = folder;
    const current = project.value;
    if (!f || !current)
      return { ok: false, reason: 'failed', message: PROJECT_MESSAGES.unexpected };
    const next: ProjectFile = {
      ...current,
      name: name.trim(),
      updatedAt: new Date().toISOString(),
      brief: {
        researchQuestions: cleanLines(brief.researchQuestions),
        context: brief.context.trim(),
        metadataFields: cleanLines(brief.metadataFields),
      },
    };
    try {
      const stat = await writeProject(f, next, base);
      setProject(next, stat);
      if (handle) await saveFolderHandle(handle, next.name);
      return { ok: true };
    } catch (err) {
      if (err instanceof FolderError && err.kind === 'changed') {
        return { ok: false, reason: 'changed', message: PROJECT_MESSAGES.briefChanged };
      }
      return { ok: false, reason: 'failed', message: messageOf(err) };
    }
  }

  /** Reads the project file again (**Reload** after a conflict). Resolves its stat, or `null` if it failed. */
  async function reloadProject(): Promise<FileStat | null> {
    const f = folder;
    if (!f) return null;
    try {
      const reread = await readProject(f);
      setProject(reread.project, reread.stat);
      return reread.stat;
    } catch (err) {
      if (isPermissionError(err)) status.value = 'reconnect';
      return null;
    }
  }

  // --- Session files (the pipeline and the Output tab) ----------------------------------------------

  /** The folder, if the project is ready to be written. Otherwise access has to be granted again. */
  function readyFolder(): { f: ProjectFolder; current: ProjectFile } {
    const f = folder;
    const current = project.value;
    if (status.value !== 'ready' || !f || !current) {
      throw new FolderError('permission', FOLDER_MESSAGES.permission);
    }
    return { f, current };
  }

  /** Marks access as lost when a write or read finds it gone. */
  function noteError(err: unknown): never {
    if (isPermissionError(err) && status.value === 'ready') status.value = 'reconnect';
    throw err;
  }

  /** What Describe now knows about a transcript file it wrote or read, without reading it again. */
  function recordTranscript(
    projectId: string,
    name: string,
    stat: FileStat,
    savedAt: string,
    doc: TranscriptDoc,
  ): void {
    writes++;
    const text = toSessionText(doc);
    listing = withFile(listing, fileInfo(name, stat));
    known = new Map(known).set(name, { stat, savedAt, text });
    void putCachedSession(projectId, name, stat, { savedAt, text });
    rebuild();
  }

  /** Writes a new session's transcript file (**Add to project**). `changed` if the file exists already. */
  async function addSessionTranscript(
    doc: TranscriptDoc,
  ): Promise<{ name: string; stat: FileStat }> {
    const { f, current } = readyFolder();
    try {
      const { name, stat, savedAt } = await writeTranscriptFile(f, doc, { expected: null });
      recordTranscript(current.id, name, stat, savedAt, doc);
      return { name, stat };
    } catch (err) {
      noteError(err);
    }
  }

  /**
   * Saves a session's transcript into its file. With `expected`, refuses (`changed`) if the file isn't as it was;
   * without, overwrites it (**Keep mine**). Resolves the new stat.
   */
  async function saveSessionTranscript(
    doc: TranscriptDoc,
    name: string,
    expected?: FileStat,
  ): Promise<FileStat> {
    const { f, current } = readyFolder();
    try {
      const opts = expected === undefined ? { name } : { name, expected };
      const written = await writeTranscriptFile(f, doc, opts);
      recordTranscript(current.id, name, written.stat, written.savedAt, doc);
      return written.stat;
    } catch (err) {
      noteError(err);
    }
  }

  /** Reads a transcript file in full (word timings included), and notes what it holds. */
  async function readSessionFile(name: string): Promise<SessionDocFile> {
    const { f, current } = readyFolder();
    try {
      const { file, stat } = await readTranscriptFile(f, name);
      const prior = known.get(name);
      if (!prior || !sameStat(prior.stat, stat)) {
        recordTranscript(current.id, name, stat, file.savedAt, file.doc);
      }
      return { doc: file.doc, name, stat };
    } catch (err) {
      noteError(err);
    }
  }

  /** Reads a session's transcript from the file that represents it. */
  function readSessionDoc(sessionId: string): Promise<SessionDocFile> {
    const session = sessionMap.value.get(sessionId);
    if (!session) {
      return Promise.reject(new FolderError('not_found', FOLDER_MESSAGES.notFound));
    }
    return readSessionFile(session.transcriptFile.name);
  }

  /** Writes a session's summary file, next to its transcript (`<base>.summary.json`). */
  async function saveSessionSummary(sessionId: string, file: SessionSummaryFile): Promise<void> {
    const { f } = readyFolder();
    const session = sessionMap.value.get(sessionId);
    if (!session) throw new FolderError('not_found', FOLDER_MESSAGES.notFound);
    const name = sessionFileName(session.transcriptFile.base, 'summary');
    try {
      const { stat } = await writeSummaryFile(f, file, name);
      writes++;
      listing = withFile(listing, fileInfo(name, stat));
      knownSummaries = new Map(knownSummaries).set(name, { stat, file });
      rebuild();
    } catch (err) {
      noteError(err);
    }
  }

  // --- Chats ---------------------------------------------------------------------------------------

  /**
   * Saves a chat to its file in `chats/` (D29). `expected` is `null` for a chat that has no file yet, or the stat it
   * was last saved with: `changed` if the file isn't as it was.
   */
  async function saveChat(file: ChatFile, expected: FileStat | null): Promise<ProjectChat> {
    const { f } = readyFolder();
    try {
      const { name, stat } = await writeChatFile(f, file, expected);
      writes++;
      knownChats = new Map(knownChats).set(name, { file, stat, conflictCopy: false });
      chats.value = groupChats(knownChats);
      return { file, name, stat };
    } catch (err) {
      noteError(err);
    }
  }

  // --- Search and citations ------------------------------------------------------------------------

  /** One page of results for a keyword query (PROJECTS.md §5.4), or the query's error message. */
  function search(text: string, offset = 0): SearchOutcome {
    const query = parseQuery(text);
    if (query.kind === 'error') return { kind: 'error', message: query.message };
    return {
      kind: 'result',
      result: searchCorpus(searchable.value, query, {
        field: 'both',
        maxHitsPerSession: SEARCH_HITS_PER_SESSION,
        offset,
        limit: SEARCH_PAGE_SESSIONS,
      }),
    };
  }

  /** Every hit in one session for a keyword query, or `null` if the query is bad or no longer finds the session. */
  function searchSession(text: string, sessionId: string): SessionHits | null {
    const query = parseQuery(text);
    if (query.kind === 'error') return null;
    const result = searchCorpus(searchable.value, query, {
      field: 'both',
      sessionIds: [sessionId],
      maxHitsPerSession: Infinity,
    });
    return result.sessions[0] ?? null;
  }

  function session(sessionId: string): ProjectSession | undefined {
    return sessionMap.value.get(sessionId);
  }

  /** Whether the last listing (with Describe's own writes since) has this file, readable or not. */
  function hasSessionFile(name: string): boolean {
    return listing.some((f) => f.name === name);
  }

  /** A session's title: its summary's, or its recording's name until it has a summary. */
  function sessionTitle(sessionId: string): string {
    return (
      sessionMap.value.get(sessionId)?.title ??
      sessionById.value.get(sessionId)?.recordingName ??
      ''
    );
  }

  function speakerLabel(sessionId: string, speakerId: string): string {
    const text = sessionById.value.get(sessionId);
    return text?.speakers.find((s) => s.id === speakerId)?.label ?? speakerId;
  }

  /** The theme vocabulary without one session's own summary, so a **Regenerate** isn't steered by itself. */
  function themesExcept(sessionId: string): ThemeCount[] {
    return vocabularyOf(summariesOf(sessions.value.filter((s) => s.sessionId !== sessionId)));
  }

  /**
   * What **Copy** puts on the clipboard for a turn: its whole English text (or the original, without a translation)
   * with its citation. `null` if the turn is gone.
   */
  function citationFor(sessionId: string, turnId: string): string | null {
    const text = sessionById.value.get(sessionId);
    const turn = text?.turns.find((t) => t.id === turnId);
    if (!text || !turn) return null;
    const english = englishText(text, turn);
    return formatCitation({
      text: english ?? turn.text,
      speakerLabel: speakerLabel(sessionId, turn.speakerId),
      start: turn.start,
      sessionTitle: sessionTitle(sessionId),
      translatedFrom: english !== null && !isEnglishSession(text) ? text.languageCode : null,
    });
  }

  // --- Clear saved data ----------------------------------------------------------------------------

  /** Forgets the folder and empties the text cache. The folder's files are never touched. */
  async function forget(): Promise<void> {
    seq++;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
    handle = null;
    folder = null;
    project.value = null;
    projectStat.value = null;
    projectName.value = null;
    clearSessions();
    error.value = null;
    notice.value = null;
    progress.value = { done: 0, total: 0 };
    status.value = isFolderAccessSupported() ? 'none' : 'unsupported';
    await Promise.all([forgetFolderHandle(), clearCorpusCache()]);
  }

  return {
    status,
    projectName,
    project,
    projectStat,
    sessions,
    corpus,
    progress,
    problems,
    error,
    notice,
    chats,
    chatProblems,
    chatsLoaded,
    briefHash: currentBriefHash,
    themeVocabulary,
    init,
    load,
    refresh,
    scheduleRefresh,
    openProject,
    newProject,
    reconnect,
    retry,
    saveBrief,
    reloadProject,
    addSessionTranscript,
    saveSessionTranscript,
    readSessionFile,
    readSessionDoc,
    saveSessionSummary,
    saveChat,
    search,
    searchSession,
    session,
    hasSessionFile,
    sessionTitle,
    speakerLabel,
    themesExcept,
    citationFor,
    forget,
  };
});
