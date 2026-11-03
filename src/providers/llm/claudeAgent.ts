// The project agent's tool-use loop with Claude, in the browser (PROJECTS.md §5.5). A manual streaming loop
// rather than the SDK's tool runner, because after a mid-output refusal fallback the API's rule for echoing the
// turn back drops blocks that the runner would echo (and would run): see `echoContent`. The loop itself is shared
// with Gemini (`agentLoop.ts`); this file makes one request and reads its reply. No SDK type leaves this file
// (DECISIONS.md D26).
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
import { createConversations, runAgentLoop, shortMessage, type AgentAttempt } from './agentLoop';
import { CLAUDE_FALLBACK_BETA, CLAUDE_MESSAGES, toProviderError } from './claude';
import { CLAUDE_EFFORT } from './models';
import {
  AGENT_MAX_OUTPUT_TOKENS,
  type AgentConversation,
  type AgentExchange,
  type AgentProvider,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentTool,
  type AgentUsage,
} from './types';

/** Re-sends of a request whose tool input wasn't valid JSON (possible with eager input streaming), in a row. */
const JSON_RETRIES = 2;

export interface ClaudeAgentOptions {
  apiKey: string;
  model: string;
  /** Tests inject a fake; the browser's fetch otherwise. */
  fetch?: typeof globalThis.fetch;
  /** Retries of 408/409/429/5xx and connection errors (SDK default 2). Tests set 0. */
  maxRetries?: number;
}

/** The messages behind each conversation this module made. Anything else passed in is a programming error. */
const conversations = createConversations<BetaMessageParam>('claudeAgent');

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
      // Inputs stream as they are written; the loop validates them itself (`runAgentTool`).
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

/** What a reply means for the run. Its checks come before anything in it is used. */
function readReply(message: BetaMessage): AgentAttempt<BetaMessageParam, BetaToolUseBlockParam> {
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
  const cutOff = stop === 'max_tokens' || stop === 'model_context_window_exceeded';
  if (cutOff && calls.length) {
    throw new ProviderError('bad_output', CLAUDE_MESSAGES.badOutput, {
      detail: `tool input cut off (${stop})`,
    });
  }

  const next =
    stop === 'pause_turn'
      ? 'again'
      : stop === 'tool_use' && calls.length > 0
        ? 'tools'
        : cutOff
          ? 'limit'
          : 'done';
  return { turn: { role: 'assistant', content }, text: textOf(content), calls, next };
}

export function createClaudeAgent(opts: ClaudeAgentOptions): AgentProvider {
  const apiKey = opts.apiKey.trim();
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: opts.maxRetries ?? 2,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    const tools = toolDefinitions(req.tools);
    const system = systemBlocks(req);

    return runAgentLoop<BetaMessageParam, BetaToolUseBlockParam, BetaToolResultBlockParam>(req, {
      model: opts.model,
      conversations,
      resends: JSON_RETRIES,
      messages: CLAUDE_MESSAGES,
      userTurn: (text) => ({ role: 'user', content: text }),

      /** One request, streamed. A tool input the stream couldn't parse sends it again, with its usage so far. */
      async send(messages, output) {
        const stream = client.beta.messages.stream(
          {
            model: opts.model,
            max_tokens: AGENT_MAX_OUTPUT_TOKENS,
            system,
            tools,
            messages: [...messages],
            thinking: { type: 'adaptive' },
            output_config: { effort: CLAUDE_EFFORT },
            // Automatic caching: a breakpoint at the end of the conversation, moved on with every request.
            cache_control: { type: 'ephemeral' },
            betas: [CLAUDE_FALLBACK_BETA],
            fallbacks: 'default',
          },
          { signal: req.signal },
        );
        stream.on('text', (delta) => output.text(delta));
        let message: BetaMessage;
        try {
          message = await stream.finalMessage();
        } catch (err) {
          // The stream's own error for tool JSON it can't parse; API errors and aborts are APIErrors.
          const badJson = err instanceof AnthropicError && !(err instanceof APIError);
          if (!badJson) throw err;
          // The error comes at the end of the tool block, before `message_delta`: the snapshot has the input and
          // cache tokens, and only the output tokens `message_start` reported.
          const partial = stream.currentMessage;
          if (partial) output.usage(usageOf(partial));
          return { resend: shortMessage(err) };
        }
        output.usage(usageOf(message));
        return readReply(message);
      },

      callOf: (call) => ({ name: call.name, input: call.input }),
      result: (call, { content, isError }) => ({
        type: 'tool_result',
        tool_use_id: call.id,
        content,
        ...(isError ? { is_error: true } : {}),
      }),
      resultsTurn: (results) => ({ role: 'user', content: results }),
      toError: (err) => withoutSecret(toProviderError(err, opts.model), apiKey),
    });
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
    return conversations.make(opts.model, messages);
  }

  return { model: opts.model, run, resume };
}
