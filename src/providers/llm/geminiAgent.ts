// The project agent's function-calling loop with Gemini, in the browser (PROJECTS.md §5.5, Phase 20). The same
// contract as `claudeAgent.ts`: a manual streamed loop, with the SDK's automatic function calling off. No SDK type
// leaves this file (DECISIONS.md D26).
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
import { z } from '../../lib/zod';
import { ProviderError, withoutSecret } from '../errors';
import { GEMINI_MESSAGES, REFUSAL_FINISH, toGeminiSchema, toProviderError } from './gemini';
import { GEMINI_THINKING } from './models';
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

const MAX_ERROR_CHARS = 300;

export interface GeminiAgentOptions {
  apiKey: string;
  model: string;
  /** Tests inject a fake; the browser's fetch otherwise. */
  fetch?: typeof globalThis.fetch;
  /** Retries of 408/429/5xx (the SDK retries only when asked). Tests set 0. */
  maxRetries?: number;
}

interface ConversationState {
  model: string;
  contents: readonly Content[];
}

/** The contents behind each conversation this module made. Anything else passed in is a programming error. */
const conversations = new WeakMap<AgentConversation, ConversationState>();

function makeConversation(state: ConversationState): AgentConversation {
  const conversation = Object.freeze({ model: state.model }) as unknown as AgentConversation;
  conversations.set(conversation, {
    model: state.model,
    contents: Object.freeze([...state.contents]),
  });
  return conversation;
}

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

const shortMessage = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS);

export function createGeminiAgent(opts: GeminiAgentOptions): AgentProvider {
  const apiKey = opts.apiKey.trim();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      retryOptions: { attempts: (opts.maxRetries ?? 2) + 1 },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    },
  });

  /** Runs one function call; every failure becomes an error response the model can read. */
  async function runTool(
    tools: readonly AgentTool[],
    call: FunctionCall,
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void,
  ): Promise<Part> {
    const name = call.name ?? '';
    const result = (content: string, isError: boolean, activity: string): Part => {
      onEvent({ type: 'tool', name, activity, isError });
      return {
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name,
          // The documented keys: "output" for a result, "error" for what went wrong.
          response: isError ? { error: content } : { output: content },
        },
      };
    };
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      const message = `There is no tool "${name}".`;
      return result(message, true, message);
    }
    const input = tool.input.safeParse(call.args ?? {});
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
    if (req.conversation && !previous) throw new Error('geminiAgent: unknown conversation');
    if (previous && previous.model !== opts.model) {
      throw new Error(
        `geminiAgent: a conversation started on ${previous.model} can't continue on ${opts.model}`,
      );
    }

    const contents: Content[] = [
      ...(previous?.contents ?? []),
      { role: 'user', parts: [{ text: req.userMessage }] },
    ];
    // Built once, so every request of the run starts with the same bytes.
    const tools = [{ functionDeclarations: functionDeclarations(req.tools) }];
    const system = systemInstruction(req);
    const texts: string[] = [];
    let usage = NO_USAGE;
    let breakBeforeText = false;
    /** Characters of text the current request has streamed, which a re-send takes back. */
    let streamed = 0;

    try {
      for (let iteration = 0; iteration < req.maxIterations; iteration++) {
        const turn = await streamReply();
        const calls = callsOf(turn.parts);
        const finish = turn.finishReason;

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

        contents.push({ role: 'model', parts: turn.parts });
        const text = textOf(turn.parts);
        if (text) {
          texts.push(text);
          breakBeforeText = true;
        }

        if (calls.length === 0)
          return finish === FinishReason.MAX_TOKENS ? done('limit') : done('done');

        // Parallel calls run together; their responses go back in one turn, in the order of the calls.
        const responses = await Promise.all(
          calls.map((call) => runTool(req.tools, call, req.signal, req.onEvent)),
        );
        contents.push({ role: 'user', parts: responses });
        if (req.signal.aborted) throw new ProviderError('aborted', GEMINI_MESSAGES.aborted);
      }
      // The backstop: the conversation ends with function responses, which a follow-up question follows.
      return done('limit');
    } catch (err) {
      const mapped = req.signal.aborted
        ? new ProviderError('aborted', GEMINI_MESSAGES.aborted)
        : toProviderError(err, opts.model);
      throw withoutSecret(mapped, apiKey);
    }

    function done(stopped: AgentRunResult['stopped']): AgentRunResult {
      return {
        text: texts.join('\n\n'),
        conversation: makeConversation({ model: opts.model, contents }),
        usage,
        stopped,
      };
    }

    /**
     * One request, streamed, then the checks that end the run: a blocked prompt or a refusal (the partial reply
     * isn't kept). A malformed function call is sent again, once, and the re-send takes back the text it streamed
     * (a `retry` event).
     */
    async function streamReply(): Promise<StreamedTurn> {
      for (let attempt = 0; ; attempt++) {
        const breakAtStart = breakBeforeText;
        streamed = 0;
        const stream = await ai.models.generateContentStream({
          model: opts.model,
          contents,
          config: {
            systemInstruction: system,
            tools,
            automaticFunctionCalling: { disable: true },
            thinkingConfig: { thinkingLevel: ThinkingLevel[GEMINI_THINKING] },
            maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
            abortSignal: req.signal,
          },
        });
        const turn = await readStream(stream);
        const meta = usageOf(turn.usage);
        usage = addUsage(usage, meta);
        req.onEvent({ type: 'usage', usage: meta });

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
        if (finish && MALFORMED_FINISH.has(finish)) {
          if (attempt >= MALFORMED_RETRIES) {
            throw new ProviderError('bad_output', GEMINI_MESSAGES.badOutput, {
              detail: `finish reason: ${finish}`,
            });
          }
          req.onEvent({ type: 'retry', discard: streamed });
          breakBeforeText = breakAtStart;
          continue;
        }
        return turn;
      }
    }

    /** Collects the turn's parts, and streams the answer's text (never thought parts) as it comes. */
    async function readStream(
      stream: AsyncGenerator<GenerateContentResponse>,
    ): Promise<StreamedTurn> {
      const turn: StreamedTurn = {
        parts: [],
        finishReason: undefined,
        promptFeedback: undefined,
        usage: undefined,
      };
      const emit = (delta: string) => {
        streamed += delta.length;
        req.onEvent({ type: 'text', delta });
      };
      for await (const chunk of stream) {
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          turn.parts.push(part);
          if (typeof part.text !== 'string' || part.thought || part.text === '') continue;
          if (breakBeforeText) {
            emit('\n\n');
            breakBeforeText = false;
          }
          emit(part.text);
        }
        if (candidate?.finishReason) turn.finishReason = candidate.finishReason;
        if (chunk.promptFeedback) turn.promptFeedback = chunk.promptFeedback;
        if (chunk.usageMetadata) turn.usage = chunk.usageMetadata;
      }
      return turn;
    }
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
    return makeConversation({ model: opts.model, contents });
  }

  return { model: opts.model, run, resume };
}
