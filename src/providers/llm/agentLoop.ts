// The project agent's loop, shared by `claudeAgent.ts` and `geminiAgent.ts` (PROJECTS.md §5.5): the conversation,
// streaming the answer with a blank line between replies, sending a request again when its tool call couldn't be
// read, running the tools and ending the run. Each provider supplies one streamed request and reads its reply
// (`AgentAdapter`); no SDK type comes here.
import { z } from '../../lib/zod';
import { ProviderError } from '../errors';
import {
  addUsage,
  NO_USAGE,
  type AgentConversation,
  type AgentEvent,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentTool,
  type AgentUsage,
} from './types';

/** The most characters of an error that go back to the model or into an error's detail. */
const MAX_ERROR_CHARS = 300;

export const shortMessage = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS);

/** The turns behind the conversations one provider module made. */
export interface ConversationRegistry<Turn> {
  /** A new conversation that keeps a frozen copy of `turns`. */
  make(model: string, turns: readonly Turn[]): AgentConversation;
  /**
   * The turns of the conversation to continue on `model`, or none for a new one. A conversation this registry
   * didn't make, or one started on another model, is a programming error: it throws `Error`.
   */
  continuing(conversation: AgentConversation | null, model: string): readonly Turn[];
}

/** One registry per provider module (`owner` names it in errors), so a conversation never moves to another. */
export function createConversations<Turn>(owner: string): ConversationRegistry<Turn> {
  const states = new WeakMap<AgentConversation, { model: string; turns: readonly Turn[] }>();
  return {
    make(model, turns) {
      const conversation = Object.freeze({ model }) as unknown as AgentConversation;
      states.set(conversation, { model, turns: Object.freeze([...turns]) });
      return conversation;
    },
    continuing(conversation, model) {
      if (!conversation) return [];
      const previous = states.get(conversation);
      if (!previous) throw new Error(`${owner}: unknown conversation`);
      if (previous.model !== model) {
        throw new Error(
          `${owner}: a conversation started on ${previous.model} can't continue on ${model}`,
        );
      }
      return previous.turns;
    },
  };
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/** Runs one tool call and reports it (a `tool` event). Every failure becomes an error result the model can read. */
export async function runAgentTool(
  tools: readonly AgentTool[],
  name: string,
  input: unknown,
  signal: AbortSignal,
  onEvent: (event: AgentEvent) => void,
): Promise<ToolOutcome> {
  const outcome = (content: string, isError: boolean, activity: string): ToolOutcome => {
    onEvent({ type: 'tool', name, activity, isError });
    return { content, isError };
  };
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    const message = `There is no tool "${name}".`;
    return outcome(message, true, message);
  }
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) {
    const message = `Invalid input: ${z.prettifyError(parsed.error)}`.slice(0, MAX_ERROR_CHARS);
    return outcome(message, true, `${tool.name}: invalid input`);
  }
  try {
    const { content, activity } = await tool.run(parsed.data, signal);
    return outcome(content, false, activity);
  } catch (err) {
    const message = shortMessage(err);
    return outcome(message, true, message);
  }
}

/** Where a provider's request puts what it streams. */
export interface AgentOutput {
  /** A piece of the answer's text (never thinking). An empty piece is ignored. */
  text(delta: string): void;
  /** One request's usage, a request sent again included. */
  usage(usage: AgentUsage): void;
}

/** What one request gave back, as the provider read it. */
export type AgentAttempt<Turn, Call> =
  | {
      /** The reply as it goes back into the conversation. */
      turn: Turn;
      /** The reply's answer text. */
      text: string;
      calls: readonly Call[];
      /**
       * `tools`: run the calls, then send their results. `again`: send the conversation as it is (Claude's
       * `pause_turn`); its calls don't run. `done` and `limit` end the run.
       */
      next: 'tools' | 'again' | 'done' | 'limit';
    }
  /** The reply had a tool call that couldn't be read: the same request goes again. `resend` is the error's detail. */
  | { resend: string };

/** What a provider adds to the loop. Built for each run. */
export interface AgentAdapter<Turn, Call, Result> {
  model: string;
  /** The provider module's conversations. */
  conversations: ConversationRegistry<Turn>;
  /** Re-sends of a request whose tool call couldn't be read, in a row; after them the run fails with `bad_output`. */
  resends: number;
  messages: { aborted: string; badOutput: string };
  userTurn(text: string): Turn;
  /** One streamed request with the conversation so far. Throws `ProviderError` for a reply that ends the run. */
  send(conversation: readonly Turn[], output: AgentOutput): Promise<AgentAttempt<Turn, Call>>;
  /** The tool a call names, and its input. */
  callOf(call: Call): { name: string; input: unknown };
  result(call: Call, outcome: ToolOutcome): Result;
  /** The results of one reply's calls, in the order of the calls, as one turn. */
  resultsTurn(results: Result[]): Turn;
  /** Any error of the run, as the `ProviderError` the run throws (without the key). */
  toError(err: unknown): ProviderError;
}

/** One run of the agent: replies and tool calls until the model answers, or the request limit is reached. */
export async function runAgentLoop<Turn, Call, Result>(
  req: AgentRunRequest,
  adapter: AgentAdapter<Turn, Call, Result>,
): Promise<AgentRunResult> {
  const history: Turn[] = [
    ...adapter.conversations.continuing(req.conversation, adapter.model),
    adapter.userTurn(req.userMessage),
  ];
  const texts: string[] = [];
  let usage = NO_USAGE;
  /** Set after a reply with text: the next reply's text starts with a blank line. */
  let breakBeforeText = false;
  /** Characters the current request has streamed, which sending it again takes back. */
  let streamed = 0;

  const emit = (delta: string) => {
    streamed += delta.length;
    req.onEvent({ type: 'text', delta });
  };
  const output: AgentOutput = {
    text(delta) {
      if (delta === '') return;
      if (breakBeforeText) {
        emit('\n\n');
        breakBeforeText = false;
      }
      emit(delta);
    },
    usage(requestUsage) {
      usage = addUsage(usage, requestUsage);
      req.onEvent({ type: 'usage', usage: requestUsage });
    },
  };

  const finish = (stopped: AgentRunResult['stopped']): AgentRunResult => ({
    text: texts.join('\n\n'),
    conversation: adapter.conversations.make(adapter.model, history),
    usage,
    stopped,
  });

  /** One reply. A request whose tool call couldn't be read goes again, and the text it streamed is taken back. */
  async function reply() {
    for (let attempt = 0; ; attempt++) {
      const breakAtStart = breakBeforeText;
      streamed = 0;
      const result = await adapter.send(history, output);
      if (!('resend' in result)) return result;
      if (attempt >= adapter.resends) {
        throw new ProviderError('bad_output', adapter.messages.badOutput, {
          detail: result.resend,
        });
      }
      req.onEvent({ type: 'retry', discard: streamed });
      breakBeforeText = breakAtStart;
    }
  }

  try {
    for (let iteration = 0; iteration < req.maxIterations; iteration++) {
      const { turn, text, calls, next } = await reply();
      history.push(turn);
      if (text) {
        texts.push(text);
        breakBeforeText = true;
      }
      if (next === 'again') continue;
      if (next !== 'tools') return finish(next);

      // Parallel calls run together, and their results go back in one turn (the claude-api skill's rule).
      const results = await Promise.all(
        calls.map(async (call) => {
          const { name, input } = adapter.callOf(call);
          return adapter.result(
            call,
            await runAgentTool(req.tools, name, input, req.signal, req.onEvent),
          );
        }),
      );
      history.push(adapter.resultsTurn(results));
      if (req.signal.aborted) throw new ProviderError('aborted', adapter.messages.aborted);
    }
    // The backstop: the conversation ends with tool results, which a follow-up question joins.
    return finish('limit');
  } catch (err) {
    throw adapter.toError(err);
  }
}
