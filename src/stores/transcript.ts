import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, toRaw, watch } from 'vue';
import { transcriptHash } from '../domain/corpus/sessionText';
import {
  cleanTurnText,
  defaultSpeakerLabel,
  type Translation,
  type TranscriptDoc,
  type TranscriptVersion,
} from '../domain/transcript';
import { staleTurnIds as staleTurnIdsOf, turnSourceHashes } from '../domain/translation';
import { FOLDER_MESSAGES, FolderError, type FileStat } from '../storage/folder';
import {
  clearLastTranscript,
  loadLastTranscript,
  loadTranscriptLink,
  saveLastTranscript,
  saveTranscriptLink,
  type TranscriptLink,
} from '../storage/idb';
import { sameStat } from '../storage/projectFiles';
import { useProjectStore } from './project';

/** Renames and text edits are saved this long after the last keystroke. */
export const SAVE_DELAY_MS = 500;

export type { TranscriptLink };

/** Why saving to the project folder has stopped, for the notice on Output (Phase 15). */
export type FolderNotice =
  | { kind: 'conflict' }
  | { kind: 'reconnect'; projectName: string }
  | { kind: 'retry'; message: string }
  | { kind: 'otherProject'; projectName: string };

const SAVE_FAILED = "DeScribe couldn't save this file. Try again.";

function asFolderError(err: unknown): FolderError {
  return err instanceof FolderError ? err : new FolderError('io', SAVE_FAILED);
}

// The current transcript, autosaved to IndexedDB (DECISIONS.md D10) and, once it is in a project, to its file in the
// project folder (PROJECTS.md §5.2), with a check that nobody else changed the file meanwhile. The link to the file
// is remembered with the transcript (DECISIONS.md D25). The doc is a shallowRef and is always replaced immutably
// (DECISIONS.md T4). This store uses the project store; the project store never uses this one.
export const useTranscriptStore = defineStore('transcript', () => {
  const project = useProjectStore();

  const doc = shallowRef<TranscriptDoc | null>(null);
  const view = ref<TranscriptVersion>('original');
  /** True when the last save failed: the transcript lasts only for this tab. */
  const saveFailed = ref(false);

  /** The project file this transcript is saved in, and its stat when Describe last read or wrote it. */
  const projectLink = shallowRef<TranscriptLink | null>(null);
  /** The file changed since Describe last read or wrote it: saves to the folder stop until the user chooses. */
  const folderConflict = ref(false);
  /** The last save to the folder failed; the next change tries again. */
  const folderSaveError = shallowRef<FolderError | null>(null);
  /** The project that's open isn't the one this transcript is in. */
  const otherProject = ref(false);
  /** Changes the folder doesn't have yet. */
  const folderUnsaved = ref(false);

  const hasAutosave = computed(() => doc.value !== null);
  const autosaveInfo = computed(() =>
    doc.value ? { fileName: doc.value.source.fileName, createdAt: doc.value.createdAt } : null,
  );

  const folderNotice = computed<FolderNotice | null>(() => {
    const link = projectLink.value;
    if (!link) return null;
    if (folderConflict.value) return { kind: 'conflict' };
    if (otherProject.value) return { kind: 'otherProject', projectName: link.projectName };
    const err = folderSaveError.value;
    if (!err) return null;
    return err.kind === 'permission'
      ? { kind: 'reconnect', projectName: link.projectName }
      : { kind: 'retry', message: err.userMessage };
  });

  /** Turns whose English is out of date: their text changed since they were translated (DECISIONS.md D39). */
  const staleTurnIds = computed<readonly string[]>(() =>
    doc.value ? staleTurnIdsOf(doc.value) : [],
  );

  /** In a project, with changes its file doesn't have: replacing or clearing the transcript loses them. */
  const unsavedInProject = computed(
    () => projectLink.value !== null && (folderNotice.value !== null || folderUnsaved.value),
  );

  // --- The project link --------------------------------------------------------------------------

  /** Replaces the link and remembers it. A different link starts with a clean slate. */
  function setLink(next: TranscriptLink | null): void {
    const before = projectLink.value;
    if (before === next) return;
    projectLink.value = next;
    if (!next || !before || before.docId !== next.docId || before.fileName !== next.fileName) {
      folderConflict.value = false;
      folderSaveError.value = null;
      otherProject.value = false;
      folderUnsaved.value = false;
    }
    if (before || next) void saveTranscriptLink(next);
  }

  /** Links the current transcript to its file in the open project (**Add to project**, **Open transcript**). */
  function linkToProject(fileName: string, stat: FileStat): void {
    const current = doc.value;
    const open = project.project;
    if (!current || !open) return;
    setLink({ docId: current.id, projectId: open.id, projectName: open.name, fileName, stat });
  }

  // --- Saving -------------------------------------------------------------------------------------

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The folder saves in progress; they run one at a time, each from the stat the last one returned. */
  let folderRun: Promise<void> | null = null;
  let folderDirty = false;

  /** Writes the current doc to its file once, unless saving there has stopped. */
  async function writeToFolder(): Promise<void> {
    const link = projectLink.value;
    const current = doc.value;
    if (!link || !current || link.docId !== current.id || folderConflict.value) return;
    if (project.status === 'loading') return; // syncLink saves once it's ready
    if (project.status !== 'ready' || !project.project) {
      if (project.status === 'reconnect') {
        folderSaveError.value = new FolderError('permission', FOLDER_MESSAGES.permission);
      } else {
        otherProject.value = true;
      }
      return;
    }
    if (project.project.id !== link.projectId) {
      otherProject.value = true;
      return;
    }
    otherProject.value = false;
    try {
      const stat = await project.saveSessionTranscript(toRaw(current), link.fileName, link.stat);
      if (projectLink.value?.docId === link.docId && projectLink.value.fileName === link.fileName) {
        setLink({ ...projectLink.value, stat });
      }
      folderSaveError.value = null;
      if (doc.value === current && saveTimer === null && !folderDirty) folderUnsaved.value = false;
    } catch (err) {
      const error = asFolderError(err);
      if (error.kind === 'changed') folderConflict.value = true;
      else folderSaveError.value = error;
    }
  }

  /** Saves to the folder now, after any save already running. Resolves when every queued save is done. */
  function saveToFolder(): Promise<void> {
    folderDirty = true;
    folderRun ??= (async () => {
      try {
        while (folderDirty) {
          folderDirty = false;
          await writeToFolder();
        }
      } finally {
        folderRun = null;
      }
    })();
    return folderRun;
  }

  async function saveNow(): Promise<void> {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const current = doc.value;
    if (!current) return;
    saveFailed.value = !(await saveLastTranscript(toRaw(current)));
    if (projectLink.value && folderUnsaved.value) await saveToFolder();
  }

  function scheduleSave(): void {
    if (projectLink.value) folderUnsaved.value = true;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), SAVE_DELAY_MS);
  }

  /** Saves at once, and waits for the folder. For the pipeline and **Open transcript**. */
  async function flush(): Promise<void> {
    if (saveTimer !== null) await saveNow();
    if (folderRun) await folderRun;
  }

  // A rename or edit typed just before the tab closes would otherwise be lost. Best effort: the write
  // may not finish while the page unloads.
  const flushOnPageHide = () => {
    if (saveTimer !== null) void saveNow();
  };
  window.addEventListener('pagehide', flushOnPageHide);
  onScopeDispose(() => {
    window.removeEventListener('pagehide', flushOnPageHide);
    if (saveTimer !== null) clearTimeout(saveTimer);
  });

  // --- Actions ------------------------------------------------------------------------------------

  /** Bumped by setDoc, so an autosave that finishes loading later can't replace a newer doc. */
  let docVersion = 0;

  /** Shows a new transcript and saves it at once. It isn't linked to a project file. */
  function setDoc(next: TranscriptDoc): Promise<void> {
    docVersion++;
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    setLink(null);
    doc.value = next;
    view.value = 'original';
    return saveNow();
  }

  /**
   * Adds the English translation to the doc it was made from, shows it and saves at once. Speaker renames
   * made while it ran are kept. Resolves `false` if that doc has been replaced meanwhile.
   */
  function setTranslation(docId: string, translation: Translation): Promise<boolean> {
    const current = doc.value;
    if (!current || current.id !== docId) return Promise.resolve(false);
    doc.value = { ...current, translations: { ...current.translations, en: translation } };
    view.value = 'en';
    if (projectLink.value) folderUnsaved.value = true;
    return saveNow().then(() => true);
  }

  /** Trims `label`; an empty label restores the default ("Speaker 2"). The save is debounced. */
  function renameSpeaker(speakerId: string, label: string): void {
    const current = doc.value;
    if (!current) return;
    const index = current.speakers.findIndex((s) => s.id === speakerId);
    if (index === -1) return;
    const nextLabel = label.trim() || defaultSpeakerLabel(index);
    if (current.speakers[index]?.label === nextLabel) return;

    doc.value = {
      ...current,
      speakers: current.speakers.map((s, i) => (i === index ? { ...s, label: nextLabel } : s)),
    };
    scheduleSave();
  }

  /**
   * Replaces one turn's text, cleaned (DECISIONS.md D19). Ignores an unknown turn, and text that is
   * empty or unchanged once cleaned. Only that turn gets a new object. The save is debounced.
   * A translation from before D39 doesn't say what it was made from: it takes the text before this edit, as the
   * English counted as current until now, so this edit makes the turn's English out of date.
   */
  function editTurnText(turnId: string, text: string): void {
    const current = doc.value;
    if (!current) return;
    const index = current.turns.findIndex((t) => t.id === turnId);
    const turn = current.turns[index];
    const nextText = cleanTurnText(text);
    if (!turn || nextText === '' || nextText === turn.text) return;

    const en = current.translations.en;
    const translations =
      en && !en.sourceHashes
        ? { ...current.translations, en: { ...en, sourceHashes: turnSourceHashes(current.turns) } }
        : current.translations;
    const turns = current.turns.slice();
    turns[index] = { ...turn, text: nextText };
    doc.value = { ...current, turns, translations };
    scheduleSave();
  }

  /** Removes the transcript from the view and deletes the saved copy ("Clear saved data"). */
  function clear(): Promise<void> {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    docVersion++;
    setLink(null);
    doc.value = null;
    view.value = 'original';
    saveFailed.value = false;
    return clearLastTranscript();
  }

  /** Loads the last transcript, and its project link if any, at app start. Doesn't navigate. */
  async function loadAutosave(): Promise<void> {
    const version = docVersion;
    const saved = await loadLastTranscript();
    const link = saved ? await loadTranscriptLink() : null;
    if (!saved || version !== docVersion || doc.value !== null) return;
    doc.value = saved;
    if (link && link.docId === saved.id) projectLink.value = link;
  }

  // --- The project folder ---------------------------------------------------------------------------

  /** True while **Add to project** writes the first file; the link follows it. */
  let adding = false;

  /**
   * Saves the current transcript into the open project as a new session and links it (**Add to project**). A
   * transcript that is already in the project is linked to its file instead. Throws `FolderError`.
   */
  async function addToProject(): Promise<void> {
    const current = doc.value;
    if (!current) return;
    if (project.session(current.id)) {
      syncLink();
      return;
    }
    adding = true;
    try {
      const { name, stat } = await project.addSessionTranscript(toRaw(current));
      if (doc.value?.id !== current.id) return;
      linkToProject(name, stat);
      // Changed while the file was written: save that too.
      if (doc.value !== current) {
        folderUnsaved.value = true;
        void saveToFolder();
      }
    } finally {
      adding = false;
    }
  }

  /** Opens a project session on Output, linked to its file. The current transcript's changes are saved first. */
  async function openFromProject(sessionId: string): Promise<void> {
    const read = await project.readSessionDoc(sessionId);
    await flush();
    const saving = setDoc(read.doc);
    linkToProject(read.name, read.stat);
    await saving;
  }

  /**
   * **Reload** (the folder's version replaces the open one) or **Keep mine** (the open one overwrites the
   * folder's). Errors show in `folderNotice`.
   */
  async function resolveConflict(choice: 'reload' | 'keep'): Promise<void> {
    const link = projectLink.value;
    const current = doc.value;
    if (!link || !current) return;
    try {
      if (choice === 'reload') {
        const read = await project.readSessionFile(link.fileName);
        if (doc.value?.id !== current.id || read.doc.id !== current.id) return;
        if (saveTimer !== null) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        docVersion++;
        doc.value = read.doc;
        if (!read.doc.translations.en) view.value = 'original';
        setLink({ ...link, stat: read.stat });
        folderConflict.value = false;
        folderSaveError.value = null;
        folderUnsaved.value = false;
        saveFailed.value = !(await saveLastTranscript(read.doc));
      } else {
        await flushTimerOnly();
        const latest = doc.value;
        if (!latest || latest.id !== current.id) return;
        const stat = await project.saveSessionTranscript(toRaw(latest), link.fileName);
        setLink({ ...link, stat });
        folderConflict.value = false;
        folderSaveError.value = null;
        folderUnsaved.value = false;
      }
    } catch (err) {
      folderSaveError.value = asFolderError(err);
    }
  }

  /** Saves a pending change to IndexedDB only; the folder write follows from the caller. */
  async function flushTimerOnly(): Promise<void> {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const current = doc.value;
    if (current) saveFailed.value = !(await saveLastTranscript(toRaw(current)));
  }

  /** **Try again** after a failed save to the folder. */
  function retryFolderSave(): Promise<void> {
    folderSaveError.value = null;
    otherProject.value = false;
    folderUnsaved.value = true;
    return saveToFolder();
  }

  /** **Reconnect**, from the click: asks for access again, then saves what the folder doesn't have. */
  async function reconnectFolder(): Promise<void> {
    if (!(await project.reconnect())) return;
    folderSaveError.value = null;
    folderUnsaved.value = true;
    syncLink();
    if (folderRun) await folderRun;
  }

  /**
   * Matches the transcript with the project once it's ready, after a reload or a rescan (PROJECTS.md §5.2):
   * - linked, and the file is as Describe left it: save any changes the folder doesn't have;
   * - linked, and the file changed: take its stat if it holds the same text, otherwise stop for a choice;
   * - not linked, but the session is in the project: link it by id, and stop for a choice if the two differ;
   * - linked, but its file is gone from the folder (someone deleted it): drop the link, so **Add to project** is
   *   offered again. A file that is there but can't be read keeps the link.
   */
  function syncLink(): void {
    const current = doc.value;
    const open = project.project;
    if (!current || !open || project.status !== 'ready' || adding) return;
    const link = projectLink.value;
    const session = project.session(current.id);

    if (!link) {
      if (!session) return;
      const { name, stat } = session.transcriptFile;
      setLink({
        docId: current.id,
        projectId: open.id,
        projectName: open.name,
        fileName: name,
        stat,
      });
      if (transcriptHash(current) !== session.text.transcriptHash) folderConflict.value = true;
      return;
    }

    if (link.projectId !== open.id) return; // saves say so when there is something to save
    if (link.projectName !== open.name) setLink({ ...link, projectName: open.name });
    otherProject.value = false;
    if (folderSaveError.value?.kind === 'permission') folderSaveError.value = null;
    if (!session) {
      if (!folderRun && !project.hasSessionFile(link.fileName)) setLink(null);
      return;
    }
    // Describe's own save is running: it moves the stat on itself.
    if (folderRun || folderConflict.value) return;

    const file = session.transcriptFile;
    const sameText = transcriptHash(current) === session.text.transcriptHash;
    if (file.name === link.fileName && sameStat(file.stat, link.stat)) {
      if (!sameText || folderUnsaved.value) {
        folderUnsaved.value = true;
        void saveToFolder();
      }
    } else if (sameText) {
      setLink({ ...(projectLink.value ?? link), fileName: file.name, stat: file.stat });
      folderUnsaved.value = false;
    } else {
      folderConflict.value = true;
    }
  }

  watch(
    [() => project.status, () => project.project, () => project.sessions, () => doc.value?.id],
    () => syncLink(),
  );

  return {
    doc,
    view,
    saveFailed,
    hasAutosave,
    autosaveInfo,
    projectLink,
    folderConflict,
    folderSaveError,
    folderUnsaved,
    folderNotice,
    unsavedInProject,
    staleTurnIds,
    setDoc,
    setTranslation,
    renameSpeaker,
    editTurnText,
    clear,
    loadAutosave,
    linkToProject,
    flush,
    addToProject,
    openFromProject,
    resolveConflict,
    retryFolderSave,
    reconnectFolder,
    syncLink,
  };
});
