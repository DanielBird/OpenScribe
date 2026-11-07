// Compacting the project chat (Phase 22, D33): the agent summarises the conversation so far, and the chat goes on
// from that summary alone, "simple compaction" in reference/llm-providers.md. The summary is one ordinary run on the
// conversation with the same instructions, context, tools and settings as a question, so its whole prefix is read
// from the cache. Its tools run on a spent budget, so a call gets "Tool budget reached" instead of more reading.
import { ProviderError } from '../../providers/errors';
import type {
  AgentConversation,
  AgentEffort,
  AgentEvent,
  AgentExchange,
  AgentProvider,
  AgentUsage,
} from '../../providers/llm/types';
import type { CorpusReader } from './corpus';
import { AGENT_INSTRUCTIONS } from './instructions';
import { AGENT_LIMITS } from './limits';
import { createAgentTools, spentBudget } from './tools';

export const COMPACT_MESSAGES = {
  noSummary: "The chat couldn't be summarised. Try again.",
} as const;

const COMPACT_PROMPT = `Summarise this chat so far, for yourself. From now on you will see only this summary, not the earlier questions, answers or tool results, and the researcher will go on asking.

Keep
- each question, and what you concluded and how sure you were;
- the evidence: session titles with their keys, speaker labels, and the quotes the answers relied on, each on its own line as <quote ref="s12/t412">exact words</quote>, copied unchanged;
- what you searched for (the queries) and read, what you didn't find, and the relevant sessions you haven't read;
- anything the researcher asked you to do or avoid, and the questions still open.

Write only the summary, in English, with no preamble. Don't use the tools.`;

/** The question the summary answers in the conversation that goes on from it. */
export const COMPACTED_LEAD =
  'Summarise this chat so far, for yourself. From now on you will see only this summary, not the earlier questions, answers or tool results.';

/** The compaction request: the prompt, and what `/compact` was asked to keep. */
export function compactPrompt(focus: string): string {
  const keep = focus.trim();
  return keep === ''
    ? COMPACT_PROMPT
    : `${COMPACT_PROMPT}\n\nThe researcher asked you to keep this in particular: ${keep}`;
}

/** A compacted chat's history for `AgentProvider.resume`: the summary as the answer to `COMPACTED_LEAD`, then the rest. */
export function compactedHistory(
  summary: string,
  exchanges: readonly AgentExchange[] = [],
): AgentExchange[] {
  return [{ question: COMPACTED_LEAD, answer: summary }, ...exchanges];
}

export interface CompactOptions {
  provider: AgentProvider;
  corpus: CorpusReader;
  context: string; // the conversation's, unchanged, so the cached prefix holds
  conversation: AgentConversation;
  /** What `/compact` was asked to keep; '' for nothing. */
  focus: string;
  effort: AgentEffort; // the chat's, so the cache holds
  signal: AbortSignal;
  onEvent(event: AgentEvent): void;
}

export interface CompactResult {
  summary: string;
  /** A new conversation that starts from the summary. */
  conversation: AgentConversation;
  usage: AgentUsage;
}

/** Throws `ProviderError`. `opts.conversation` is left as it was, so a chat whose compaction failed goes on from it. */
export async function compactChat(opts: CompactOptions): Promise<CompactResult> {
  const result = await opts.provider.run({
    instructions: AGENT_INSTRUCTIONS,
    context: opts.context,
    tools: createAgentTools(opts.corpus, spentBudget()),
    conversation: opts.conversation,
    userMessage: compactPrompt(opts.focus),
    maxIterations: AGENT_LIMITS.compactIterations,
    effort: opts.effort,
    signal: opts.signal,
    onEvent: opts.onEvent,
  });
  const summary = result.text.trim();
  if (summary === '' || result.stopped === 'limit') {
    throw new ProviderError('bad_output', COMPACT_MESSAGES.noSummary, {
      detail: summary === '' ? 'empty summary' : 'summary stopped at a limit',
    });
  }
  return {
    summary,
    conversation: opts.provider.resume(compactedHistory(summary)),
    usage: result.usage,
  };
}
