// Provider-neutral transcription output (DECISIONS.md T3). Providers map their responses to these types;
// the domain segments them into turns. Defined here so that domain/ never imports from providers/.

export interface NormalizedToken {
  text: string;
  start: number | null; // seconds
  end: number | null;
  speakerId: string | null;
  kind: 'word' | 'spacing' | 'event';
  logprob: number | null;
}

export interface NormalizedTranscription {
  providerTranscriptId: string | null;
  languageCode: string;
  languageProbability: number | null;
  audioDurationSec: number | null;
  tokens: NormalizedToken[];
}
