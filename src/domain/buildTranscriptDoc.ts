import { buildTurns } from './segmentation';
import type { NormalizedTranscription } from './tokens';
import {
  TRANSCRIPT_SCHEMA_VERSION,
  type SourceInfo,
  type TranscriptDoc,
  type TranscriptionRequestInfo,
} from './transcript';

/** Assembles the canonical TranscriptDoc from a provider result plus what was sent. */
export function buildTranscriptDoc(
  norm: NormalizedTranscription,
  source: SourceInfo,
  request: TranscriptionRequestInfo,
  deps: { now?: () => Date; uuid?: () => string } = {},
): TranscriptDoc {
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const { speakers, turns } = buildTurns(norm.tokens);

  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    id: uuid(),
    createdAt: now().toISOString(),
    source,
    request,
    result: {
      providerTranscriptId: norm.providerTranscriptId,
      languageCode: norm.languageCode,
      languageProbability: norm.languageProbability,
      audioDurationSec: norm.audioDurationSec,
    },
    speakers,
    turns,
    translations: {},
  };
}
