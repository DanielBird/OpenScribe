// Which provider the app uses for each job. One place to change, and one place for tests to swap.
import type { LlmProviderId, TranscriptionProviderId } from '../domain/transcript';
import { createClaudeProvider, verifyClaudeKey } from './llm/claude';
import { createClaudeAgent } from './llm/claudeAgent';
import { createGeminiProvider, verifyGeminiKey } from './llm/gemini';
import { createGeminiAgent } from './llm/geminiAgent';
import type { AgentProvider, LlmProvider } from './llm/types';
import { createElevenLabsProvider } from './transcription/elevenlabs/provider';
import { createTauriSttBridge, type LocalSttBridge } from './transcription/local/bridge';
import { createLocalProvider } from './transcription/local/provider';
import type { KeyCheckResult, TranscriptionProvider } from './transcription/types';

const transcription: Partial<Record<TranscriptionProviderId, TranscriptionProvider>> = {};
const transcriptionOverrides: Partial<Record<TranscriptionProviderId, TranscriptionProvider>> = {};
let localBridge: LocalSttBridge | null = null;
let localBridgeOverride: LocalSttBridge | null = null;

/**
 * The desktop app's speech commands: the local provider's runs, and the speech models' status, download and removal
 * (Settings). One bridge for both. Only the desktop build calls it: `null` in the web build.
 */
export function getLocalSttBridge(): LocalSttBridge | null {
  if (localBridgeOverride) return localBridgeOverride;
  if (!__DESKTOP__) return null;
  return (localBridge ??= createTauriSttBridge());
}

/** Replaces the local bridge in tests; `null` restores the real one. */
export function setLocalSttBridgeForTests(bridge: LocalSttBridge | null): void {
  localBridgeOverride = bridge;
}

/**
 * ElevenLabs, or this computer's speech models in the desktop app (DECISIONS.md D11, D50). The web build has only
 * ElevenLabs: `__DESKTOP__` is false there, so the local provider and its Tauri code are left out of the bundle.
 */
export function getTranscriptionProvider(
  id: TranscriptionProviderId = 'elevenlabs',
): TranscriptionProvider {
  const override = transcriptionOverrides[id];
  if (override) return override;
  if (__DESKTOP__ && id === 'local') {
    const bridge = getLocalSttBridge();
    if (bridge) return (transcription.local ??= createLocalProvider(bridge));
  }
  return (transcription.elevenlabs ??= createElevenLabsProvider());
}

/** Replaces a provider in tests (ElevenLabs if no id is given); `null` restores the real one. */
export function setTranscriptionProviderForTests(
  p: TranscriptionProvider | null,
  id: TranscriptionProviderId = 'elevenlabs',
): void {
  if (p) transcriptionOverrides[id] = p;
  else delete transcriptionOverrides[id];
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
