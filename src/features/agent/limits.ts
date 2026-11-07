// The project agent's caps, in one place (PROJECTS.md §5.5, A18). Tuned after the live checks A1–A3.

/** How much a question may use, as the user sets it in the chat settings (DECISIONS.md D48). */
export type BudgetLevel = 'low' | 'medium' | 'high';
export const BUDGET_LEVELS = ['low', 'medium', 'high'] as const satisfies readonly BudgetLevel[];

/** Tool calls per question. After that every tool says to answer. */
export const TOOL_CALL_LEVELS: Readonly<Record<BudgetLevel, number>> = {
  low: 15,
  medium: 30,
  high: 60,
};

/** Reading per question: transcript and summary text together, in estimated tokens. */
export const READING_LEVELS: Readonly<Record<BudgetLevel, number>> = {
  low: 162_500,
  medium: 325_000,
  high: 650_000,
};

/** The part of the reading that is summaries: always 3 in 13, so 75k beside 250k of transcript (D45, D48). */
const SUMMARY_SHARE = 3 / 13;

/** Replies per question beyond the tool calls: the backstop for a model that keeps making calls that are refused. */
const SPARE_ITERATIONS = 5;

/** Estimated tokens in an hour of transcript. Only for showing a reading level as hours. */
const TRANSCRIPT_TOKENS_PER_HOUR = 12_500;

/** One question's budgets. */
export interface AgentBudgetLimits {
  toolCalls: number;
  /** Transcript text that `read_transcript` returns, in estimated tokens. */
  transcriptTokens: number;
  /** Summary text that `get_summaries` returns, in estimated tokens. */
  summaryTokens: number;
  /** Requests: a backstop behind the tool-call budget. */
  maxIterations: number;
}

export function agentBudgetLimits(tools: BudgetLevel, reading: BudgetLevel): AgentBudgetLimits {
  const total = READING_LEVELS[reading];
  const summaryTokens = Math.round(total * SUMMARY_SHARE);
  return {
    toolCalls: TOOL_CALL_LEVELS[tools],
    transcriptTokens: total - summaryTokens,
    summaryTokens,
    maxIterations: TOOL_CALL_LEVELS[tools] + SPARE_ITERATIONS,
  };
}

/** What a question may use when nothing has been chosen: 30 tool calls, about 20 hours and about 30 summaries. */
export const DEFAULT_AGENT_LIMITS = agentBudgetLimits('medium', 'medium');

/** About how many hours of transcript a reading level allows. */
export function readingHours(level: BudgetLevel): number {
  return Math.round(
    agentBudgetLimits('medium', level).transcriptTokens / TRANSCRIPT_TOKENS_PER_HOUR,
  );
}

export const AGENT_LIMITS = {
  /** Search hits per call, and per session within a call. */
  hitsPerCall: 60,
  hitsPerSession: 5,
  /** Sessions per `get_summaries` call. */
  summariesPerCall: 10,
  /** Turns either side of `around` in `read_transcript`. */
  windowTurns: 8,
  /** Past this many tokens in a request, the chat suggests `/compact` or a new chat (Phases 17, 22). */
  longChatTokens: 600_000,
  /** Requests for a `/compact` summary: the tools only say to answer, so one is usually enough. */
  compactIterations: 3,
} as const;

/** Characters per token, roughly, for English and German text. Good enough for a budget, not for billing. */
const CHARS_PER_TOKEN = 3.5;
/** Chinese, Japanese and Korean: about a token per character, not 3.5 characters (DECISIONS.md T19). */
const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

export function estimateTokens(text: string): number {
  const dense = text.match(DENSE_SCRIPT)?.length ?? 0;
  return Math.ceil(dense + (text.length - dense) / CHARS_PER_TOKEN);
}
