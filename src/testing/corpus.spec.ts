import { describe, expect, it } from 'vitest';
import { normalizeLanguage } from '../domain/transcript';
import { makeCorpus } from './corpus';

describe('makeCorpus', () => {
  const { docs, planted } = makeCorpus({ hours: 40, seed: 7 });

  it('is the same for the same seed, and different for another', () => {
    expect(makeCorpus({ hours: 40, seed: 7 })).toEqual({ docs, planted });
    expect(makeCorpus({ hours: 40, seed: 8 }).docs[0]?.id).not.toBe(docs[0]?.id);
  });

  it('adds up to the hours asked for, in sessions of 1–3 hours', () => {
    for (const seed of [7, 8, 9, 10]) {
      const sessions = seed === 7 ? docs : makeCorpus({ hours: 40, seed }).docs;
      const total = sessions.reduce((sum, doc) => sum + (doc.result.audioDurationSec ?? 0), 0);
      expect(total / 3600).toBeCloseTo(40, 1);
      for (const doc of sessions) {
        const hours = (doc.result.audioDurationSec ?? 0) / 3600;
        expect(hours).toBeGreaterThanOrEqual(0.999);
        expect(hours).toBeLessThanOrEqual(3.001);
      }
    }
  });

  it('has about 8,300 words an hour', () => {
    const words = docs.reduce(
      (sum, doc) => sum + doc.turns.reduce((n, turn) => n + turn.text.split(' ').length, 0),
      0,
    );
    expect(words / 40).toBeGreaterThan(7800);
    expect(words / 40).toBeLessThan(8800);
  });

  it('gives each session 2–5 speakers, in order of first appearance', () => {
    for (const doc of docs) {
      expect(doc.speakers.length).toBeGreaterThanOrEqual(2);
      expect(doc.speakers.length).toBeLessThanOrEqual(5);
      const firstSeen = [...new Set(doc.turns.map((turn) => turn.speakerId))];
      expect(doc.speakers.map((s) => s.id)).toEqual(firstSeen);
    }
  });

  it('records sessions on later and later dates, with unique ids', () => {
    const dates = docs.map((doc) => doc.source.lastModified);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(new Set(docs.map((doc) => doc.id)).size).toBe(docs.length);
  });

  it('translates every German and French turn, and no English one', () => {
    const languages = new Set(docs.map((doc) => normalizeLanguage(doc.result.languageCode)));
    expect([...languages].sort()).toEqual(['de', 'en', 'fr']);
    for (const doc of docs) {
      const texts = doc.translations.en?.texts;
      if (normalizeLanguage(doc.result.languageCode) === 'en') expect(texts).toBeUndefined();
      else expect(Object.keys(texts ?? {})).toEqual(doc.turns.map((turn) => turn.id));
    }
  });

  it('uses only the languages asked for', () => {
    const french = makeCorpus({ hours: 5, seed: 1, languages: ['fr'] });
    expect(new Set(french.docs.map((doc) => doc.result.languageCode))).toEqual(new Set(['fra']));
  });

  it('plants every phrase at the turn it lists', () => {
    expect(planted).toHaveLength(7);
    for (const p of planted) {
      const doc = docs.find((d) => d.id === p.sessionId);
      const turn = doc?.turns.find((t) => t.id === p.turnId);
      expect(turn?.start).toBe(p.start);
      const text =
        p.field === 'original' ? turn?.text : (doc?.translations.en?.texts[p.turnId] ?? turn?.text);
      expect(text).toContain(p.phrase);
    }
  });

  it('plants only what fits in a small corpus', () => {
    const small = makeCorpus({ hours: 3, seed: 7, languages: ['en'] });
    expect(small.planted.every((p) => p.field === 'english')).toBe(true);
    expect(small.planted.length).toBeLessThan(3);
  });

  it('has no word timings unless asked for', () => {
    expect(docs.every((doc) => doc.turns.every((turn) => turn.words.length === 0))).toBe(true);
    const timed = makeCorpus({ hours: 2, seed: 7, withWords: true });
    for (const turn of timed.docs.flatMap((doc) => doc.turns)) {
      expect(turn.words.map((w) => w.text).join(' ')).toBe(turn.text);
      expect(turn.words[0]?.start).toBe(turn.start);
      expect(turn.words[turn.words.length - 1]?.end).toBeCloseTo(turn.end, 2);
    }
  });
});
