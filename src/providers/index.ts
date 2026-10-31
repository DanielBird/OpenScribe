// Which provider the app uses for each job. One place to change, and one place for tests to swap.
import type { LlmProviderId } from '../domain/transcript';
import { createClaudeProvider, verifyClaudeKey } from './llm/claude';
import { createClaudeAgent } from './llm/claudeAgent';
import { createGeminiProvider, verifyGeminiKey } from './llm/gemini';
import { createGeminiAgent } from './llm/geminiAgent';
import type { AgentProvider, LlmProvider } from './llm/types';
import { createElevenLabsProvider } from './transcription/elevenlabs/provider';
import type { KeyCheckResult, TranscriptionProvider } from './transcription/types';

let transcription: TranscriptionProvider | null = null;
let transcriptionOverride: TranscriptionProvider | null = null;

/** ElevenLabs today (DECISIONS.md D11). */
export function getTranscriptionProvider(): TranscriptionProvider {
  return transcriptionOverride ?? (transcription ??= createElevenLabsProvider());
}

/** Replaces the provider in tests; `null` restores the real one. */
export function setTranscriptionProviderForTests(p: TranscriptionProvider | null): void {
  transcriptionOverride = p;
}

export type LlmProviderFactory = (id: LlmProviderId, apiKey: string, model: string) => LlmProvider;

const createLlmProvider: LlmProviderFactory = (id, apiKey, model) =>
  id === 'claude'
    ? createClaudeProvider({ apiKey, model })
    : createGeminiProvider({ apiKey, model });

let llmFactoryOverride: LlmProviderFactory | null = null;

/** Claude or Gemini (DECISIONS.md D7, D11), with the user's key. */
export function getLlmProvider(id: LlmProviderId, apiKey: string, model: string): LlmProvider {
  return (llmFactoryOverride ?? createLlmProvider)(id, apiKey, model);
}

/** Replaces the provider factory in tests; `null` restores the real one. */
export function setLlmProviderFactoryForTests(f: LlmProviderFactory | null): void {
  llmFactoryOverride = f;
}

export type AgentProviderFactory = (
  id: LlmProviderId,
  apiKey: string,
  model: string,
) => AgentProvider;

const createAgentProvider: AgentProviderFactory = (id, apiKey, model) =>
  id === 'claude' ? createClaudeAgent({ apiKey, model }) : createGeminiAgent({ apiKey, model });

/** Checks a Claude or Gemini key without sending any text. Rejects only when `signal` aborts. */
export function verifyLlmKey(
  id: LlmProviderId,
  apiKey: string,
  signal: AbortSignal,
): Promise<KeyCheckResult> {
  return id === 'claude' ? verifyClaudeKey(apiKey, signal) : verifyGeminiKey(apiKey, signal);
}

let agentFactoryOverride: AgentProviderFactory | null = null;

/** The project agent (PROJECTS.md §5.5): Claude or Gemini (DECISIONS.md D26), with the user's key. */
export function getAgentProvider(id: LlmProviderId, apiKey: string, model: string): AgentProvider {
  return (agentFactoryOverride ?? createAgentProvider)(id, apiKey, model);
}

/** Replaces the agent factory in tests; `null` restores the real one. */
export function setAgentProviderFactoryForTests(f: AgentProviderFactory | null): void {
  agentFactoryOverride = f;
}
