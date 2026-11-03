import type { LlmProviderId } from '../domain/transcript';

export interface ProviderNames {
  /** The product: "Claude". */
  label: string;
  /** The company that receives the text: "Anthropic". */
  company: string;
  /** The key field's label. */
  keyLabel: string;
}

/** How the UI names each LLM provider. */
export const PROVIDER_NAMES: Readonly<Record<LlmProviderId, ProviderNames>> = {
  claude: { label: 'Claude', company: 'Anthropic', keyLabel: 'Claude (Anthropic) API key' },
  gemini: { label: 'Gemini', company: 'Google', keyLabel: 'Gemini (Google) API key' },
};

/** The providers in the order the UI lists them: the order of `PROVIDER_NAMES`. */
export const PROVIDER_LIST: readonly ({ id: LlmProviderId } & ProviderNames)[] = (
  Object.keys(PROVIDER_NAMES) as LlmProviderId[]
).map((id) => ({ id, ...PROVIDER_NAMES[id] }));
