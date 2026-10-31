// Translates a transcript turn by turn (DECISIONS.md D7). Batches run one after another; each reply must
// contain exactly the requested turn ids, or the batch is tried once more.
import { languageName, type TranscriptDoc } from '../../domain/transcript';
import { ProviderError } from '../../providers/errors';
import type { LlmProvider } from '../../providers/llm/types';
import { makeBatches, type Batch } from './batching';
import { buildInput, systemPrompt, TranslationBatchSchema, type TranslationBatch } from './prompt';

export const TRANSLATION_MESSAGES = {
  incomplete: 'Part of the translation came back incomplete.',
  cancelled: 'Translation cancelled.',
  unexpected: 'Something went wrong while translating. Try again.',
} as const;

export interface TranslateOptions {
  signal?: AbortSignal;
  /** Called before each request. `batch` counts from 1 across the whole transcript. */
  onProgress?: (p: { batch: number; totalBatches: number }) => void;
  /** Turn texts from an earlier run that stopped; their batches are skipped. */
  resumeFrom?: Record<string, string>;
}

/** Stops a run. `completed` holds every turn translated so far, so the run can resume from there. */
export class TranslationError extends Error {
  constructor(
    // Narrows ES2022 `Error.cause` (unknown) to the provider error that stopped the run.
    public override readonly cause: ProviderError,
    public readonly completed: Record<string, string>,
    public readonly failedBatchIndex: number,
  ) {
    super(cause.userMessage);
    this.name = 'TranslationError';
  }
}

/** The whole transcript in English: turn id → text, for every turn. Throws `TranslationError`. */
export async function translateTranscript(
  doc: TranscriptDoc,
  provider: LlmProvider,
  opts: TranslateOptions = {},
): Promise<Record<string, string>> {
  const { signal, onProgress } = opts;
  const completed: Record<string, string> = { ...opts.resumeFrom };
  const batches = makeBatches(doc.turns);
  const system = systemPrompt(languageName(doc.result.languageCode));
  const glossary = doc.request.keyterms;
  const labels = new Map(doc.speakers.map((s) => [s.id, s.label]));

  for (const batch of batches) {
    if (batch.turns.every((t) => Object.hasOwn(completed, t.id))) continue;
    try {
      if (signal?.aborted) throw cancelled();
      onProgress?.({ batch: batch.index + 1, totalBatches: batches.length });
      const input = buildInput(batch, glossary, labels);
      Object.assign(completed, await translateBatch(batch, provider, system, input, signal));
    } catch (err) {
      throw new TranslationError(asProviderError(err, signal), { ...completed }, batch.index);
    }
  }

  return Object.fromEntries(doc.turns.map((t) => [t.id, completed[t.id] ?? '']));
}

/** One batch, tried a second time if the reply is unreadable or doesn't match the request. */
async function translateBatch(
  batch: Batch,
  provider: LlmProvider,
  system: string,
  input: string,
  signal: AbortSignal | undefined,
): Promise<Record<string, string>> {
  let lastError: ProviderError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await provider.generateStructured({
        system,
        input,
        schema: TranslationBatchSchema,
        schemaName: 'translation_batch',
        signal,
      });
      return checkReply(batch, reply);
    } catch (err) {
      const error = asProviderError(err, signal);
      if (error.kind !== 'bad_output') throw error;
      lastError = error;
    }
  }
  throw lastError ?? new ProviderError('unknown', TRANSLATION_MESSAGES.unexpected);
}

/** The reply's texts by id, if it has exactly the requested ids, each once, each with text. */
export function checkReply(batch: Batch, reply: TranslationBatch): Record<string, string> {
  const wanted = new Set(batch.turns.map((t) => t.id));
  const seen = new Set<string>();
  const texts: Record<string, string> = {};
  const problems: string[] = [];

  for (const { id, text } of reply.translations) {
    if (!wanted.has(id)) {
      problems.push(`unexpected id ${id}`);
    } else if (seen.has(id)) {
      problems.push(`duplicate id ${id}`);
    } else {
      seen.add(id);
      if (text.trim() === '') problems.push(`empty text for ${id}`);
      else texts[id] = text.trim();
    }
  }
  for (const id of wanted) {
    if (!seen.has(id)) problems.push(`missing id ${id}`);
  }

  if (problems.length > 0) {
    throw new ProviderError('bad_output', TRANSLATION_MESSAGES.incomplete, {
      detail: `batch ${batch.index + 1}: ${problems.slice(0, 5).join(', ')}`,
    });
  }
  return texts;
}

const cancelled = () => new ProviderError('aborted', TRANSLATION_MESSAGES.cancelled);

function asProviderError(err: unknown, signal: AbortSignal | undefined): ProviderError {
  if (signal?.aborted) return cancelled();
  if (err instanceof ProviderError) return err;
  return new ProviderError('unknown', TRANSLATION_MESSAGES.unexpected, {
    detail: err instanceof Error ? err.message : undefined,
  });
}
