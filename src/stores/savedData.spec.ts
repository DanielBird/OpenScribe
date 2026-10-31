import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { toSessionText } from '../domain/corpus/sessionText';
import { getCachedSession, putCachedSession } from '../storage/corpusCache';
import { loadFolderHandle, saveFolderHandle } from '../storage/folder';
import * as idb from '../storage/idb';
import { makeDoc } from '../testing/transcriptDoc';
import { useGlossaryStore } from './glossary';
import { useJobStore } from './job';
import { useNavStore } from './nav';
import { useProjectStore } from './project';
import { useSavedDataStore } from './savedData';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';

const stored = (key: string) => localStorage.getItem(`describe.v1.${key}`);

describe('savedData store', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await idb.clearLastTranscript();
    setActivePinia(createPinia());
  });

  /** A glossary, changed prefs, a remembered key and a saved transcript shown on Output. */
  async function withEverythingSaved() {
    const glossary = useGlossaryStore();
    glossary.addFromText('Oticon\nHörgerät');
    const settings = useSettingsStore();
    settings.languageHint = 'de';
    settings.setRememberKeys(true);
    settings.setKey('elevenlabs', 'test-key');
    const transcript = useTranscriptStore();
    await transcript.setDoc(makeDoc());
    const nav = useNavStore();
    nav.goTo('output');
    return { glossary, settings, transcript, nav };
  }

  it('clears the glossary, prefs and last transcript, and keeps the keys', async () => {
    const { glossary, settings, transcript } = await withEverythingSaved();
    await useSavedDataStore().clearSavedData();

    expect(glossary.terms).toEqual([]);
    expect(stored('glossary')).toBe('[]');
    expect(settings.languageHint).toBe('auto');
    expect(stored('prefs')).toBeNull();
    expect(transcript.doc).toBeNull();
    await expect(idb.loadLastTranscript()).resolves.toBeNull();

    expect(settings.elevenLabsKey).toBe('test-key');
    expect(stored('key.elevenlabs')).toBe('"test-key"');
  });

  it('goes back to Setup when Output has nothing left to show', async () => {
    const { nav } = await withEverythingSaved();
    await useSavedDataStore().clearSavedData();
    expect(nav.step).toBe('setup');
    expect(nav.canEnter('output')).toBe(false);
  });

  it('on Home, puts Transcribe back on Setup and stays on Home', async () => {
    const { nav } = await withEverythingSaved();
    nav.goHome();
    await useSavedDataStore().clearSavedData();
    expect(nav.mode).toBe('home');
    expect(nav.step).toBe('setup');
  });

  it('stays on the current step when it can still be entered', async () => {
    const { nav } = await withEverythingSaved();
    nav.goTo('glossary');
    await useSavedDataStore().clearSavedData();
    expect(nav.step).toBe('glossary');
  });

  it('closes a finished run so Output is locked again', async () => {
    const { nav } = await withEverythingSaved();
    const job = useJobStore();
    job.status = 'done';
    await useSavedDataStore().clearSavedData();
    expect(job.status).toBe('idle');
    expect(nav.step).toBe('setup');
  });

  it('leaves a running transcription alone, on Output', async () => {
    const { nav } = await withEverythingSaved();
    const job = useJobStore();
    job.status = 'uploading';
    await useSavedDataStore().clearSavedData();
    expect(job.status).toBe('uploading');
    expect(nav.step).toBe('output');
  });

  it('forgets the project folder and empties the text cache', async () => {
    const stat = { size: 1, lastModified: 2 };
    const handle = { kind: 'directory', name: 'Hearing' } as unknown as FileSystemDirectoryHandle;
    await saveFolderHandle(handle, 'Hearing at home');
    await putCachedSession('p1', 'a.transcript.json', stat, {
      savedAt: '2026-10-01T00:00:00Z',
      text: toSessionText(makeDoc()),
    });
    const project = useProjectStore();
    project.projectName = 'Hearing at home';

    await useSavedDataStore().clearSavedData();
    await expect(loadFolderHandle()).resolves.toBeNull();
    await expect(getCachedSession('p1', 'a.transcript.json', stat)).resolves.toBeNull();
    expect(project.projectName).toBeNull();
  });
});
