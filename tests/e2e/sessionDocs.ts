// Small project sessions for the Phase 15 specs. `src/testing/transcriptDoc.ts` imports a fixture JSON, which
// Playwright's loader can't, and a generated corpus session is hours long.
import type { TranscriptDoc } from '../../src/domain/transcript';

const GERMAN = [
  ['Wie laden Sie Ihre Hörgeräte?', 'How do you charge your hearing aids?'],
  [
    'Ich lege sie jeden Abend neben das Bett auf das Ladegerät.',
    'I put them on the charger by the bed every evening.',
  ],
  ['Und wenn Sie verreisen?', 'And when you travel?'],
  [
    'Dann nehme ich das Ladegerät immer mit, das ist mir wichtig.',
    'Then I always take the charger with me, that matters to me.',
  ],
] as const;

/** A short German session ("P0n Hamburg home visit"), recorded on day `n` of September 2026, not translated. */
export function germanSession(n: number): TranscriptDoc {
  const recordedAt = Date.UTC(2026, 8, n);
  return {
    schemaVersion: 1,
    id: `0000000${n}-0000-4000-8000-00000000000${n}`,
    createdAt: new Date(recordedAt + 3_600_000).toISOString(),
    source: {
      fileName: `P0${n} Hamburg home visit.m4a`,
      fileSize: 1_000_000,
      mimeType: 'audio/mp4',
      lastModified: recordedAt,
      durationSec: 40,
    },
    request: {
      provider: 'elevenlabs',
      model: 'scribe_v2',
      languageHint: 'auto',
      numSpeakers: null,
      zeroRetention: false,
      keyterms: [],
    },
    result: {
      providerTranscriptId: null,
      languageCode: 'deu',
      languageProbability: 0.97,
      audioDurationSec: 40,
    },
    speakers: [
      { id: 'speaker_0', label: 'Speaker 1' },
      { id: 'speaker_1', label: 'Speaker 2' },
    ],
    turns: GERMAN.map(([text], i) => ({
      id: `t${i + 1}`,
      speakerId: `speaker_${i % 2}`,
      start: i * 10,
      end: i * 10 + 8,
      text,
      words: [],
    })),
    translations: {},
  };
}

/** The same session with its English translation. */
export function translated(doc: TranscriptDoc): TranscriptDoc {
  const texts = Object.fromEntries(GERMAN.map(([, en], i) => [`t${i + 1}`, en]));
  return {
    ...doc,
    translations: {
      en: { provider: 'claude', model: 'claude-sonnet-5-5', createdAt: doc.createdAt, texts },
    },
  };
}
