// The project agent's tool-use loop with Claude, in the browser (PROJECTS.md §5.5). A manual streaming loop
// rather than the SDK's tool runner, because after a mid-output refusal fallback the API's rule for echoing the
// turn back drops blocks that the runner would echo (and would run): see `echoContent`. No SDK type leaves this
// file (DECISIONS.md D26).
import Anthropic, { AnthropicError, APIError } from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from '../../lib/zod';
import { ProviderError, withoutSecret } from '../errors';
import { CLAUDE_FALLBACK_BETA, CLAUDE_MESSAGES, toProviderError } from './claude';
import { CLAUDE_EFFORT } from './models';
import {
  addUsage,
  AGENT_MAX_OUTPUT_TOKENS,
  NO_USAGE,
  type AgentConversation,
  type AgentEvent,
  type AgentExchange,
  type AgentProvider,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentTool,
  type AgentUsage,
} from './types';

/** Re-sends of a request whose tool input wasn't valid JSON (possible with eager input streaming), in a row. */
const JSON_RETRIES = 2;

const MAX_ERROR_CHARS = 300;

export interface ClaudeAgentOptions {
  apiKey: string;
  model: string;
  /** Tests inject a fake; the browser's fetch otherwise. */
  fetch?: typeof globalThis.fetch;
  /** Retries of 408/409/429/5xx and connection errors (SDK default 2). Tests set 0. */
  maxRetries?: number;
}

interface ConversationState {
  model: string;
  messages: readonly BetaMessageParam[];
}

/** The messages behind each conversation this module made. Anything else passed in is a programming error. */
const conversations = new WeakMap<AgentConversation, ConversationState>();

function makeConversation(state: ConversationState): AgentConversation {
  const conversation = Object.freeze({ model: state.model }) as unknown as AgentConversation;
  conversations.set(conversation, {
    model: state.model,
    messages: Object.freeze([...state.messages]),
  });
  return conversation;
}

function usageOf(message: BetaMessage): AgentUsage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
}

/** The request's tool definitions, in the given order, from each tool's zod schema. */
function toolDefinitions(tools: readonly AgentTool[]): BetaTool[] {
  return tools.map((tool) => {
    // As the SDK's `betaZodTool` converts it.
    const schema = z.toJSONSchema(tool.input, { reused: 'ref' });
    if (schema.type !== 'object')
      throw new Error(`claudeAgent: ${tool.name}'s input isn't an object`);
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema as BetaTool.InputSchema,
      // Inputs stream as they are written; the loop validates them itself (`runTool`).
      eager_input_streaming: true,
    };
  });
}

function systemBlocks(req: AgentRunRequest): BetaTextBlockParam[] {
  // Each block ends a cached prefix: tools + instructions, then the context (PROJECTS.md §5.5).
  return [req.instructions, req.context]
    .filter((text) => text !== '')
    .map((text) => ({ type: 'text', text, cache_control: { type: 'ephemeral' } }));
}

/** Block types that the API wants left out before a mid-output fallback's boundary. */
const DROPPED_BEFORE_FALLBACK = new Set(['thinking', 'redacted_thinking', 'tool_use']);

/**
 * The reply as it goes back into the conversation: unchanged, except after a mid-output refusal fallback, where
 * thinking and tool_use blocks before the last `fallback` block are left out, as the API asks. That turn's tool
 * calls before the boundary never run.
 */
function echoContent(content: readonly BetaContentBlock[]): BetaContentBlockParam[] {
  let boundary = -1;
  content.forEach((block, i) => {
    if (block.type === 'fallback') boundary = i;
  });
  const kept =
    boundary < 0
      ? content
      : content.filter((block, i) => i >= boundary || !DROPPED_BEFORE_FALLBACK.has(block.type));
  // Response blocks are valid request blocks; the generated types differ only in optional fields.
  return kept as unknown as BetaContentBlockParam[];
}

const textOf = (content: readonly BetaContentBlockParam[]) =>
  content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

const shortMessage = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS);

export function createClaudeAgent(opts: ClaudeAgentOptions): AgentProvider {
  const apiKey = opts.apiKey.trim();
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: opts.maxRetries ?? 2,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  /** Runs one tool call; every failure becomes an error result the model can read. */
  async function runTool(
    tools: readonly AgentTool[],
    call: BetaToolUseBlockParam,
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void,
  ): Promise<BetaToolResultBlockParam> {
    const result = (content: string, isError: boolean, activity: string) => {
      onEvent({ type: 'tool', name: call.name, activity, isError });
      return {
        type: 'tool_result' as const,
        tool_use_id: call.id,
        content,
        ...(isError ? { is_error: true } : {}),
      };
    };
    const tool = tools.find((t) => t.name === call.name);
    if (!tool) {
      const message = `There is no tool "${call.name}".`;
      return result(message, true, message);
    }
    const input = tool.input.safeParse(call.input);
    if (!input.success) {
      const message = `Invalid input: ${z.prettifyError(input.error)}`.slice(0, MAX_ERROR_CHARS);
      return result(message, true, `${tool.name}: invalid input`);
    }
    try {
      const { content, activity } = await tool.run(input.data, signal);
      return result(content, false, activity);
    } catch (err) {
      const message = shortMessage(err);
      return result(message, true, message);
    }
  }

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    const previous = req.conversation ? conversations.get(req.conversation) : undefined;
    if (req.conversation && !previous) throw new Error('claudeAgent: unknown conversation');
    if (previous && previous.model !== opts.model) {
      throw new Error(
        `claudeAgent: a conversation started on ${previous.model} can't continue on ${opts.model}`,
      );
    }

    const messages: BetaMessageParam[] = [
      ...(previous?.messages ?? []),
      { role: 'user', content: req.userMessage },
    ];
    const tools = toolDefinitions(req.tools);
    const system = systemBlocks(req);
    const texts: string[] = [];
    let usage = NO_USAGE;
    let breakBeforeText = false;

    try {
      for (let iteration = 0; iteration < req.maxIterations; iteration++) {
        const message = await streamReply();
        const content = echoContent(message.content);
        const calls = content.filter((block) => block.type === 'tool_use');
        const stop = message.stop_reason;

        // A refusal can stop part-way, even inside a tool call: its partial reply is not kept.
        if (stop === 'refusal') {
          const category = message.stop_details?.category;
          throw new ProviderError('refused', CLAUDE_MESSAGES.refused, {
            retryable: false,
            detail: category ? `refusal: ${category}` : 'refusal',
          });
        }
        if ((stop === 'max_tokens' || stop === 'model_context_window_exceeded') && calls.length) {
          throw new ProviderError('bad_output', CLAUDE_MESSAGES.badOutput, {
            detail: `tool input cut off (${stop})`,
          });
        }

        messages.push({ role: 'assistant', content });
        const text = textOf(content);
        if (text) {
          texts.push(text);
          breakBeforeText = true;
        }

        if (stop === 'pause_turn') continue;
        if (stop !== 'tool_use' || calls.length === 0) {
          const cutOff = stop === 'max_tokens' || stop === 'model_context_window_exceeded';
          return finish(cutOff ? 'limit' : 'done');
        }

        // Parallel calls run together and are answered in one message (the skill's rule).
        const results = await Promise.all(
          calls.map((call) => runTool(req.tools, call, req.signal, req.onEvent)),
        );
        messages.push({ role: 'user', content: results });
        if (req.signal.aborted) throw new ProviderError('aborted', CLAUDE_MESSAGES.aborted);
      }
      // The backstop: the conversation ends with tool results, which a follow-up question joins.
      return finish('limit');
    } catch (err) {
      throw withoutSecret(toProviderError(err, opts.model), apiKey);
    }

    function finish(stopped: AgentRunResult['stopped']): AgentRunResult {
      return {
        text: texts.join('\n\n'),
        conversation: makeConversation({ model: opts.model, messages }),
        usage,
        stopped,
      };
    }

    /** One request, streamed; re-sent if a tool input couldn't be parsed. */
    async function streamReply(): Promise<BetaMessage> {
      for (let attempt = 0; ; attempt++) {
        const stream = client.beta.messages.stream(
          {
            model: opts.model,
            max_tokens: AGENT_MAX_OUTPUT_TOKENS,
            system,
            tools,
            messages,
            thinking: { type: 'adaptive' },
            output_config: { effort: CLAUDE_EFFORT },
            // Automatic caching: a breakpoint at the end of the conversation, moved on with every request.
            cache_control: { type: 'ephemeral' },
            betas: [CLAUDE_FALLBACK_BETA],
            fallbacks: 'default',
          },
          { signal: req.signal },
        );
        stream.on('text', (delta) => {
          if (breakBeforeText) {
            req.onEvent({ type: 'text', delta: '\n\n' });
            breakBeforeText = false;
          }
          req.onEvent({ type: 'text', delta });
        });
        try {
          const message = await stream.finalMessage();
          usage = addUsage(usage, usageOf(message));
          req.onEvent({ type: 'usage', usage: usageOf(message) });
          return message;
        } catch (err) {
          // The stream's own error for tool JSON it can't parse; API errors and aborts are APIErrors.
          const badJson = err instanceof AnthropicError && !(err instanceof APIError);
          if (!badJson) throw err;
          if (attempt >= JSON_RETRIES) {
            throw new ProviderError('bad_output', CLAUDE_MESSAGES.badOutput, {
              detail: shortMessage(err),
            });
          }
        }
      }
    }
  }

  /**
   * Earlier turns as text alone. The preserved-thinking check only applies to thinking blocks that are sent back,
   * and these turns have none (reference/llm-providers.md, "Resuming a saved chat").
   */
  function resume(history: readonly AgentExchange[]): AgentConversation {
    const messages: BetaMessageParam[] = history.flatMap(({ question, answer }) => [
      { role: 'user' as const, content: question },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: answer }] },
    ]);
    return makeConversation({ model: opts.model, messages });
  }

  return { model: opts.model, run, resume };
}
