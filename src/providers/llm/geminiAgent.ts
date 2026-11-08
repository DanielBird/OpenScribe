// The project agent's function-calling loop with Gemini, in the browser (PROJECTS.md §5.5, Phase 20). The same
// contract and the same loop as `claudeAgent.ts` (`agentLoop.ts`), with the SDK's automatic function calling off;
// this file makes one request and reads its reply. No SDK type leaves this file (DECISIONS.md D26).
import {
  BlockedReason,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type GenerateContentResponsePromptFeedback,
  type GenerateContentResponseUsageMetadata,
  type Part,
} from '@google/genai/web';
import { ProviderError, withoutSecret } from '../errors';
import { createConversations, runAgentLoop, type AgentOutput } from './agentLoop';
import { GEMINI_MESSAGES, REFUSAL_FINISH, toGeminiSchema, toProviderError } from './gemini';
import { GEMINI_THINKING_FOR } from './models';
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

/**
 * Re-sends of a request that ended in a malformed or unexpected function call, in a row. Google documents no retry
 * policy for these; the reply has no usable call, so it is sent again once, as Claude's unreadable tool JSON is.
 */
const MALFORMED_RETRIES = 1;

/** Finish reasons for a function call the API couldn't read or didn't expect. */
const MALFORMED_FINISH: ReadonlySet<string> = new Set([
  FinishReason.MALFORMED_FUNCTION_CALL,
  FinishReason.UNEXPECTED_TOOL_CALL,
]);

export interface GeminiAgentOptions {
  apiKey: string;
  model: string;
  /** Tests inject a fake; the browser's fetch otherwise. */
  fetch?: typeof globalThis.fetch;
  /** Retries of 408/429/5xx (the SDK retries only when asked). Tests set 0. */
  maxRetries?: number;
}

/** The contents behind each conversation this module made. Anything else passed in is a programming error. */
const conversations = createConversations<Content>('geminiAgent');

/** `promptTokenCount` includes the cached tokens; thinking is counted apart from the answer. */
function usageOf(meta: GenerateContentResponseUsageMetadata | undefined): AgentUsage {
  const cached = meta?.cachedContentTokenCount ?? 0;
  return {
    inputTokens: (meta?.promptTokenCount ?? 0) - cached + (meta?.toolUsePromptTokenCount ?? 0),
    outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

/** The request's function declarations, in the given order, from each tool's zod schema. */
function functionDeclarations(tools: readonly AgentTool[]): FunctionDeclaration[] {
  return tools.map((tool) => {
    const schema = toGeminiSchema(tool.input);
    if (schema.type !== 'object')
      throw new Error(`geminiAgent: ${tool.name}'s input isn't an object`);
    return { name: tool.name, description: tool.description, parametersJsonSchema: schema };
  });
}

/** The instructions, then the context: what changes least comes first, for Gemini's implicit caching. */
function systemInstruction(req: AgentRunRequest): Content {
  return {
    parts: [req.instructions, req.context].filter((text) => text !== '').map((text) => ({ text })),
  };
}

/** One streamed reply: every part of every chunk, unchanged and in order, so thought signatures go back as they came. */
interface StreamedTurn {
  parts: Part[];
  finishReason: FinishReason | undefined;
  promptFeedback: GenerateContentResponsePromptFeedback | undefined;
  usage: GenerateContentResponseUsageMetadata | undefined;
}

const callsOf = (parts: readonly Part[]): FunctionCall[] =>
  parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));

const textOf = (parts: readonly Part[]) =>
  parts
    .flatMap((part) => (typeof part.text === 'string' && !part.thought ? [part.text] : []))
    .join('');

/** Collects the turn's parts, and streams the answer's text (never thought parts) as it comes. */
async function readStream(
  stream: AsyncGenerator<GenerateContentResponse>,
  output: AgentOutput,
): Promise<StreamedTurn> {
  const turn: StreamedTurn = {
    parts: [],
    finishReason: undefined,
    promptFeedback: undefined,
    usage: undefined,
  };
  for await (const chunk of stream) {
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      turn.parts.push(part);
      if (typeof part.text === 'string' && !part.thought) output.text(part.text);
    }
    if (candidate?.finishReason) turn.finishReason = candidate.finishReason;
    if (chunk.promptFeedback) turn.promptFeedback = chunk.promptFeedback;
    if (chunk.usageMetadata) turn.usage = chunk.usageMetadata;
  }
  return turn;
}

export function createGeminiAgent(opts: GeminiAgentOptions): AgentProvider {
  const apiKey = opts.apiKey.trim();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      retryOptions: { attempts: (opts.maxRetries ?? 2) + 1 },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    },
  });

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    // Built once, so every request of the run starts with the same bytes.
    const tools = [{ functionDeclarations: functionDeclarations(req.tools) }];
    const system = systemInstruction(req);

    return runAgentLoop<Content, FunctionCall, Part>(req, {
      model: opts.model,
      conversations,
      resends: MALFORMED_RETRIES,
      messages: GEMINI_MESSAGES,
      userTurn: (text) => ({ role: 'user', parts: [{ text }] }),

      /**
       * One request, streamed, then the checks that end the run: a blocked prompt or a refusal (the partial reply
       * isn't kept). A malformed function call sends it again.
       */
      async send(contents, output) {
        const stream = await ai.models.generateContentStream({
          model: opts.model,
          contents: [...contents],
          config: {
            systemInstruction: system,
            tools,
            automaticFunctionCalling: { disable: true },
            thinkingConfig: { thinkingLevel: ThinkingLevel[GEMINI_THINKING_FOR[req.effort]] },
            maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
            abortSignal: req.signal,
          },
        });
        const turn = await readStream(stream, output);
        output.usage(usageOf(turn.usage));

        const blocked = turn.promptFeedback?.blockReason;
        if (blocked && blocked !== BlockedReason.BLOCKED_REASON_UNSPECIFIED) {
          throw new ProviderError('refused', GEMINI_MESSAGES.refused, {
            retryable: false,
            detail: `prompt blocked: ${blocked}`,
          });
        }
        const finish = turn.finishReason;
        if (finish && REFUSAL_FINISH.has(finish)) {
          throw new ProviderError('refused', GEMINI_MESSAGES.refused, {
            retryable: false,
            detail: `finish reason: ${finish}`,
          });
        }
        if (finish && MALFORMED_FINISH.has(finish)) return { resend: `finish reason: ${finish}` };

        const calls = callsOf(turn.parts);
        if (finish === FinishReason.MAX_TOKENS && calls.length) {
          throw new ProviderError('bad_output', GEMINI_MESSAGES.badOutput, {
            detail: 'function call cut off (MAX_TOKENS)',
          });
        }
        if (finish === FinishReason.TOO_MANY_TOOL_CALLS) {
          throw new ProviderError('bad_output', GEMINI_MESSAGES.badOutput, {
            detail: `finish reason: ${finish}`,
          });
        }
        const next =
          calls.length > 0 ? 'tools' : finish === FinishReason.MAX_TOKENS ? 'limit' : 'done';
        return {
          turn: { role: 'model', parts: turn.parts },
          text: textOf(turn.parts),
          calls,
          next,
        };
      },

      callOf: (call) => ({ name: call.name ?? '', input: call.args ?? {} }),
      result: (call, { content, isError }) => ({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name ?? '',
          // The documented keys: "output" for a result, "error" for what went wrong.
          response: isError ? { error: content } : { output: content },
        },
      }),
      // Their responses go back in one turn, in the order of the calls.
      resultsTurn: (responses) => ({ role: 'user', parts: responses }),
      toError(err) {
        const mapped = req.signal.aborted
          ? new ProviderError('aborted', GEMINI_MESSAGES.aborted)
          : toProviderError(err, opts.model);
        return withoutSecret(mapped, apiKey);
      },
    });
  }

  /**
   * Earlier turns as text alone. Only the current turn's function calls need their thought signatures, so earlier
   * model turns without them are accepted (reference/llm-providers.md, "Resuming a saved chat").
   */
  function resume(history: readonly AgentExchange[]): AgentConversation {
    const contents: Content[] = history.flatMap(({ question, answer }) => [
      { role: 'user', parts: [{ text: question }] },
      { role: 'model', parts: [{ text: answer }] },
    ]);
    return conversations.make(opts.model, contents);
  }

  return { model: opts.model, run, resume };
}
