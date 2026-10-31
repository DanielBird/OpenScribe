import 'fake-indexeddb/auto';
import { createStore, keys, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toSessionText } from '../domain/corpus/sessionText';
import { makeDoc, withTranslation } from '../testing/transcriptDoc';
import {
  clearCorpusCache,
  getCachedSession,
  pruneCorpusCache,
  putCachedSession,
} from './corpusCache';

const STAT = { size: 1234, lastModified: 1_760_000_000_000 };
const SESSION = {
  savedAt: '2026-10-02T00:00:00.000Z',
  text: toSessionText(withTranslation(makeDoc())),
};
const rawStore = () => createStore('describe-v1-corpus', 'sessions');

describe('the corpus cache', () => {
  beforeEach(async () => {
    await clearCorpusCache();
  });

  it('misses when nothing is cached', async () => {
    await expect(getCachedSession('p1', 'a.transcript.json', STAT)).resolves.toBeNull();
  });

  it('hits with the same stat, and gives back the text and savedAt', async () => {
    await putCachedSession('p1', 'a.transcript.json', STAT, SESSION);
    await expect(getCachedSession('p1', 'a.transcript.json', { ...STAT })).resolves.toEqual(
      SESSION,
    );
  });

  it('misses when the size or the modification time changed', async () => {
    await putCachedSession('p1', 'a.transcript.json', STAT, SESSION);
    await expect(
      getCachedSession('p1', 'a.transcript.json', { ...STAT, size: STAT.size + 1 }),
    ).resolves.toBeNull();
    await expect(
      getCachedSession('p1', 'a.transcript.json', { ...STAT, lastModified: STAT.lastModified + 1 }),
    ).resolves.toBeNull();
  });

  it('keeps projects apart', async () => {
    await putCachedSession('p1', 'a.transcript.json', STAT, SESSION);
    await expect(getCachedSession('p2', 'a.transcript.json', STAT)).resolves.toBeNull();
  });

  it.each([
    ['not an object', 'x'],
    ['no text', { ...STAT, savedAt: 'x' }],
    ['a damaged turn', { ...STAT, savedAt: 'x', text: { ...SESSION.text, turns: [{ id: 't1' }] } }],
  ])('ignores a bad entry (%s)', async (_name, value) => {
    await set('p1/a.transcript.json', value, rawStore());
    await expect(getCachedSession('p1', 'a.transcript.json', STAT)).resolves.toBeNull();
  });

  it("prunes a project's files that are gone, and nothing else", async () => {
    await putCachedSession('p1', 'a.transcript.json', STAT, SESSION);
    await putCachedSession('p1', 'b.transcript.json', STAT, SESSION);
    await putCachedSession('p2', 'b.transcript.json', STAT, SESSION);
    await pruneCorpusCache('p1', ['a.transcript.json']);
    expect((await keys(rawStore())).sort()).toEqual([
      'p1/a.transcript.json',
      'p2/b.transcript.json',
    ]);
  });

  it('clears every project', async () => {
    await putCachedSession('p1', 'a.transcript.json', STAT, SESSION);
    await putCachedSession('p2', 'b.transcript.json', STAT, SESSION);
    await clearCorpusCache();
    expect(await keys(rawStore())).toEqual([]);
  });
});

describe('without IndexedDB', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('always misses, and every call resolves quietly', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const cache = await import('./corpusCache');
    await expect(cache.putCachedSession('p1', 'a', STAT, SESSION)).resolves.toBeUndefined();
    await expect(cache.getCachedSession('p1', 'a', STAT)).resolves.toBeNull();
    await expect(cache.pruneCorpusCache('p1', [])).resolves.toBeUndefined();
    await expect(cache.clearCorpusCache()).resolves.toBeUndefined();
  });
});
