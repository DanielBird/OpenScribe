// The local provider's side of the desktop app (src-tauri/src/stt/commands.rs). Nothing Rust sends is trusted as
// typed: every reply is parsed here (AGENTS.md rule 6). Only the desktop build reaches this module.
import { invokeCommand, openChannel } from '../../../desktop/ipc';
import { tokenOf } from '../../../desktop/recordings';
import { z } from '../../../lib/zod';
import type { TranscriptionProgress } from '../types';

export const LOCAL_ERROR_KINDS = [
  'busy',
  'recording',
  'pack-missing',
  'pack-damaged',
  'pack-outdated',
  'cpu',
  'unreadable',
  'out-of-memory',
  'engine',
  'cancelled',
] as const;
export type LocalErrorKind = (typeof LOCAL_ERROR_KINDS)[number];

/** A failure as Rust reports it: a kind, and a detail with no paths outside the pack. */
export class LocalSttError extends Error {
  constructor(
    public readonly kind: LocalErrorKind,
    public readonly detail: string,
  ) {
    super(`${kind}: ${detail}`);
    this.name = 'LocalSttError';
  }
}

// The schemas are made when first used, never at import: a module with no top-level work is one the web build leaves
// out (AGENTS.md rule 1).
function makeSchemas() {
  const finite = z.number().refine(Number.isFinite, 'not a finite number');
  const pack = z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    languages: z.array(z.string()),
    maxSpeakers: z.number().int().positive(),
    downloadBytes: z.number().int().nonnegative(),
  });
  return {
    pack,
    status: z.discriminatedUnion('state', [
      z.object({ state: z.literal('ready'), pack }),
      z.object({ state: z.literal('missing'), pack }),
      z.object({
        state: z.literal('unusable'),
        pack,
        reason: z.enum(['damaged', 'outdated', 'cpu']),
      }),
    ]),
    result: z.object({
      language: z.string().nullable(),
      durationSec: finite.nonnegative(),
      words: z.array(
        z.object({
          text: z.string(),
          start: finite,
          end: finite,
          confidence: z.number().nullable(),
        }),
      ),
      speakerSegments: z.array(
        z.object({ speaker: z.number().int().nonnegative(), start: finite, end: finite }),
      ),
      timings: z.object({
        decodeSec: finite,
        wordsSec: finite,
        speakersSec: finite,
        totalSec: finite,
        threads: z.number().int().positive(),
        peakMemoryBytes: z.number().int().nonnegative().nullable(),
      }),
    }),
    progress: z.discriminatedUnion('phase', [
      z.object({ phase: z.literal('preparing') }),
      z.object({
        phase: z.literal('transcribing'),
        doneSec: finite.nonnegative(),
        totalSec: finite.positive().nullable(),
      }),
    ]),
    error: z.object({ kind: z.enum(LOCAL_ERROR_KINDS), detail: z.string() }),
  };
}

type Schemas = ReturnType<typeof makeSchemas>;
let cachedSchemas: Schemas | null = null;

/** What every reply from Rust is checked against. */
export function bridgeSchemas(): Schemas {
  return (cachedSchemas ??= makeSchemas());
}

export type SpeechPackInfo = z.infer<Schemas['pack']>;
/** Phase 35 adds a 'downloading' state. */
export type LocalSttStatus = z.infer<Schemas['status']>;
export type LocalSttResult = z.infer<Schemas['result']>;
export type LocalSttTimings = LocalSttResult['timings'];

/** What Rust rejected with, as a LocalSttError. Anything unexpected is an engine failure. */
export function toLocalError(raw: unknown): LocalSttError {
  if (raw instanceof LocalSttError) return raw;
  const parsed = bridgeSchemas().error.safeParse(raw);
  if (parsed.success) return new LocalSttError(parsed.data.kind, parsed.data.detail);
  const detail =
    raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : 'an unreadable reply';
  return new LocalSttError('engine', detail.slice(0, 300));
}

export interface LocalSttBridge {
  status(): Promise<LocalSttStatus>;
  transcribe(
    file: File,
    options: { languageHint: string; numSpeakers: number | null },
    opts: { signal: AbortSignal; onProgress: (p: TranscriptionProgress) => void },
  ): Promise<LocalSttResult>;
}

/** The bridge to the desktop app's commands. */
export function createTauriSttBridge(): LocalSttBridge {
  return {
    async status() {
      try {
        return bridgeSchemas().status.parse(await invokeCommand('stt_status'));
      } catch (error) {
        throw toLocalError(error);
      }
    },

    async transcribe(file, _options, { signal, onProgress }) {
      // The engine names the recording by the token Rust chose it under; a File from anywhere else has none.
      const token = tokenOf(file);
      if (token === null) {
        throw new LocalSttError('recording', 'the recording was not chosen by the app');
      }
      if (signal.aborted) throw new LocalSttError('cancelled', 'cancelled before starting');
      const channel = openChannel((message) => {
        const progress = bridgeSchemas().progress.safeParse(message);
        if (progress.success) onProgress(progress.data);
      });
      const cancel = () => {
        invokeCommand('stt_cancel').catch(() => {});
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const reply = await invokeCommand('stt_start', { token, onProgress: channel });
        const result = bridgeSchemas().result.safeParse(reply);
        if (!result.success) {
          throw new LocalSttError('engine', 'the engine sent an unreadable result');
        }
        return result.data;
      } catch (error) {
        throw toLocalError(error);
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
  };
}
