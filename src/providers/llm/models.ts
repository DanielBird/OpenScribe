// The selectable translation models and the defaults (DECISIONS.md T7). Changing a model is a one-line edit.
import type { LlmProviderId } from '../../domain/transcript';
import type { AgentEffort, AgentUsage } from './types';

export const LLM_MODELS = {
  claude: {
    default: 'claude-opus-5-5',
    options: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
    ],
  },
  gemini: {
    default: 'gemini-3.8-flash',
    options: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (cheapest)' },
    ],
  },
} as const;

/**
 * How much Claude thinks per request (DECISIONS.md T9). Thinking can't be turned off on Opus 5.5, so effort
 * is the control for cost and depth; set explicitly because the API default differs between models.
 */
export const CLAUDE_EFFORT = 'medium' as const;

/** Whether `id` is one of the selectable models for `provider`. */
export function isKnownModel(provider: LlmProviderId, id: string): boolean {
  return LLM_MODELS[provider].options.some((o) => o.id === id);
}

/**
 * How much Gemini thinks per request (DECISIONS.md T15), set explicitly as `CLAUDE_EFFORT` is. `MEDIUM` is Gemini 3.8
 * Flash's default and both project models support it; Gemini 4 Argon's default isn't documented. The value of the
 * SDK's `ThinkingLevel`, written as a literal so this file doesn't import the SDK.
 */
export const GEMINI_THINKING = 'MEDIUM' as const;

/**
 * The project agent's effort, as the user sets it (DECISIONS.md D48). `CLAUDE_EFFORT` and `GEMINI_THINKING` stay for
 * translation and summaries. Claude takes these names as they are; every project model supports all three.
 */
export const AGENT_EFFORTS = ['low', 'medium', 'high'] as const satisfies readonly AgentEffort[];
export const DEFAULT_AGENT_EFFORT: AgentEffort = 'medium';

/** Gemini's name for each effort: values of the SDK's `ThinkingLevel`, as for `GEMINI_THINKING`. */
export const GEMINI_THINKING_FOR = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
} as const satisfies Record<AgentEffort, string>;

/**
 * The model for project work: the pipeline's translation, summaries and chat (DECISIONS.md D23, D26). Sonnet 5.5 by
 * default, for cost. Claude models use `CLAUDE_EFFORT`, Gemini models `GEMINI_THINKING`, except in the chat, which
 * uses the effort the user set (D48). The Translate dialog keeps `LLM_MODELS`.
 */
export const PROJECT_MODELS = {
  default: 'claude-sonnet-5-5',
  options: [
    { id: 'claude-sonnet-5-5', provider: 'claude', label: 'Sonnet 5.5' },
    { id: 'claude-opus-5-5', provider: 'claude', label: 'Opus 5.5' },
    { id: 'gemini-3.8-flash', provider: 'gemini', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-4-argon', provider: 'gemini', label: 'Gemini 4 Argon' },
  ],
} as const satisfies {
  default: string;
  options: readonly { id: string; provider: LlmProviderId; label: string }[];
};

/** Whether `id` is one of the project models. */
export function isProjectModel(id: string): boolean {
  return PROJECT_MODELS.options.some((o) => o.id === id);
}

/** The provider of a project model. Claude for an unknown id, which can't be selected anyway. */
export function projectProviderOf(model: string): LlmProviderId {
  return PROJECT_MODELS.options.find((o) => o.id === model)?.provider ?? 'claude';
}

/** A project model's label ("Sonnet 5.5"), or the id itself for a model that is no longer offered. */
export function projectModelLabel(model: string): string {
  return PROJECT_MODELS.options.find((o) => o.id === model)?.label ?? model;
}

/**
 * US dollars per million tokens. Claude's cache writes are the 5-minute ones (1.25 × input), the only kind Describe
 * makes; Gemini's implicit caching has no write price.
 */
export interface ModelPrices {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * List prices for an answer's approximate cost (PROJECTS.md §5.5), keyed by model id (DECISIONS.md D26).
 * - Claude: from the `claude-api` skill (2026-10-06).
 * - Gemini: Google's pricing page, standard paid tier (2026-10-21). These are the prices from 2026-12-01 (4 Argon) and
 *   2027-01-01 (3.8 Flash), twice those before: the maintainer chose to over-estimate until then. Neither model costs
 *   more above some prompt size. Output includes thinking.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrices>> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'gemini-3.8-flash': { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
  'gemini-4-argon': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
};

/** The approximate cost of `usage` on `model`, or `null` for a model without prices. */
export function estimateCostUsd(model: string, usage: AgentUsage): number | null {
  const prices = MODEL_PRICES[model];
  if (!prices) return null;
  return (
    (usage.inputTokens * prices.input +
      usage.outputTokens * prices.output +
      usage.cacheReadTokens * prices.cacheRead +
      usage.cacheWriteTokens * prices.cacheWrite) /
    1_000_000
  );
}
