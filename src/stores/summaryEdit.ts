import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, toRaw, watch } from 'vue';
import type { SessionSummary, SessionSummaryFile } from '../domain/summary';
import { tidySummary } from '../domain/summaryEdit';
import { themeKey } from '../features/summary/themes';
import { FolderError, type FileStat } from '../storage/folder';
import { usePipelineStore } from './pipeline';
import { useProjectStore } from './project';
import { SAVE_DELAY_MS, type FolderNotice } from './transcript';
import { createUnloadGuard } from './unloadGuard';

const SAVE_FAILED = "DeScribe couldn't save this file. Try again.";

function asFolderError(err: unknown): FolderError {
  return err instanceof FolderError ? err : new FolderError('io', SAVE_FAILED);
}

const unloadGuard = createUnloadGuard();

// A session summary being corrected by hand in Project mode (Phase 39, DECISIONS.md D60). While editing, the summary
// on screen is a draft held here (a shallowRef, replaced immutably: T4), not the file as last read: a rescan that
// reads a newer file doesn't replace it, and the next save's change check finds it. Changes are saved after
// `SAVE_DELAY_MS`, as the transcript's are, into the file the summary was read from, with every other field of the
// file kept. If someone else changed the file, saving stops until the user picks **Reload** or **Keep mine**.
export const useSummaryEditStore = defineStore('summaryEdit', () => {
  const project = useProjectStore();

  /** The session whose summary is being edited, or `null`. */
  const sessionId = ref<string | null>(null);
  const draft = shallowRef<SessionSummary | null>(null);
  /** Bumped when the draft is replaced from outside the editor (start, **Reload**): the editor shows it anew. */
  const generation = ref(0);
  /** The file changed since Describe last read or wrote it: saving stops until the user chooses. */
  const conflict = ref(false);
  /** The last save failed; the next change, **Try again** or **Reconnect** tries again. */
  const saveError = shallowRef<FolderError | null>(null);
  /** Changes the file doesn't have yet. */
  const unsaved = ref(false);

  /** The file as Describe last read or wrote it, and its stat then. */
  let base: SessionSummaryFile | null = null;
  let baseStat: FileStat | null = null;

  const folderNotice = computed<FolderNotice | null>(() => {
    if (sessionId.value === null) return null;
    if (conflict.value) return { kind: 'conflict' };
    const err = saveError.value;
    if (!err) return null;
    return err.kind === 'permission'
      ? { kind: 'reconnect', projectName: project.projectName ?? '' }
      : { kind: 'retry', message: err.userMessage };
  });

  /** The theme names the project's other sessions use, as `themeKey`s (A3). */
  const otherThemes = computed(
    () =>
      new Set(
        sessionId.value === null
          ? []
          : project.themesExcept(sessionId.value).map((t) => themeKey(t.name)),
      ),
  );

  /** Whether another session's summary uses this theme name: a renamed or added theme is new unless it does. */
  function isKnownTheme(name: string): boolean {
    const key = themeKey(name);
    return key !== '' && otherThemes.value.has(key);
  }

  function isEditing(id: string): boolean {
    return sessionId.value === id;
  }

  // --- Saving -------------------------------------------------------------------------------------

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The saves in progress; they run one at a time, each from the stat the last one returned. */
  let saveRun: Promise<void> | null = null;
  let saveDirty = false;

  function clearTimer(): void {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
  }

  function markSaved(): void {
    unsaved.value = false;
    unloadGuard.release();
  }

  /** Writes the draft to its file once, unless saving has stopped. */
  async function writeOnce(): Promise<void> {
    const id = sessionId.value;
    const current = draft.value;
    const from = base;
    const stat = baseStat;
    if (id === null || !current || !from || !stat || conflict.value) return;
    if (current === from.summary) {
      if (saveTimer === null && !saveDirty) markSaved();
      return;
    }
    const file: SessionSummaryFile = { ...from, summary: toRaw(current) };
    try {
      const written = await project.saveEditedSummary(id, file, stat);
      if (sessionId.value !== id) return;
      base = file;
      baseStat = written;
      saveError.value = null;
      if (draft.value === current && saveTimer === null && !saveDirty) markSaved();
    } catch (err) {
      if (sessionId.value !== id) return;
      const error = asFolderError(err);
      if (error.kind === 'changed') conflict.value = true;
      else saveError.value = error;
    }
  }

  /** Saves now, after any save already running. Resolves when every queued save is done. */
  function save(): Promise<void> {
    clearTimer();
    saveDirty = true;
    saveRun ??= (async () => {
      try {
        while (saveDirty) {
          saveDirty = false;
          await writeOnce();
        }
      } finally {
        saveRun = null;
      }
    })();
    return saveRun;
  }

  function scheduleSave(): void {
    clearTimer();
    saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
  }

  /** Saves a pending change at once, and waits for it. */
  async function flush(): Promise<void> {
    if (saveTimer !== null) await save();
    else if (saveRun) await saveRun;
  }

  // A change typed just before the tab closes would otherwise be lost. Best effort: the write may not finish while
  // the page unloads. The unload guard asks first while there are unsaved changes.
  const flushOnPageHide = () => {
    if (saveTimer !== null) void save();
  };
  window.addEventListener('pagehide', flushOnPageHide);
  onScopeDispose(() => {
    window.removeEventListener('pagehide', flushOnPageHide);
    clearTimer();
    unloadGuard.release();
  });

  // --- Editing ------------------------------------------------------------------------------------

  function clear(): void {
    clearTimer();
    saveDirty = false;
    sessionId.value = null;
    draft.value = null;
    base = null;
    baseStat = null;
    conflict.value = false;
    saveError.value = null;
    markSaved();
  }

  /**
   * Starts editing a session's summary (**Edit**). Refuses (`false`) while the pipeline works on the session, or
   * when it has no summary. Editing another session first ends that one.
   */
  async function start(id: string): Promise<boolean> {
    if (sessionId.value === id) return true;
    if (sessionId.value !== null) await stop();
    const status = usePipelineStore().statusOf(id);
    if (status === 'queued' || status === 'running') return false;
    const session = project.session(id);
    if (!session?.summary || !session.summaryFile) return false;
    sessionId.value = id;
    base = session.summary;
    baseStat = session.summaryFile.stat;
    draft.value = session.summary.summary;
    conflict.value = false;
    saveError.value = null;
    unsaved.value = false;
    generation.value++;
    return true;
  }

  /** The editor's change: the draft is replaced, and saved after the delay. */
  function change(next: SessionSummary): void {
    if (sessionId.value === null || next === draft.value) return;
    draft.value = next;
    unsaved.value = true;
    unloadGuard.hold();
    if (!conflict.value) scheduleSave();
  }

  /**
   * **Done**: the draft is tidied (empty themes and detail rows go) and saved. Editing ends once the file has it;
   * while it can't be saved (a conflict, a lost folder), editing goes on with the notice (`false`).
   */
  async function done(): Promise<boolean> {
    if (sessionId.value === null) return true;
    const current = draft.value;
    if (current) change(tidySummary(current));
    await flush();
    if (unsaved.value || conflict.value || saveError.value) return false;
    clear();
    return true;
  }

  /** Leaving the summary (another session, Project mode closed): saves what it can, then ends editing. */
  async function stop(): Promise<void> {
    if (sessionId.value === null) return;
    const id = sessionId.value;
    const current = draft.value;
    if (current) change(tidySummary(current));
    await flush();
    if (sessionId.value === id) clear();
  }

  /**
   * **Reload** (the file's version replaces the draft, and editing goes on from it) or **Keep mine** (the draft
   * overwrites the file). Errors show in `folderNotice`.
   */
  async function resolveConflict(choice: 'reload' | 'keep'): Promise<void> {
    const id = sessionId.value;
    if (id === null) return;
    try {
      if (choice === 'reload') {
        const read = await project.readSessionSummary(id);
        if (sessionId.value !== id) return;
        clearTimer();
        base = read.file;
        baseStat = read.stat;
        draft.value = read.file.summary;
        generation.value++;
        conflict.value = false;
        saveError.value = null;
        markSaved();
      } else {
        clearTimer();
        await saveRun;
        const current = draft.value;
        const from = base;
        if (sessionId.value !== id || !current || !from) return;
        const file: SessionSummaryFile = { ...from, summary: toRaw(current) };
        const stat = await project.saveEditedSummary(id, file);
        if (sessionId.value !== id) return;
        base = file;
        baseStat = stat;
        conflict.value = false;
        saveError.value = null;
        if (draft.value === current) markSaved();
        else scheduleSave();
      }
    } catch (err) {
      if (sessionId.value === id) saveError.value = asFolderError(err);
    }
  }

  /** **Try again** after a failed save. */
  function retryFolderSave(): Promise<void> {
    saveError.value = null;
    return save();
  }

  /** **Reconnect**: asks for access to the folder again, then saves. */
  async function reconnectFolder(): Promise<void> {
    if (!(await project.reconnect())) return;
    saveError.value = null;
    await save();
  }

  // Another project, or none: the draft belongs to the folder it was read from.
  watch(
    () => project.project?.id,
    (next, before) => {
      if (next !== before && sessionId.value !== null) clear();
    },
  );

  return {
    sessionId,
    draft,
    generation,
    conflict,
    saveError,
    unsaved,
    folderNotice,
    isKnownTheme,
    isEditing,
    start,
    change,
    flush,
    done,
    stop,
    resolveConflict,
    retryFolderSave,
    reconnectFolder,
  };
});
