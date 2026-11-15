// The speech pack this build works with (src-tauri/speech-pack/pack.json, which Rust compiles in too), so the local
// provider's limits and languages can't disagree with what the engine runs. Read when first asked, never at import:
// a module with no top-level work is one the web build leaves out (AGENTS.md rule 1).
import pack from '../../../../src-tauri/speech-pack/pack.json';
import { normalizeLanguage } from '../../../domain/transcript';
import { z } from '../../../lib/zod';

export interface LocalPack {
  id: string;
  version: string;
  /** Parakeet's 25 European languages, as `normalizeLanguage()` codes. */
  languages: readonly string[];
  maxSpeakers: number;
  downloadBytes: number;
}

let cached: LocalPack | null = null;

export function localPack(): LocalPack {
  if (cached) return cached;
  const parsed = z
    .object({
      id: z.string().min(1),
      version: z.string().min(1),
      languages: z.array(z.string().min(2)),
      maxSpeakers: z.number().int().positive(),
      models: z.array(z.object({ bytes: z.number().int().positive() })),
    })
    .parse(pack);
  cached = {
    id: parsed.id,
    version: parsed.version,
    languages: parsed.languages.map(normalizeLanguage),
    maxSpeakers: parsed.maxSpeakers,
    downloadBytes: parsed.models.reduce((sum, m) => sum + m.bytes, 0),
  };
  return cached;
}

/** No size or length limit: the file is read from disk in pieces, in constant memory (Phase 33, M4). */
export function localLimits() {
  return {
    maxFileBytes: Number.POSITIVE_INFINITY,
    maxDurationSec: Number.POSITIVE_INFINITY,
    minDurationSec: 0.1,
    maxSpeakers: localPack().maxSpeakers,
  };
}
