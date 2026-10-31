import { describe, expect, it } from 'vitest';
import { makeDoc, TEST_TRANSLATION_TEXTS, withTranslation } from '../../testing/transcriptDoc';
import type { TranscriptDoc } from '../transcript';
import {
  englishText,
  isEnglishSession,
  isTranslatedSession,
  toSessionText,
  transcriptHash,
} from './sessionText';

/** `makeDoc()` with its language set to English. */
function englishDoc(): TranscriptDoc {
  const doc = makeDoc();
  return { ...doc, result: { ...doc.result, languageCode: 'eng' } };
}

describe('toSessionText', () => {
  it('keeps what search, cards and quotes need', () => {
    const doc = makeDoc();
    const session = toSessionText(doc);
    expect(session).toMatchObject({
      sessionId: doc.id,
      recordingName: 'interview.mp3',
      recordedAt: 1_760_000_000_000,
      durationSec: 16.6,
      languageCode: 'deu',
      speakers: doc.speakers,
      transcriptHash: transcriptHash(doc),
    });
    expect(session.turns).toHaveLength(doc.turns.length);
    expect(session.turns[0]).toEqual({
      id: 't1',
      speakerId: doc.turns[0]?.speakerId,
      start: doc.turns[0]?.start,
      text: doc.turns[0]?.text,
      en: null,
    });
  });

  it('drops the word timings', () => {
    const session = toSessionText(makeDoc());
    for (const turn of session.turns) expect(turn).not.toHaveProperty('words');
    expect(JSON.stringify(session)).not.toContain('logprob');
  });

  it('falls back to the probed duration', () => {
    const doc = makeDoc();
    const session = toSessionText({ ...doc, result: { ...doc.result, audioDurationSec: null } });
    expect(session.durationSec).toBe(17.5);
  });

  it('copies the speakers', () => {
    const doc = makeDoc();
    expect(toSessionText(doc).speakers[0]).not.toBe(doc.speakers[0]);
  });

  describe('a German session', () => {
    it('without a translation has no English text', () => {
      const session = toSessionText(makeDoc());
      expect(isEnglishSession(session)).toBe(false);
      expect(isTranslatedSession(session)).toBe(false);
      for (const turn of session.turns) {
        expect(turn.en).toBeNull();
        expect(englishText(session, turn)).toBeNull();
      }
    });

    it('with a translation takes its English text from the translation', () => {
      const session = toSessionText(withTranslation(makeDoc()));
      expect(isTranslatedSession(session)).toBe(true);
      for (const turn of session.turns) {
        expect(turn.en).toBe(TEST_TRANSLATION_TEXTS[turn.id]);
        expect(englishText(session, turn)).toBe(TEST_TRANSLATION_TEXTS[turn.id]);
      }
    });
  });

  describe('an English session', () => {
    it('uses its own text as the English text', () => {
      const session = toSessionText(englishDoc());
      expect(isEnglishSession(session)).toBe(true);
      expect(isTranslatedSession(session)).toBe(false);
      for (const turn of session.turns) {
        expect(turn.en).toBeNull();
        expect(englishText(session, turn)).toBe(turn.text);
      }
    });

    it('ignores a translation', () => {
      const session = toSessionText(withTranslation(englishDoc()));
      expect(isTranslatedSession(session)).toBe(false);
      for (const turn of session.turns) {
        expect(turn.en).toBeNull();
        expect(englishText(session, turn)).toBe(turn.text);
      }
    });

    it.each(['en', 'eng', 'en-GB', 'EN'])('recognises the language code %s', (languageCode) => {
      const doc = englishDoc();
      expect(
        isEnglishSession(toSessionText({ ...doc, result: { ...doc.result, languageCode } })),
      ).toBe(true);
    });
  });
});

describe('transcriptHash', () => {
  const doc = withTranslation(makeDoc());
  const base = transcriptHash(doc);

  it('is stable', () => {
    expect(transcriptHash(withTranslation(makeDoc()))).toBe(base);
  });

  it('changes when a speaker is renamed', () => {
    const speakers = doc.speakers.map((s, i) => (i === 0 ? { ...s, label: 'Interviewer' } : s));
    expect(transcriptHash({ ...doc, speakers })).not.toBe(base);
  });

  it('changes when a turn text is edited', () => {
    const turns = doc.turns.map((t, i) => (i === 2 ? { ...t, text: `${t.text}!` } : t));
    expect(transcriptHash({ ...doc, turns })).not.toBe(base);
  });

  it('changes when a turn moves to another speaker', () => {
    const turns = doc.turns.map((t, i) => (i === 0 ? { ...t, speakerId: 'speaker_1' } : t));
    expect(transcriptHash({ ...doc, turns })).not.toBe(base);
  });

  it('changes with a new or different translation', () => {
    expect(transcriptHash(makeDoc())).not.toBe(base);
    const texts = { ...TEST_TRANSLATION_TEXTS, t3: 'How long have you worked on the project?' };
    expect(transcriptHash(withTranslation(makeDoc(), texts))).not.toBe(base);
  });

  it('does not change with word timings, times, dates or the translation model', () => {
    const translation = doc.translations.en;
    if (!translation) throw new Error('expected a translation');
    const changed: TranscriptDoc = {
      ...doc,
      createdAt: '2027-01-01T00:00:00Z',
      source: { ...doc.source, lastModified: 0, durationSec: 99 },
      result: { ...doc.result, audioDurationSec: 99, languageProbability: 0.5 },
      turns: doc.turns.map((t) => ({
        ...t,
        start: t.start + 1,
        end: t.end + 1,
        words: t.words.map((w) => ({ ...w, start: w.start + 1, logprob: -1 })),
      })),
      translations: {
        en: {
          ...translation,
          provider: 'gemini',
          model: 'other',
          createdAt: '2027-01-01T00:00:00Z',
        },
      },
    };
    expect(transcriptHash(changed)).toBe(base);
  });

  it('ignores a translation of an English session', () => {
    expect(transcriptHash(withTranslation(englishDoc()))).toBe(transcriptHash(englishDoc()));
  });
});
