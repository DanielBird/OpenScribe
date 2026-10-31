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
import { toNormalized } from '../providers/transcription/elevenlabs/mapper';

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
