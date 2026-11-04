import { describe, expect, it } from 'vitest';
import { toSessionText, type SessionText } from '../../domain/corpus/sessionText';
import { EMPTY_BRIEF } from '../../domain/project';
import type { SessionSummary, SummaryQuote } from '../../domain/summary';
import { ProviderError } from '../../providers/errors';
import type { LlmProvider, StructuredRequest } from '../../providers/llm/types';
import { makeSummaryReply, quoteOf } from '../../testing/summary';
import { makeDoc, makeLargeDoc, withTranslation } from '../../testing/transcriptDoc';
import { SummaryOutputSchema } from './schema';
import {
  SUMMARY_MAX_OUTPUT_TOKENS,
  SUMMARY_MESSAGES,
  summariseSession,
  type SummariseOptions,
} from './summarise';

const GERMAN = toSessionText(withTranslation(makeDoc()));

/** `makeLargeDoc(turns)` as an English session (it takes the German fixture's language otherwise). */
function englishSession(turns: number): SessionText {
  const doc = makeLargeDoc(turns);
  return toSessionText({ ...doc, result: { ...doc.result, languageCode: 'eng' } });
}

const OPTIONS: SummariseOptions = {
  brief: EMPTY_BRIEF,
  projectName: 'Hearing at home',
  themeVocabulary: [],
};

type Step =
  SessionSummary | ProviderError | ((req: StructuredRequest<unknown>) => Promise<SessionSummary>);

/** A provider that answers request n with `steps[n]`: a reply, an error to throw, or a function. */
function scripted(...steps: Step[]) {
  const requests: StructuredRequest<unknown>[] = [];
  const provider: LlmProvider = {
    id: 'claude',
    model: 'claude-sonnet-5-5',
    async generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
      requests.push(req as StructuredRequest<unknown>);
      const step = steps[requests.length - 1];
      if (step === undefined) throw new Error('no more scripted replies');
      if (step instanceof ProviderError) throw step;
      const reply =
        typeof step === 'function' ? await step(req as StructuredRequest<unknown>) : step;
      return reply as T;
    },
  };
  return { provider, requests };
}

const badOutput = () =>
  new ProviderError('bad_output', "Claude sent a reply that DeScribe couldn't read.");

/**
 * `makeSummaryReply` with up to 5 themes of 2 quotes each, from the first `total` turns of the respondent (at most 10),
 * `bad` of them changed so they can't be found.
 */
function withBadQuotes(session: SessionText, bad: number, total = 10): SessionSummary {
  const researcher = session.speakers[0]?.id;
  const quotes: SummaryQuote[] = session.turns
    .filter((turn) => turn.speakerId !== researcher)
    .slice(0, total)
    .map((turn, i) =>
      i < bad ? { turnId: turn.id, text: `invented words ${i}` } : quoteOf(session, turn),
    );
  const themes = Array.from({ length: 5 }, (_, i) => ({
    name: `theme ${i}`,
    description: '',
    turnIds: [],
    isNew: true,
    quotes: quotes.slice(2 * i, 2 * i + 2),
  }));
  return makeSummaryReply(session, { themes });
}

/** Every quote in a summary: the findings', then the themes'. */
const allQuotes = (summary: SessionSummary) => [
  ...summary.researchQuestions.flatMap((q) => q.quotes),
  ...summary.themes.flatMap((t) => t.quotes),
];

async function errorOf(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    return err as ProviderError;
  }
  throw new Error('expected a ProviderError');
}

describe('summariseSession', () => {
  it('summarises a translated German session from its English text', async () => {
    const { provider, requests } = scripted(makeSummaryReply(GERMAN));
    const { summary, droppedQuotes } = await summariseSession(GERMAN, provider, OPTIONS);

    expect(droppedQuotes).toBe(0);
    expect(allQuotes(summary).map((q) => q.text)).toEqual([
      "Thank you, I'm very pleased to be here.",
      'For about two years, together with a small team.',
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      schema: SummaryOutputSchema,
      schemaName: 'session_summary',
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    });
    expect(requests[0]!.input).toContain('<project>Hearing at home</project>');
    expect(requests[0]!.input).toContain(
      "t2 [00:00:03] Speaker 2: Thank you, I'm very pleased to be here.",
    );
    expect(requests[0]!.system).toContain('qualitative research team');
  });

  it('summarises a 3-hour session', async () => {
    const session = englishSession(2200); // 5 s a turn: just over 3 hours
    const { provider, requests } = scripted(makeSummaryReply(session));
    const { summary, droppedQuotes } = await summariseSession(session, provider, OPTIONS);

    expect(droppedQuotes).toBe(0);
    expect(allQuotes(summary)).toHaveLength(3);
    expect(allQuotes(summary)[0]!.text).toBe('Turn number 2.');
    expect(requests[0]!.input.match(/^t\d+ \[/gm)).toHaveLength(2200);
    expect(requests[0]!.input).toContain('t2200 [03:03:15] Speaker 2: Turn number 2200.');
  });

  it('refuses a German session without a translation, and an empty one', async () => {
    const { provider, requests } = scripted();
    const untranslated = await errorOf(
      summariseSession(toSessionText(makeDoc()), provider, OPTIONS),
    );
    expect(untranslated.kind).toBe('validation');
    expect(untranslated.userMessage).toBe(SUMMARY_MESSAGES.notTranslated);

    const empty = toSessionText(makeDoc({ turns: [] }));
    expect((await errorOf(summariseSession(empty, provider, OPTIONS))).userMessage).toBe(
      SUMMARY_MESSAGES.empty,
    );
    expect(requests).toHaveLength(0);
  });

  it('retries once on a reply it cannot read', async () => {
    const { provider, requests } = scripted(badOutput(), makeSummaryReply(GERMAN));
    const { summary } = await summariseSession(GERMAN, provider, OPTIONS);
    expect(requests).toHaveLength(2);
    expect(allQuotes(summary)).toHaveLength(2);
  });

  it('gives up after two unreadable replies', async () => {
    const { provider } = scripted(badOutput(), badOutput());
    expect((await errorOf(summariseSession(GERMAN, provider, OPTIONS))).kind).toBe('bad_output');
  });

  it('does not retry other errors', async () => {
    const { provider, requests } = scripted(new ProviderError('refused', 'Claude declined.'));
    expect((await errorOf(summariseSession(GERMAN, provider, OPTIONS))).kind).toBe('refused');
    expect(requests).toHaveLength(1);
  });

  it('retries when more than a third of the quotes are not found, and keeps the better reply', async () => {
    const session = englishSession(40); // 10 quotes a reply
    const { provider, requests } = scripted(withBadQuotes(session, 4), withBadQuotes(session, 1));
    const { summary, droppedQuotes } = await summariseSession(session, provider, OPTIONS);
    expect(requests).toHaveLength(2);
    expect(droppedQuotes).toBe(1);
    expect(allQuotes(summary)).toHaveLength(9);
  });

  it('keeps the first reply when the retry is worse', async () => {
    const session = englishSession(40);
    const { provider } = scripted(withBadQuotes(session, 4), withBadQuotes(session, 6));
    expect((await summariseSession(session, provider, OPTIONS)).droppedQuotes).toBe(4);

    const unreadable = scripted(withBadQuotes(session, 5), badOutput());
    expect((await summariseSession(session, unreadable.provider, OPTIONS)).droppedQuotes).toBe(5);
  });

  it('keeps the reply with the smaller share of quotes not found, not the one with fewer', async () => {
    const session = englishSession(40);
    // 4 of 9 not found, then 1 of 2.
    const { provider } = scripted(withBadQuotes(session, 4, 9), withBadQuotes(session, 1, 2));
    const { summary, droppedQuotes } = await summariseSession(session, provider, OPTIONS);
    expect(droppedQuotes).toBe(4);
    expect(allQuotes(summary)).toHaveLength(5);
  });

  it('keeps the reply with more verified quotes when the share not found is the same', async () => {
    const session = englishSession(40);
    const half = (total: number) => withBadQuotes(session, total / 2, total);

    const first = scripted(half(6), half(2));
    expect(
      allQuotes((await summariseSession(session, first.provider, OPTIONS)).summary),
    ).toHaveLength(3);

    const second = scripted(half(2), half(6));
    const { summary, droppedQuotes } = await summariseSession(session, second.provider, OPTIONS);
    expect(droppedQuotes).toBe(3);
    expect(allQuotes(summary)).toHaveLength(3);
  });

  it('counts a reply without quotes as having none not found', async () => {
    const session = englishSession(40);
    const { provider } = scripted(withBadQuotes(session, 4, 9), withBadQuotes(session, 0, 0));
    const { summary, droppedQuotes } = await summariseSession(session, provider, OPTIONS);
    expect(droppedQuotes).toBe(0);
    expect(allQuotes(summary)).toHaveLength(0);
  });

  it('does not retry when a third of the quotes or fewer are not found', async () => {
    const session = englishSession(40);
    const { provider, requests } = scripted(withBadQuotes(session, 3));
    expect((await summariseSession(session, provider, OPTIONS)).droppedQuotes).toBe(3);
    expect(requests).toHaveLength(1);
  });

  it('stops when cancelled, and passes the signal on', async () => {
    const controller = new AbortController();
    const { provider, requests } = scripted(async (req) => {
      expect(req.signal).toBe(controller.signal);
      controller.abort();
      throw new ProviderError('aborted', 'Cancelled.');
    });
    const err = await errorOf(
      summariseSession(GERMAN, provider, { ...OPTIONS, signal: controller.signal }),
    );
    expect(err.kind).toBe('aborted');
    expect(err.userMessage).toBe(SUMMARY_MESSAGES.cancelled);
    expect(requests).toHaveLength(1);

    const before = scripted(makeSummaryReply(GERMAN));
    const aborted = AbortSignal.abort();
    expect(
      (await errorOf(summariseSession(GERMAN, before.provider, { ...OPTIONS, signal: aborted })))
        .kind,
    ).toBe('aborted');
    expect(before.requests).toHaveLength(0);
  });
});
