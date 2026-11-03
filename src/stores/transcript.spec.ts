import 'fake-indexeddb/auto';
import { createStore, set } from 'idb-keyval';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { turnSourceHashes } from '../domain/translation';
import * as idb from '../storage/idb';
import {
  makeDoc,
  TEST_TRANSLATION_TEXTS,
  withSourceHashes,
  withTranslation,
} from '../testing/transcriptDoc';
import { SAVE_DELAY_MS, useTranscriptStore } from './transcript';

// The real IndexedDB code (on fake-indexeddb), with the save and load counted.
vi.mock('../storage/idb', async (importOriginal) => {
  const real = await importOriginal<typeof import('../storage/idb')>();
  return {
    ...real,
    saveLastTranscript: vi.fn(real.saveLastTranscript),
    loadLastTranscript: vi.fn(real.loadLastTranscript),
  };
});

const save = vi.mocked(idb.saveLastTranscript);
const load = vi.mocked(idb.loadLastTranscript);
// fake-indexeddb schedules its work with setImmediate, so only the debounce's timeouts are faked.
const useFakeTimeouts = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
const writeRaw = (value: unknown) =>
  set('describe.v1.lastTranscript', value, createStore('describe-v1', 'keyval'));

describe('transcript store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await idb.clearLastTranscript();
    save.mockClear();
    load.mockClear();
  });

  afterEach(() => {
    // Removes the store's pagehide listener and pending save, so they can't leak into the next test.
    useTranscriptStore().$dispose();
    vi.useRealTimers();
  });

  describe('clear', () => {
    it('removes the doc and the saved copy', async () => {
      const store = useTranscriptStore();
      await store.setDoc(makeDoc());
      store.view = 'en';
      await store.clear();
      expect(store.doc).toBeNull();
      expect(store.view).toBe('original');
      expect(store.hasAutosave).toBe(false);
      await expect(idb.loadLastTranscript()).resolves.toBeNull();
    });

    it('drops a pending rename save and resets saveFailed', async () => {
      const store = useTranscriptStore();
      save.mockResolvedValueOnce(false);
      await store.setDoc(makeDoc());
      expect(store.saveFailed).toBe(true);
      useFakeTimeouts();
      store.renameSpeaker('speaker_0', 'Interviewer');
      await store.clear();
      expect(store.saveFailed).toBe(false);
      save.mockClear();
      vi.advanceTimersByTime(SAVE_DELAY_MS * 2);
      expect(save).not.toHaveBeenCalled();
    });

    it('keeps an autosave that loads afterwards from coming back', async () => {
      await idb.saveLastTranscript(makeDoc());
      const store = useTranscriptStore();
      const loading = store.loadAutosave();
      await store.clear();
      await loading;
      expect(store.doc).toBeNull();
    });
  });

  describe('setDoc', () => {
    it('shows the doc and saves it at once', async () => {
      const store = useTranscriptStore();
      const doc = makeDoc();
      await store.setDoc(doc);
      expect(store.doc).toBe(doc);
      expect(store.hasAutosave).toBe(true);
      expect(store.autosaveInfo).toEqual({
        fileName: 'interview.mp3',
        createdAt: '2026-10-13T12:05:00.000Z',
      });
      expect(save).toHaveBeenCalledExactlyOnceWith(doc);
      await expect(idb.loadLastTranscript()).resolves.toEqual(doc);
    });

    it('reports a failed save', async () => {
      const store = useTranscriptStore();
      save.mockResolvedValueOnce(false);
      await store.setDoc(makeDoc());
      expect(store.saveFailed).toBe(true);
      await store.setDoc(makeDoc());
      expect(store.saveFailed).toBe(false);
    });
  });

  describe('renameSpeaker', () => {
    it('replaces the doc immutably with the trimmed label', async () => {
      const store = useTranscriptStore();
      const before = makeDoc();
      await store.setDoc(before);

      store.renameSpeaker('speaker_0', '  Interviewer  ');

      expect(store.doc).not.toBe(before);
      expect(store.doc?.speakers).not.toBe(before.speakers);
      expect(store.doc?.speakers.map((s) => s.label)).toEqual(['Interviewer', 'Speaker 2']);
      expect(store.doc?.turns).toBe(before.turns); // untouched parts are shared
      expect(before.speakers[0]?.label).toBe('Speaker 1');
    });

    it('restores the default label when the name is empty', async () => {
      const store = useTranscriptStore();
      await store.setDoc(makeDoc());
      store.renameSpeaker('speaker_1', 'Guest');
      store.renameSpeaker('speaker_1', '   ');
      expect(store.doc?.speakers[1]?.label).toBe('Speaker 2');
    });

    it('does nothing for an unknown speaker, an unchanged label or no doc', async () => {
      const store = useTranscriptStore();
      store.renameSpeaker('speaker_0', 'Nobody'); // no doc
      expect(store.doc).toBeNull();

      await store.setDoc(makeDoc());
      const doc = store.doc;
      store.renameSpeaker('speaker_9', 'Ghost');
      store.renameSpeaker('speaker_0', 'Speaker 1 ');
      expect(store.doc).toBe(doc);
    });

    it('saves once, 500 ms after the last change', async () => {
      useFakeTimeouts();
      const store = useTranscriptStore();
      await store.setDoc(makeDoc());
      save.mockClear();

      store.renameSpeaker('speaker_0', 'I');
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 100);
      store.renameSpeaker('speaker_0', 'In');
      store.renameSpeaker('speaker_0', 'Interviewer');
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
      expect(save).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledOnce();
      expect(save.mock.calls[0]?.[0].speakers[0]?.label).toBe('Interviewer');
    });

    it('a new doc cancels a pending rename save', async () => {
      useFakeTimeouts();
      const store = useTranscriptStore();
      await store.setDoc(makeDoc());
      store.renameSpeaker('speaker_0', 'Interviewer');
      const next = makeDoc({ id: 'next' });
      await store.setDoc(next);
      save.mockClear();
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
      expect(save).not.toHaveBeenCalled();
    });

    it('saves a pending rename when the page is hidden', async () => {
      useFakeTimeouts();
      const store = useTranscriptStore();
      await store.setDoc(makeDoc());
      save.mockClear();
      store.renameSpeaker('speaker_0', 'Interviewer');
      window.dispatchEvent(new Event('pagehide'));
      expect(save).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
      expect(save).toHaveBeenCalledOnce();
    });
  });

  describe('editTurnText', () => {
    it('replaces only the edited turn, keeping its words, times and speaker', async () => {
      const store = useTranscriptStore();
      const before = withSourceHashes(withTranslation(makeDoc()));
      await store.setDoc(before);

      store.editTurnText('t2', 'Danke, ich bin gern hier.');

      const after = store.doc!;
      expect(after).not.toBe(before);
      expect(after.turns).not.toBe(before.turns);
      expect(after.turns[1]).toEqual({ ...before.turns[1], text: 'Danke, ich bin gern hier.' });
      expect(after.turns[1]?.words).toBe(before.turns[1]?.words);
      after.turns.forEach((turn, i) => {
        if (i !== 1) expect(turn).toBe(before.turns[i]);
      });
      expect(after.speakers).toBe(before.speakers);
      expect(after.translations).toBe(before.translations);
      expect(before.turns[1]?.text).toBe(makeDoc().turns[1]?.text);
    });

    it("marks the edited turn's English out of date (D39)", async () => {
      const store = useTranscriptStore();
      await store.setDoc(withSourceHashes(withTranslation(makeDoc())));
      expect(store.staleTurnIds).toEqual([]);
      store.editTurnText('t2', 'Danke, ich bin gern hier.');
      expect(store.staleTurnIds).toEqual(['t2']);
    });

    it('records what a translation from before D39 was made from: the text before the edit', async () => {
      const store = useTranscriptStore();
      const before = withTranslation(makeDoc());
      await store.setDoc(before);

      store.editTurnText('t2', 'Danke, ich bin gern hier.');

      expect(store.doc?.translations.en?.sourceHashes).toEqual(turnSourceHashes(before.turns));
      expect(store.doc?.translations.en?.texts).toBe(before.translations.en?.texts);
      expect(store.staleTurnIds).toEqual(['t2']);
      store.editTurnText('t4', 'Etwa zwei Jahre.');
      expect(store.staleTurnIds).toEqual(['t2', 't4']);
    });

    it('leaves a doc without a translation without one', async () => {
      const store = useTranscriptStore();
      await store.setDoc(makeDoc());
      store.editTurnText('t2', 'Danke.');
      expect(store.doc?.translations).toEqual({});
      expect(store.staleTurnIds).toEqual([]);
    });

    it('cleans the text', async () => {
      const store = useTranscriptStore();
      await store.setDoc(makeDoc());
      store.editTurnText('t1', '  Guten\r\nTag  zusammen. \n');
      expect(store.doc?.turns[0]?.text).toBe('Guten Tag  zusammen.');
    });

    it('does nothing for an unknown turn, empty or unchanged text, or no doc', async () => {
      const store = useTranscriptStore();
      store.editTurnText('t1', 'Hello'); // no doc
      expect(store.doc).toBeNull();

      useFakeTimeouts();
      await store.setDoc(makeDoc());
      const doc = store.doc;
      save.mockClear();
      store.editTurnText('t99', 'Ghost');
      store.editTurnText('t1', ' \n ');
      store.editTurnText('t1', `${doc!.turns[0]!.text}\n`);
      expect(store.doc).toBe(doc);
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
      expect(save).not.toHaveBeenCalled();
    });

    it('saves once, 500 ms after the last change', async () => {
      useFakeTimeouts();
      const store = useTranscriptStore();
      await store.setDoc(makeDoc());
      save.mockClear();

      store.editTurnText('t1', 'G');
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 100);
      store.editTurnText('t1', 'Gu');
      store.editTurnText('t3', 'Wie lange schon?');
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
      expect(save).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledOnce();
      const saved = save.mock.calls[0]?.[0];
      expect([saved?.turns[0]?.text, saved?.turns[2]?.text]).toEqual(['Gu', 'Wie lange schon?']);
    });

    it('saves a pending edit when the page is hidden', async () => {
      useFakeTimeouts();
      const store = useTranscriptStore();
      await store.setDoc(makeDoc());
      save.mockClear();
      store.editTurnText('t1', 'Hallo.');
      window.dispatchEvent(new Event('pagehide'));
      expect(save).toHaveBeenCalledOnce();
      expect(save.mock.calls[0]?.[0].turns[0]?.text).toBe('Hallo.');
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
      expect(save).toHaveBeenCalledOnce();
    });
  });

  describe('setTranslation', () => {
    const translation = {
      provider: 'claude' as const,
      model: 'claude-opus-5-5',
      createdAt: '2026-10-13T12:30:00Z',
      texts: TEST_TRANSLATION_TEXTS,
    };

    it('adds the translation immutably, shows English and saves at once', async () => {
      const store = useTranscriptStore();
      const before = makeDoc();
      await store.setDoc(before);
      save.mockClear();

      await expect(store.setTranslation(before.id, translation)).resolves.toBe(true);

      expect(store.doc).not.toBe(before);
      expect(store.doc?.translations.en).toEqual(translation);
      expect(before.translations.en).toBeUndefined();
      expect(store.view).toBe('en');
      expect(save).toHaveBeenCalledOnce();
      await expect(idb.loadLastTranscript()).resolves.toEqual(store.doc);
    });

    it('keeps a speaker rename made while it ran, and saves it with the translation', async () => {
      useFakeTimeouts();
      const store = useTranscriptStore();
      const doc = makeDoc();
      await store.setDoc(doc);
      store.renameSpeaker('speaker_0', 'Interviewer');
      save.mockClear();

      await store.setTranslation(doc.id, translation);
      expect(store.doc?.speakers[0]?.label).toBe('Interviewer');
      expect(save).toHaveBeenCalledOnce();
      expect(save.mock.calls[0]?.[0].speakers[0]?.label).toBe('Interviewer');
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
      expect(save).toHaveBeenCalledOnce(); // the pending rename save was folded in
    });

    it('does nothing when the doc has been replaced', async () => {
      const store = useTranscriptStore();
      await store.setDoc(makeDoc({ id: 'next' }));
      const current = store.doc;
      save.mockClear();
      await expect(store.setTranslation('old', translation)).resolves.toBe(false);
      expect(store.doc).toBe(current);
      expect(store.view).toBe('original');
      expect(save).not.toHaveBeenCalled();
    });

    it('a new doc shows the original again', async () => {
      const store = useTranscriptStore();
      const doc = makeDoc();
      await store.setDoc(doc);
      await store.setTranslation(doc.id, translation);
      await store.setDoc(makeDoc({ id: 'next' }));
      expect(store.view).toBe('original');
    });
  });

  describe('loadAutosave', () => {
    it('loads a valid saved transcript without saving it again', async () => {
      const doc = makeDoc();
      await idb.saveLastTranscript(doc);
      save.mockClear();
      const store = useTranscriptStore();
      await store.loadAutosave();
      expect(store.doc).toEqual(doc);
      expect(store.hasAutosave).toBe(true);
      expect(save).not.toHaveBeenCalled();
    });

    it.each([
      ['nothing saved', undefined],
      ['an invalid doc', { ...makeDoc(), turns: 'nope' }],
      ['a doc from another schema version', { ...makeDoc(), schemaVersion: 2 }],
    ])('leaves the store empty with %s', async (_name, value) => {
      if (value !== undefined) await writeRaw(value);
      const store = useTranscriptStore();
      await store.loadAutosave();
      expect(store.doc).toBeNull();
      expect(store.hasAutosave).toBe(false);
      expect(store.autosaveInfo).toBeNull();
    });

    it("doesn't replace a doc set while it was loading", async () => {
      await idb.saveLastTranscript(makeDoc({ id: 'old' }));
      const store = useTranscriptStore();
      const loading = store.loadAutosave();
      const fresh = makeDoc({ id: 'fresh' });
      await store.setDoc(fresh);
      await loading;
      expect(store.doc).toBe(fresh);
    });
  });
});
