// ElevenLabs response → NormalizedTranscription (DECISIONS.md T3).
import type { NormalizedToken, NormalizedTranscription } from '../../../domain/tokens';
import { ProviderError } from '../../errors';
import { ELEVENLABS_MESSAGES } from './errors';
import { ElevenLabsResponseSchema } from './types';

function toKind(type: string): NormalizedToken['kind'] {
  if (type === 'spacing') return 'spacing';
  if (type === 'audio_event') return 'event';
  return 'word';
}

export function toNormalized(json: unknown): NormalizedTranscription {
  if (typeof json === 'object' && json !== null && 'transcripts' in json) {
    throw new ProviderError('bad_output', ELEVENLABS_MESSAGES.multichannel, {
      detail: 'multichannel response',
    });
  }

  const parsed = ElevenLabsResponseSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'response';
    throw new ProviderError('bad_output', ELEVENLABS_MESSAGES.badOutput, {
      detail: `${where}: ${issue?.message ?? 'invalid'}`,
    });
  }

  const r = parsed.data;
  return {
    providerTranscriptId: r.transcription_id ?? null,
    languageCode: r.language_code ?? '',
    languageProbability: r.language_probability ?? null,
    audioDurationSec: r.audio_duration_secs ?? null,
    tokens: r.words.map((w) => ({
      text: w.text,
      start: w.start ?? null,
      end: w.end ?? null,
      speakerId: w.speaker_id ?? null,
      kind: toKind(w.type),
      logprob: w.logprob ?? null,
    })),
  };
}
