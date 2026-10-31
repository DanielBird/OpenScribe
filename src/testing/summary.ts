// Test only: a valid summary reply for a session, quoting its real turns, for unit and e2e tests. Imports only
// domain code, so Playwright can load it.
import { englishText, type SessionText, type SessionTurn } from '../domain/corpus/sessionText';
import type { SessionSummary, SummaryQuote } from '../domain/summary';

/** Words per quote: the start of each quoted turn. */
const QUOTE_WORDS = 12;

/** The first `count` words of `text`, cut from the text itself so the quote check finds them. */
function firstWords(text: string, count: number): string {
  const words = text.match(/\S+/g) ?? [];
  if (words.length <= count) return text.trim();
  let end = 0;
  const pattern = /\S+/g;
  for (let i = 0; i < count; i++) end = (pattern.exec(text)?.index ?? 0) + (words[i]?.length ?? 0);
  return text.slice(0, end).trim();
}

/** A quote of the start of `turn`'s English text, which the check finds. */
export function quoteOf(session: SessionText, turn: SessionTurn): SummaryQuote {
  return {
    turnId: turn.id,
    text: firstWords(englishText(session, turn) ?? turn.text, QUOTE_WORDS),
  };
}

/**
 * A reply the check accepts unchanged in shape: respondents for every speaker but the first (taken as the
 * researcher), and two themes on real turns, quoting the English text of up to 3 of the respondents' turns (2 for
 * the first theme, 1 for the second). `researchQuestions` is empty unless given.
 */
export function makeSummaryReply(
  session: SessionText,
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  const [, ...respondents] = session.speakers;
  const respondentIds = new Set(respondents.map((s) => s.id));
  const theirTurns = session.turns.filter((t) => respondentIds.has(t.speakerId));
  const quoted = (theirTurns.length > 0 ? theirTurns : session.turns).slice(0, 3);
  const ids = quoted.map((t) => t.id);
  const quotes = quoted.map((turn) => quoteOf(session, turn));

  return {
    title: `${session.recordingName} – session`,
    synopsis: 'A short session about charging hearing aids at home.',
    overview: 'The respondent describes their routine and what gets in the way.',
    respondents: respondents.map((s) => ({
      speakerId: s.id,
      label: s.label,
      attributes: [{ field: 'Country', value: 'Germany', turnIds: ids.slice(0, 1) }],
    })),
    researchQuestions: [],
    themes: [
      {
        name: 'charging routines',
        description: 'How charging fits the day.',
        turnIds: ids.slice(0, 3),
        isNew: false,
        quotes: quotes.slice(0, 2),
      },
      {
        name: 'partner support',
        description: 'Who helps.',
        turnIds: ids.slice(1, 2),
        isNew: true,
        quotes: quotes.slice(2, 3),
      },
    ],
    ...overrides,
  };
}

const TURN_LINE = /^(t\d+) \[(\d+):(\d{2}):(\d{2})\] ([^:]+): (.*)$/;
const SPEAKER = /^(.*) \(([^()]+)\)$/;

/**
 * The session a summary request was made from, read back from its input (`features/summary/prompt.ts`): the
 * recording's name, the speakers and every turn's English text. For fakes that answer whatever is asked.
 */
export function sessionFromSummaryInput(input: string): SessionText {
  const recordingName = /^Recording: ([^·\n]+)/m.exec(input)?.[1]?.trim() ?? 'session';
  const speakers = (/^Speakers: (.*)$/m.exec(input)?.[1] ?? '').split('; ').flatMap((part) => {
    const match = SPEAKER.exec(part);
    return match ? [{ id: match[2]!, label: match[1]! }] : [];
  });
  const idByLabel = new Map(speakers.map((s) => [s.label, s.id]));
  const turns = input.split('\n').flatMap((line) => {
    const match = TURN_LINE.exec(line);
    if (!match) return [];
    const [, id = '', h = '0', m = '0', s = '0', label = '', text = ''] = match;
    return [
      {
        id,
        speakerId: idByLabel.get(label) ?? label,
        start: Number(h) * 3600 + Number(m) * 60 + Number(s),
        text,
        en: null,
      },
    ];
  });
  return {
    sessionId: 'request',
    recordingName,
    recordedAt: 0,
    durationSec: null,
    languageCode: 'en',
    speakers,
    turns,
    transcriptHash: '',
  };
}

/** A valid summary reply for a summary request, quoting the turns it sent. */
export function summaryReplyForInput(
  input: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return makeSummaryReply(sessionFromSummaryInput(input), overrides);
}
