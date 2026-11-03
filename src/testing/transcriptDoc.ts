// Test-only helpers: realistic TranscriptDocs built from the ElevenLabs fixtures. Not imported by the app.
import twoSpeakers from '../../fixtures/elevenlabs/two-speakers-short.json';
import { buildTranscriptDoc } from '../domain/buildTranscriptDoc';
import type {
  SourceInfo,
  Speaker,
  TranscriptDoc,
  TranscriptionRequestInfo,
  Turn,
} from '../domain/transcript';
import { turnSourceHashes } from '../domain/translation';
import { toNormalized } from '../providers/transcription/elevenlabs/mapper';
import { FUTURE_FIELD } from './projectSeed';

export const TEST_SOURCE: SourceInfo = {
  fileName: 'interview.mp3',
  fileSize: 1_234_567,
  mimeType: 'audio/mpeg',
  lastModified: 1_760_000_000_000,
  durationSec: 17.5,
};

export const TEST_REQUEST: TranscriptionRequestInfo = {
  provider: 'elevenlabs',
  model: 'scribe_v2',
  languageHint: 'auto',
  numSpeakers: null,
  zeroRetention: false,
  keyterms: [],
};

/** The German two-speaker fixture: speakers `speaker_0`/`speaker_1`, five turns starting at 0.2 s … 13.8 s. */
export function makeDoc(overrides: Partial<TranscriptDoc> = {}): TranscriptDoc {
  const doc = buildTranscriptDoc(toNormalized(twoSpeakers), TEST_SOURCE, TEST_REQUEST, {
    now: () => new Date('2026-10-13T12:05:00Z'),
    uuid: () => '00000000-0000-4000-8000-000000000001',
  });
  return { ...doc, ...overrides };
}

/** English texts for the five turns of `makeDoc()`. */
export const TEST_TRANSLATION_TEXTS: Record<string, string> = {
  t1: 'Good afternoon and welcome to our conversation.',
  t2: "Thank you, I'm very pleased to be here.",
  t3: 'How long have you been working on the project?',
  t4: 'For about two years, together with a small team.',
  t5: 'What has been the biggest challenge so far?',
};

/** `doc` with a complete Claude translation (`TEST_TRANSLATION_TEXTS`, or `texts` if given). */
export function withTranslation(
  doc: TranscriptDoc,
  texts: Record<string, string> = TEST_TRANSLATION_TEXTS,
): TranscriptDoc {
  return {
    ...doc,
    translations: {
      en: {
        provider: 'claude',
        model: 'claude-opus-5-5',
        createdAt: '2026-10-13T12:30:00Z',
        texts,
      },
    },
  };
}

/** `doc` with its translation made from the turns' current text (DECISIONS.md D39), as this build saves one. */
export function withSourceHashes(doc: TranscriptDoc): TranscriptDoc {
  const en = doc.translations.en;
  if (!en) return doc;
  return {
    ...doc,
    translations: { ...doc.translations, en: { ...en, sourceHashes: turnSourceHashes(doc.turns) } },
  };
}

/** `doc` with turn `turnId`'s text replaced, as Edit text does: its English, if any, is now out of date. */
export function withEditedTurn(doc: TranscriptDoc, turnId: string, text: string): TranscriptDoc {
  return { ...doc, turns: doc.turns.map((t) => (t.id === turnId ? { ...t, text } : t)) };
}

/** `doc` with `FUTURE_FIELD` on it and on every object in it, as a newer build might have saved it (D38). */
export function withFutureFields(doc: TranscriptDoc): TranscriptDoc {
  const en = doc.translations.en;
  return {
    ...doc,
    ...FUTURE_FIELD,
    source: { ...doc.source, ...FUTURE_FIELD },
    request: { ...doc.request, ...FUTURE_FIELD },
    result: { ...doc.result, ...FUTURE_FIELD },
    speakers: doc.speakers.map((s) => ({ ...s, ...FUTURE_FIELD })),
    turns: doc.turns.map((t) => ({
      ...t,
      ...FUTURE_FIELD,
      words: t.words.map((w) => ({ ...w, ...FUTURE_FIELD })),
    })),
    translations: { ...FUTURE_FIELD, ...(en && { en: { ...en, ...FUTURE_FIELD } }) },
  };
}

/** A doc with `turnCount` turns that alternate between `speakerCount` speakers, for size and layout tests. */
export function makeLargeDoc(turnCount: number, speakerCount = 2): TranscriptDoc {
  const speakers: Speaker[] = Array.from({ length: speakerCount }, (_, i) => ({
    id: `speaker_${i}`,
    label: `Speaker ${i + 1}`,
  }));
  const turns: Turn[] = Array.from({ length: turnCount }, (_, i) => ({
    id: `t${i + 1}`,
    speakerId: `speaker_${i % speakerCount}`,
    start: i * 5,
    end: i * 5 + 4,
    text: `Turn number ${i + 1}.`,
    words: [{ text: `Turn number ${i + 1}.`, start: i * 5, end: i * 5 + 4, logprob: null }],
  }));
  return makeDoc({ speakers, turns });
}
