import 'fake-indexeddb/auto';
import { createStore, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc } from '../testing/transcriptDoc';
import {
  clearLastTranscript,
  loadLastTranscript,
  loadTranscriptLink,
  saveLastTranscript,
  saveTranscriptLink,
} from './idb';

/** Writes a raw value where the app keeps the last transcript, bypassing the app's own save. */
const writeRaw = (value: unknown) =>
  set('describe.v1.lastTranscript', value, createStore('describe-v1', 'keyval'));

describe('last transcript in IndexedDB', () => {
  beforeEach(async () => {
    await clearLastTranscript();
  });

  it('returns null when nothing is saved', async () => {
    await expect(loadLastTranscript()).resolves.toBeNull();
  });

  it('saves and loads a transcript unchanged', async () => {
    const doc = makeDoc({
      translations: {
        en: {
          provider: 'claude',
          model: 'm',
          createdAt: '2026-10-13T00:00:00Z',
          texts: { t1: 'Hi' },
        },
      },
    });
    await expect(saveLastTranscript(doc)).resolves.toBe(true);
    await expect(loadLastTranscript()).resolves.toEqual(doc);
  });

  it('clears the saved transcript', async () => {
    await saveLastTranscript(makeDoc());
    await clearLastTranscript();
    await expect(loadLastTranscript()).resolves.toBeNull();
  });

  it('ignores a transcript from another schema version', async () => {
    await writeRaw({ ...makeDoc(), schemaVersion: 2 });
    await expect(loadLastTranscript()).resolves.toBeNull();
  });

  it.each([
    ['not an object', 'hello'],
    ['missing turns', { ...makeDoc(), turns: undefined }],
    [
      'a turn without words',
      { ...makeDoc(), turns: [{ id: 't1', speakerId: 's', start: 0, end: 1, text: 'x' }] },
    ],
    ['a speaker without a label', { ...makeDoc(), speakers: [{ id: 'speaker_0' }] }],
  ])('ignores a damaged transcript (%s)', async (_name, value) => {
    await writeRaw(value);
    await expect(loadLastTranscript()).resolves.toBeNull();
  });
});

describe('without IndexedDB', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('loads null, reports a failed save and clears quietly', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const idb = await import('./idb');
    await expect(idb.loadLastTranscript()).resolves.toBeNull();
    await expect(idb.saveLastTranscript(makeDoc())).resolves.toBe(false);
    await expect(idb.clearLastTranscript()).resolves.toBeUndefined();
  });
});

describe("the last transcript's project link", () => {
  const link = {
    docId: makeDoc().id,
    projectId: 'project-1',
    projectName: 'Hearing at home',
    fileName: 'P07--3f9a1c2e.transcript.json',
    stat: { size: 1200, lastModified: 1_760_000_000_000 },
  };
  const writeRawLink = (value: unknown) =>
    set('describe.v1.lastTranscriptLink', value, createStore('describe-v1', 'keyval'));

  beforeEach(async () => {
    await saveTranscriptLink(null);
  });

  it('saves, loads and removes the link', async () => {
    await expect(loadTranscriptLink()).resolves.toBeNull();
    await expect(saveTranscriptLink(link)).resolves.toBe(true);
    await expect(loadTranscriptLink()).resolves.toEqual(link);
    await saveTranscriptLink(null);
    await expect(loadTranscriptLink()).resolves.toBeNull();
  });

  it('ignores a damaged link', async () => {
    await writeRawLink({ ...link, stat: { size: 'big' } });
    await expect(loadTranscriptLink()).resolves.toBeNull();
    await writeRawLink('not a link');
    await expect(loadTranscriptLink()).resolves.toBeNull();
  });
});
