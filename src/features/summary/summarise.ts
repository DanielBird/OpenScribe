// Summarises one session in one structured-output request (PROJECTS.md §5.3, DECISIONS.md D21). The reply is
// checked; an unreadable reply, or one with more than a third of its quotes not found, is sent once more, and
// the better of the two is kept. Nothing is hashed or written here: the pipeline builds the file (Phase 15).
import { englishText, type SessionText } from '../../domain/corpus/sessionText';
import type { SessionSummary } from '../../domain/summary';
import { ProviderError } from '../../providers/errors';
import type { LlmProvider } from '../../providers/llm/types';
import { checkSummary, type CheckedSummary } from './check';
import { buildInput, systemPrompt, type SummaryContext } from './prompt';
import { SummaryOutputSchema } from './schema';

/** Room for a long summary and the thinking before it. Needs streaming (the provider streams). */
export const SUMMARY_MAX_OUTPUT_TOKENS = 32000;

/** More than this share of quotes not found sends the request once more. */
const MAX_QUOTE_FAILURE_RATE = 1 / 3;

export const SUMMARY_MESSAGES = {
  notTranslated: 'Translate this session to English before summarising it.',
  empty: 'This session has no text to summarise.',
  cancelled: 'Summary cancelled.',
  unexpected: 'Something went wrong while summarising. Try again.',
} as const;

export interface SummariseOptions extends SummaryContext {
  signal?: AbortSignal;
}

/** A checked summary of `session`. Throws `ProviderError`. */
export async function summariseSession(
  session: SessionText,
  provider: LlmProvider,
  opts: SummariseOptions,
): Promise<{ summary: SessionSummary; droppedQuotes: number }> {
  const { signal } = opts;
  if (session.turns.length === 0) {
    throw new ProviderError('validation', SUMMARY_MESSAGES.empty);
  }
  if (session.turns.some((turn) => englishText(session, turn) === null)) {
    throw new ProviderError('validation', SUMMARY_MESSAGES.notTranslated);
  }

  const system = systemPrompt();
  const input = buildInput(session, opts);
  let best: CheckedSummary | null = null;
  let lastError: ProviderError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (signal?.aborted) throw cancelled();
      const output = await provider.generateStructured({
        system,
        input,
        schema: SummaryOutputSchema,
        schemaName: 'session_summary',
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        signal,
      });
      const checked = checkSummary(output, session, opts.brief);
      if (!best || checked.droppedQuotes < best.droppedQuotes) best = checked;
      if (checked.quoteFailureRate <= MAX_QUOTE_FAILURE_RATE) break;
    } catch (err) {
      const error = asProviderError(err, signal);
      if (error.kind !== 'bad_output') throw error;
      lastError = error;
    }
  }

  if (best) return { summary: best.summary, droppedQuotes: best.droppedQuotes };
  throw lastError ?? new ProviderError('unknown', SUMMARY_MESSAGES.unexpected);
}

const cancelled = () => new ProviderError('aborted', SUMMARY_MESSAGES.cancelled);

function asProviderError(err: unknown, signal: AbortSignal | undefined): ProviderError {
  if (signal?.aborted) return cancelled();
  if (err instanceof ProviderError) return err;
  return new ProviderError('unknown', SUMMARY_MESSAGES.unexpected, {
    detail: err instanceof Error ? err.message : undefined,
  });
}
