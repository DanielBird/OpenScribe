// Test only: small SessionTexts and ProjectSessions for component specs, without a folder or the cache.
import type { SessionText, SessionTurn } from '../domain/corpus/sessionText';
import type { SessionSummaryFile } from '../domain/summary';
import type { FileSummaryStatus, ProjectSession } from '../stores/project';

/** Session `n`: "P0n interview.m4a", recorded on day n of September 2026, in English, one hour long. */
export function makeSessionText(n: number, overrides: Partial<SessionText> = {}): SessionText {
  const turns: SessionTurn[] = [
    { id: 't1', speakerId: 'speaker_0', start: 3, text: 'How do you charge them?', en: null },
    {
      id: 't2',
      speakerId: 'speaker_1',
      start: 61,
      text: 'I put them on the charger by the bed.',
      en: null,
    },
  ];
  return {
    sessionId: `session-${n}`,
    recordingName: `P${String(n).padStart(2, '0')} interview.m4a`,
    recordedAt: Date.UTC(2026, 8, n, 12),
    durationSec: 3725,
    languageCode: 'eng',
    speakers: [
      { id: 'speaker_0', label: 'Interviewer' },
      { id: 'speaker_1', label: 'Anna' },
    ],
    turns,
    transcriptHash: `hash-${n}`,
    ...overrides,
  };
}

export function makeProjectSession(
  text: SessionText,
  copies: string[] = [],
  summary: { file: SessionSummaryFile; status?: FileSummaryStatus } | null = null,
): ProjectSession {
  const base = `${text.recordingName.replace(/\W+/g, '-')}--${text.sessionId.slice(0, 8)}`;
  return {
    sessionId: text.sessionId,
    title: summary?.file.summary.title || text.recordingName,
    transcriptFile: {
      name: `${base}.transcript.json`,
      kind: 'transcript',
      base,
      conflictCopy: false,
      stat: { size: 1000, lastModified: text.recordedAt },
    },
    text,
    summary: summary?.file ?? null,
    summaryFile: summary
      ? {
          name: `${base}.summary.json`,
          kind: 'summary',
          base,
          conflictCopy: false,
          stat: { size: 500, lastModified: text.recordedAt + 1000 },
        }
      : null,
    status: summary ? (summary.status ?? 'ok') : 'none',
    copies,
  };
}
