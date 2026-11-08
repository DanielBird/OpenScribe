import type { LlmProviderId } from '../../domain/transcript';
import type { z } from '../../lib/zod';

/** One request for JSON that matches `schema`. */
export interface StructuredRequest<T> {
  system: string;
  input: string; // user message content (we send JSON text)
  schema: z.ZodType<T>; // adapters convert it to the provider's JSON-schema format
  schemaName: string; // e.g. 'translation_batch'
  maxOutputTokens?: number; // default 16000
  signal?: AbortSignal;
}

/** A text model that returns structured output. Used for translation now and the AI audit later (D11). */
export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly model: string;
  /** Throws `ProviderError`; the kind says what went wrong. */
  generateStructured<T>(req: StructuredRequest<T>): Promise<T>;
}

export const DEFAULT_MAX_OUTPUT_TOKENS = 16000;

// The project agent (PROJECTS.md §5.5, phase 16). Nothing here names a provider's SDK types, so Gemini can
// implement the same contract (DECISIONS.md D26).

declare const agentConversation: unique symbol;

/**
 * A conversation so far, opaque outside the provider that made it. It only ever grows: each run returns a new one
 * that starts with the old one unchanged, so thinking blocks go back to the API exactly as they came.
 */
export interface AgentConversation {
  readonly [agentConversation]: true;
  readonly model: string;
}

export interface AgentUsage {
  inputTokens: number; // uncached input
  outputTokens: number; // including thinking
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentTool<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  /** `activity` is one line for the UI. A throw becomes an error result with the thrown message. */
  run(input: I, signal: AbortSignal): Promise<{ content: string; activity: string }>;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  /**
   * The provider is sending a request again because it couldn't use the reply. The last `discard` characters of the
   * text streamed so far came from that reply: a consumer that shows the text drops them. Its usage still counts.
   */
  | { type: 'retry'; discard: number }
  | { type: 'tool'; name: string; activity: string; isError: boolean }
  | { type: 'usage'; usage: AgentUsage };

/** How hard the agent thinks, whichever provider runs it (DECISIONS.md D48). */
export type AgentEffort = 'low' | 'medium' | 'high';

export interface AgentRunRequest {
  instructions: string; // fixed; cached
  context: string; // frozen for the conversation; cached
  tools: readonly AgentTool[]; // always in the same order
  conversation: AgentConversation | null;
  userMessage: string;
  maxIterations: number; // requests per run; a backstop behind the tools' own budgets
  effort: AgentEffort; // the same for every request of a run, so the run's cache holds
  signal: AbortSignal;
  onEvent(event: AgentEvent): void;
}

export interface AgentRunResult {
  text: string; // everything the model wrote this run, as streamed
  conversation: AgentConversation;
  usage: AgentUsage; // summed over the run's requests
  stopped: 'done' | 'limit';
}

/** A question and the answer's text, from a saved chat (DECISIONS.md D29). */
export interface AgentExchange {
  question: string;
  answer: string;
}

export interface AgentProvider {
  readonly model: string;
  /** Throws `ProviderError`, or `Error` for a conversation started on another model (a programming error). */
  run(req: AgentRunRequest): Promise<AgentRunResult>;
  /**
   * A conversation on this provider's model made from a saved chat's questions and answers, as plain text: no
   * thinking and no tool calls, which can't be kept outside the provider (D29). `run` continues it.
   */
  resume(history: readonly AgentExchange[]): AgentConversation;
}

/**
 * Room for thinking and a long answer, per agent request. Claude needs streaming for this much (the skill's default);
 * Gemini 4 Argon's output limit is 65,536.
 */
export const AGENT_MAX_OUTPUT_TOKENS = 64000;

export const NO_USAGE: AgentUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export function addUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}
