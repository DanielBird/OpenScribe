// The project agent's caps, in one place (PROJECTS.md §5.5, A18). Tuned after the live checks A1–A3.

export const AGENT_LIMITS = {
  /** Transcript text that `read_transcript` returns per question, in estimated tokens (about 20 hours). */
  transcriptTokensPerQuestion: 250_000,
  /** Summary text that `get_summaries` returns per question, in estimated tokens (about 30 summaries, D45). */
  summaryTokensPerQuestion: 75_000,
  /** Tool calls per question. After that every tool says to answer. */
  toolCallsPerQuestion: 30,
  /** Requests per question: a backstop behind the tool-call budget. */
  maxIterations: 35,
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
