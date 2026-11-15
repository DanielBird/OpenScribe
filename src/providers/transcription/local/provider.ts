// Transcription on this computer (DECISIONS.md D50, D51, D53): a second TranscriptionProvider. The engine runs in the
// desktop app's Rust side, through the injected bridge; this maps its result to NormalizedTokens, so segmentation, the
// doc, playback, translation, export and projects don't know which engine ran.
import { ProviderError } from '../../errors';
import type { TranscriptionProvider } from '../types';
import { LocalSttError, toLocalError, type LocalSttBridge } from './bridge';
import { toProviderError } from './errors';
import { localLimits, localPack } from './limits';
import { toTokens } from './mapper';

export function createLocalProvider(bridge: LocalSttBridge): TranscriptionProvider {
  return {
    id: 'local',
    model: localPack().id,
    needsKey: false,
    supports: { keyterms: false, zeroRetention: false, numSpeakers: false },
    limits: localLimits(),
    languages: localPack().languages,

    async transcribe(input, { signal, onProgress }) {
      onProgress({ phase: 'preparing' });
      try {
        // The engine takes neither: Parakeet detects the language itself and the C API ignores the number of
        // speakers (Phase 33). The hint still becomes the doc's language when the engine reports none.
        const result = await bridge.transcribe(
          input.file,
          { languageHint: input.languageHint, numSpeakers: input.numSpeakers },
          { signal, onProgress },
        );
        if (signal.aborted) throw new LocalSttError('cancelled', 'cancelled');
        return {
          providerTranscriptId: null,
          languageCode: result.language ?? '',
          languageProbability: null,
          audioDurationSec: result.durationSec,
          tokens: toTokens(result.words, result.speakerSegments, { cleanUp: input.cleanUp }),
          timings: result.timings,
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const local = signal.aborted
          ? new LocalSttError('cancelled', 'cancelled')
          : toLocalError(error);
        throw toProviderError(local, input.file.name);
      }
    },
  };
}
