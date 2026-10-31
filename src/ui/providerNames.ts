import type { LlmProviderId } from '../domain/transcript';

/** How the UI names each LLM provider: the company that receives the text, and its key field's label. */
export const PROVIDER_NAMES: Readonly<
  Record<LlmProviderId, { company: string; keyLabel: string }>
> = {
  claude: { company: 'Anthropic', keyLabel: 'Claude (Anthropic) API key' },
  gemini: { company: 'Google', keyLabel: 'Gemini (Google) API key' },
};
