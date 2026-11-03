import { describe, expect, it } from 'vitest';
import {
  makeDoc,
  TEST_TRANSLATION_TEXTS,
  withEditedTurn,
  withSourceHashes,
  withTranslation,
} from '../testing/transcriptDoc';
import { hashText } from './hash';
import { currentTexts, staleTurnIds, turnSourceHashes } from './translation';

describe('turnSourceHashes', () => {
  it("hashes each turn's text, by turn id", () => {
    const doc = makeDoc();
    const hashes = turnSourceHashes(doc.turns);
    expect(Object.keys(hashes)).toEqual(doc.turns.map((t) => t.id));
    expect(hashes.t1).toBe(hashText(doc.turns[0]!.text));
  });
});

describe('currentTexts', () => {
  it('keeps every text while the turns are as they were translated', () => {
    const doc = withSourceHashes(withTranslation(makeDoc()));
    expect(currentTexts(doc.translations.en!, doc.turns)).toEqual(TEST_TRANSLATION_TEXTS);
  });

  it('drops the text of a turn whose text has changed since', () => {
    const doc = withEditedTurn(withSourceHashes(withTranslation(makeDoc())), 't2', 'Danke schön.');
    const kept = currentTexts(doc.translations.en!, doc.turns);
    expect(kept).not.toHaveProperty('t2');
    expect(Object.keys(kept)).toEqual(['t1', 't3', 't4', 't5']);
  });

  it('counts a translation without hashes (before D39) as current', () => {
    const doc = withEditedTurn(withTranslation(makeDoc()), 't2', 'Danke schön.');
    expect(currentTexts(doc.translations.en!, doc.turns)).toEqual(TEST_TRANSLATION_TEXTS);
  });

  it('keeps only the turns given, and only those with a text', () => {
    const doc = makeDoc();
    const kept = currentTexts({ texts: { t1: 'Hello', gone: 'Bye' } }, doc.turns);
    expect(kept).toEqual({ t1: 'Hello' });
  });

  it('drops a text whose turn has no hash', () => {
    const doc = makeDoc();
    const kept = currentTexts({ texts: { t1: 'Hello' }, sourceHashes: {} }, doc.turns);
    expect(kept).toEqual({});
  });
});

describe('staleTurnIds', () => {
  it('lists the turns changed since the translation', () => {
    let doc = withSourceHashes(withTranslation(makeDoc()));
    expect(staleTurnIds(doc)).toEqual([]);
    doc = withEditedTurn(withEditedTurn(doc, 't4', 'Etwa zwei Jahre.'), 't2', 'Danke.');
    expect(staleTurnIds(doc)).toEqual(['t2', 't4']);
  });

  it('lists a turn the translation has no text for', () => {
    const doc = withTranslation(makeDoc(), { t1: 'Good afternoon.' });
    expect(staleTurnIds(doc)).toEqual(['t2', 't3', 't4', 't5']);
  });

  it('is empty without a translation, and for an English transcript', () => {
    expect(staleTurnIds(makeDoc())).toEqual([]);
    const doc = withEditedTurn(withSourceHashes(withTranslation(makeDoc())), 't2', 'Thanks.');
    expect(staleTurnIds({ ...doc, result: { ...doc.result, languageCode: 'en' } })).toEqual([]);
  });
});
