// One question to the project agent (PROJECTS.md §5.5): what the chat store (Phase 17) calls.
import type {
  AgentConversation,
  AgentEvent,
  AgentProvider,
  AgentUsage,
} from '../../providers/llm/types';
import { parseAnswer, type AnswerBlock } from './answer';
import type { CorpusReader } from './corpus';
import { AGENT_INSTRUCTIONS } from './instructions';
import { AGENT_LIMITS } from './limits';
import { createAgentTools, createBudget } from './tools';

export interface AskOptions {
  provider: AgentProvider;
  corpus: CorpusReader;
  context: string; // renderContext(...), made once per conversation
  conversation: AgentConversation | null;
  question: string;
  signal: AbortSignal;
  onEvent(event: AgentEvent): void;
}

export interface AskResult {
  text: string;
  blocks: AnswerBlock[];
  conversation: AgentConversation;
  usage: AgentUsage;
  activity: string[]; // one line per tool call, in the order they finished
  stopped: 'done' | 'limit';
}

/** Throws `ProviderError`. Each question gets fresh budgets (A18). */
export async function askProject(opts: AskOptions): Promise<AskResult> {
  const activity: string[] = [];
  const result = await opts.provider.run({
    instructions: AGENT_INSTRUCTIONS,
    context: opts.context,
    tools: createAgentTools(opts.corpus, createBudget()),
    conversation: opts.conversation,
    userMessage: opts.question,
    maxIterations: AGENT_LIMITS.maxIterations,
    signal: opts.signal,
    onEvent: (event) => {
      if (event.type === 'tool') activity.push(event.activity);
      opts.onEvent(event);
    },
  });
  return {
    text: result.text,
    blocks: parseAnswer(result.text, opts.corpus),
    conversation: result.conversation,
    usage: result.usage,
    activity,
    stopped: result.stopped,
  };
}
