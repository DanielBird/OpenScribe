// Test only: a small project corpus for the agent's specs. Three sessions, keyed by recording date:
//   s1  English, summarised: "P01 – kitchen interview, Leeds"
//   s2  German, translated, summarised: "P02 – home visit, Hamburg"
//   s3  French, not translated, no summary: "P03 interview.m4a"
import type { SessionText } from '../domain/corpus/sessionText';
import type { SessionSummary } from '../domain/summary';
import { createCorpusReader } from '../features/agent/corpus';
import { makeSessionText } from './projectSessions';
import { makeSummaryReply } from './summary';

export function agentSessions(): SessionText[] {
  const english = makeSessionText(1, {
    turns: [
      { id: 't1', speakerId: 'speaker_0', start: 3, text: 'How do you charge them?', en: null },
      {
        id: 't2',
        speakerId: 'speaker_1',
        start: 61,
        text: 'I put them on the charger by the bed, like my phone.',
        en: null,
      },
      { id: 't3', speakerId: 'speaker_0', start: 95, text: 'Every night?', en: null },
      {
        id: 't4',
        speakerId: 'speaker_1',
        start: 2472,
        text: 'Every night. My husband reminds me when I forget.',
        en: null,
      },
    ],
    speakers: [
      { id: 'speaker_0', label: 'Interviewer' },
      { id: 'speaker_1', label: 'Mary' },
    ],
  });
  const german = makeSessionText(2, {
    languageCode: 'deu',
    durationSec: 7380,
    turns: [
      {
        id: 't1',
        speakerId: 'speaker_0',
        start: 5,
        text: 'Wann laden Sie sie?',
        en: 'When do you charge them?',
      },
      {
        id: 't2',
        speakerId: 'speaker_1',
        start: 40,
        text: 'Abends lege ich sie auf das Ladegerät.',
        en: 'In the evening I put them on the charger.',
      },
    ],
  });
  const french = makeSessionText(3, {
    languageCode: 'fra',
    durationSec: null,
    turns: [
      { id: 't1', speakerId: 'speaker_0', start: 2, text: 'Quand les chargez-vous ?', en: null },
      { id: 't2', speakerId: 'speaker_1', start: 30, text: 'La nuit, sur le chargeur.', en: null },
    ],
  });
  // Given newest first, so the reader has to sort them.
  return [french, german, english];
}

export function agentSummaries(sessions: readonly SessionText[]): Map<string, SessionSummary> {
  const [, german, english] = sessions;
  return new Map([
    [
      english!.sessionId,
      makeSummaryReply(english!, {
        title: 'P01 – kitchen interview, Leeds',
        synopsis: 'Mary charges her hearing aids\nevery night by the bed.',
        respondents: [
          {
            speakerId: 'speaker_1',
            label: 'Mary',
            attributes: [
              { field: 'Age', value: '71', turnIds: ['t2'] },
              { field: 'Hearing aids used', value: '2 years', turnIds: [] },
            ],
          },
        ],
      }),
    ],
    [
      german!.sessionId,
      makeSummaryReply(german!, {
        title: 'P02 – home visit, Hamburg',
        themes: [
          {
            name: 'Charging  routines',
            description: 'Evening charging.',
            turnIds: ['t2'],
            isNew: false,
            quotes: [],
          },
        ],
      }),
    ],
  ]);
}

export function makeAgentCorpus() {
  const sessions = agentSessions();
  return createCorpusReader(sessions, agentSummaries(sessions));
}
