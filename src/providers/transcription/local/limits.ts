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

/** A licence the speech models are under, by its SPDX id: how About names it and where its text is. */
export const MODEL_LICENCES: Readonly<Record<string, { name: string; url: string }>> = {
  'CC-BY-4.0': {
    name: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/legalcode.en',
  },
  'OpenMDW-1.1': { name: 'OpenMDW 1.1', url: 'https://openmdw.ai/license/1-1/' },
};

/** About's credit for one model (Phase 36): from pack.json, so it can't disagree with what the app downloads. */
export interface SpeechModelCredit {
  name: string;
  /** The model's card on Hugging Face. */
  card: string;
  licence: { id: string; name: string; url: string };
  copyright: string;
}

let credits: readonly SpeechModelCredit[] | null = null;

/** The models' names, cards, licences and copyright. Throws for a licence `MODEL_LICENCES` doesn't know. */
export function speechModelCredits(): readonly SpeechModelCredit[] {
  if (credits) return credits;
  const models = z
    .array(
      z.object({
        name: z.string().min(1),
        card: z.string().startsWith('https://huggingface.co/'),
        licence: z.string().min(1),
        copyright: z.string().min(1),
      }),
    )
    .parse(pack.models);
  credits = models.map((m) => {
    const licence = MODEL_LICENCES[m.licence];
    if (!licence) throw new Error(`No link for the speech model licence ${m.licence}`);
    return {
      name: m.name,
      card: m.card,
      licence: { id: m.licence, ...licence },
      copyright: m.copyright,
    };
  });
  return credits;
}
