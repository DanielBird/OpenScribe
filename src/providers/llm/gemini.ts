// Gemini (Google) from the browser (docs/reference/llm-providers.md). The `/web` entry is the browser build;
// the package root would resolve to the Node build (google-auth-library, ws) under Vitest.
import {
  ApiError,
  BlockedReason,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentResponse,
  type GenerateContentResponsePromptFeedback,
  type GenerateContentResponseUsageMetadata,
} from '@google/genai/web';
import { z } from '../../lib/zod';
import { ProviderError, withoutSecret } from '../errors';
import type { KeyCheckResult } from '../transcription/types';
import { GEMINI_THINKING } from './models';
import { DEFAULT_MAX_OUTPUT_TOKENS, type LlmProvider, type StructuredRequest } from './types';

const MAX_REASON_CHARS = 200;

export const GEMINI_MESSAGES = {
  auth: "Gemini didn't accept the API key. Check it in Settings.",
  quota:
    "Your Google project's Gemini quota or prepaid credit is used up. Check it in Google AI Studio, then try again.",
  rateLimit: "Gemini is busy or your project's quota was reached. Try again in a minute.",
  server: 'Gemini had a problem. Try again in a few minutes.',
  network:
    "Couldn't reach Gemini. Check your internet connection or whether your network blocks " +
    'generativelanguage.googleapis.com.',
  aborted: 'Cancelled.',
  refused: 'Gemini declined to process this text.',
  badOutput: "Gemini sent a reply that DeScribe couldn't read. Try again.",
  validation: "Gemini couldn't process the request.",
  unexpected: 'Something went wrong while talking to Gemini. Try again.',
  keyOk: 'The key works with Gemini.',
  keyEmpty: 'Enter a key first.',
  keyInvalid: "Gemini didn't accept this key. Check that you copied all of it.",
} as const;

/** Finish reasons that mean the model stopped for a policy reason rather than a fault. */
export const REFUSAL_FINISH: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  /** Tests inject a fake; the browser's fetch otherwise. */
  fetch?: typeof globalThis.fetch;
  /** Retries of 408/429/5xx (the SDK retries only when asked). Tests set 0. */
  maxRetries?: number;
}

export function createGeminiProvider(opts: GeminiProviderOptions): LlmProvider {
  const apiKey = opts.apiKey.trim();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      retryOptions: { attempts: (opts.maxRetries ?? 2) + 1 },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    },
  });

  return {
    id: 'gemini',
    model: opts.model,

    // Streamed (DECISIONS.md T15), like Claude's: a long summary would otherwise wait on one silent request. The
    // checks run once the stream has ended, in the order they did before streaming.
    async generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
      try {
        const stream = await ai.models.generateContentStream({
          model: opts.model,
          contents: req.input,
          config: {
            systemInstruction: req.system,
            responseMimeType: 'application/json',
            responseJsonSchema: toGeminiSchema(req.schema),
            maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingLevel: ThinkingLevel[GEMINI_THINKING] },
            abortSignal: req.signal,
          },
        });

        const response = await readStream(stream);
        const blocked = response.promptFeedback?.blockReason;
        if (blocked && blocked !== BlockedReason.BLOCKED_REASON_UNSPECIFIED) {
          throw new ProviderError('refused', GEMINI_MESSAGES.refused, {
            retryable: false,
            detail: `prompt blocked: ${blocked}`,
          });
        }
        const finish = response.finishReason;
        if (finish && REFUSAL_FINISH.has(finish)) {
          throw new ProviderError('refused', GEMINI_MESSAGES.refused, {
            retryable: false,
            detail: `finish reason: ${finish}`,
          });
        }
        if (finish === FinishReason.MAX_TOKENS) {
          throw new ProviderError('bad_output', GEMINI_MESSAGES.badOutput, {
            detail: 'stopped at MAX_TOKENS',
          });
        }

        let json: unknown;
        try {
          json = JSON.parse(response.text);
        } catch {
          throw new ProviderError('bad_output', GEMINI_MESSAGES.badOutput, {
            detail: 'reply is not JSON',
          });
        }
        const parsed = req.schema.safeParse(json);
        if (!parsed.success) {
          throw new ProviderError('bad_output', GEMINI_MESSAGES.badOutput, {
            detail: parsed.error.message.slice(0, MAX_REASON_CHARS),
          });
        }
        return parsed.data;
      } catch (err) {
        const mapped = req.signal?.aborted
          ? new ProviderError('aborted', GEMINI_MESSAGES.aborted)
          : toProviderError(err, opts.model);
        throw withoutSecret(mapped, apiKey);
      }
    },
  };
}

/**
 * Checks a key by listing one model (verification log K2): it costs nothing and uses no quota. Rejects only when
 * `signal` aborts; every other outcome is a result to show.
 */
export async function verifyGeminiKey(
  rawKey: string,
  signal: AbortSignal,
  opts: Pick<GeminiProviderOptions, 'fetch' | 'maxRetries'> = {},
): Promise<KeyCheckResult> {
  const apiKey = rawKey.trim();
  if (apiKey === '') return { ok: false, message: GEMINI_MESSAGES.keyEmpty };
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      retryOptions: { attempts: (opts.maxRetries ?? 2) + 1 },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    },
  });
  try {
    await ai.models.list({ config: { pageSize: 1, abortSignal: signal } });
    return { ok: true, message: GEMINI_MESSAGES.keyOk };
  } catch (err) {
    if (signal.aborted) throw new ProviderError('aborted', GEMINI_MESSAGES.aborted);
    // A wrong key is a 400 with the reason API_KEY_INVALID; 401 and 403 are mapped to `auth` too.
    const mapped = toProviderError(err, '');
    if (mapped.kind === 'auth') return { ok: false, message: GEMINI_MESSAGES.keyInvalid };
    return { ok: false, message: withoutSecret(mapped, apiKey).userMessage };
  }
}

/** What `generateStructured` needs from a streamed reply. */
interface StreamedReply {
  /** The answer's text, without thought parts. */
  text: string;
  /** The last finish reason in the stream. */
  finishReason: FinishReason | undefined;
  promptFeedback: GenerateContentResponsePromptFeedback | undefined;
  /** The last usage the stream reported (the SDK sums it across continuations). */
  usage: GenerateContentResponseUsageMetadata | undefined;
}

/**
 * Joins the chunks of a streamed reply. The parts are read directly rather than through `chunk.text`, whose getter
 * warns about non-text parts.
 */
async function readStream(stream: AsyncGenerator<GenerateContentResponse>): Promise<StreamedReply> {
  const reply: StreamedReply = {
    text: '',
    finishReason: undefined,
    promptFeedback: undefined,
    usage: undefined,
  };
  for await (const chunk of stream) {
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text === 'string' && !part.thought) reply.text += part.text;
    }
    if (candidate?.finishReason) reply.finishReason = candidate.finishReason;
    if (chunk.promptFeedback) reply.promptFeedback = chunk.promptFeedback;
    if (chunk.usageMetadata) reply.usage = chunk.usageMetadata;
  }
  return reply;
}

/**
 * zod → JSON Schema for `responseJsonSchema` and the agent's `parametersJsonSchema`. `$schema` is dropped: Gemini
 * lists it as unsupported.
 */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dropped, ...rest } = z.toJSONSchema(schema);
  return inclusiveBounds(nullableAsTypeArray(rest)) as Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * zod writes `.positive()` as `exclusiveMinimum`, which Gemini's schema docs don't list (only `minimum` and
 * `maximum`). On an integer it becomes the equivalent inclusive bound; on a number it is dropped, and the zod parse
 * still checks it.
 */
function inclusiveBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(inclusiveBounds);
  if (!isObject(node)) return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, inclusiveBounds(v)]));
  const { exclusiveMinimum: min, exclusiveMaximum: max, ...rest } = out;
  if (typeof min !== 'number' && typeof max !== 'number') return out;
  const integer = rest.type === 'integer';
  return {
    ...rest,
    ...(typeof min === 'number' && integer ? { minimum: min + 1 } : {}),
    ...(typeof max === 'number' && integer ? { maximum: max - 1 } : {}),
  };
}

/**
 * zod writes `.nullable()` as `anyOf: [<schema>, { type: 'null' }]`. Gemini's docs give a type array,
 * `type: ['string', 'null']`, as the way to allow null, so a nullable schema with a single type is rewritten to that.
 */
function nullableAsTypeArray(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(nullableAsTypeArray);
  if (!isObject(node)) return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, nullableAsTypeArray(v)]));
  const { anyOf, ...rest } = out;
  if (!Array.isArray(anyOf) || anyOf.length !== 2) return out;
  const isNull = (s: unknown) => isObject(s) && s.type === 'null' && Object.keys(s).length === 1;
  const other = anyOf.find((s) => !isNull(s));
  if (!anyOf.some(isNull) || !isObject(other) || typeof other.type !== 'string') return out;
  return { ...other, ...rest, type: [other.type, 'null'] };
}

/**
 * The parts of a Google API error body we use: `{ error: { code, message, status, details } }`. `details` may hold a
 * `reason` (`google.rpc.ErrorInfo`) or quota `violations` (`google.rpc.QuotaFailure`). `code` is a number in the
 * classic API and a string such as `quota_exceeded` in Google's newer error list, so both are read.
 */
const GoogleErrorBodySchema = z.object({
  error: z.object({
    code: z.union([z.number(), z.string()]).optional(),
    message: z.string().optional(),
    status: z.string().optional(),
    details: z
      .array(
        z
          .object({
            reason: z.string().optional(),
            violations: z.array(z.object({ quotaId: z.string().optional() }).loose()).optional(),
          })
          .loose(),
      )
      .optional(),
  }),
});

/**
 * The SDK puts the JSON error body in `ApiError.message`: on its own for an HTTP error, after "got status: …. " for
 * an error inside the stream. The JSON starts at the first `{`.
 */
function parseErrorBody(err: ApiError) {
  try {
    const start = err.message.indexOf('{');
    if (start === -1) return {};
    const parsed = GoogleErrorBodySchema.safeParse(JSON.parse(err.message.slice(start)));
    if (!parsed.success) return {};
    const { code, message, status, details = [] } = parsed.data.error;
    const reasons = details.flatMap((d) => (d.reason ? [d.reason] : []));
    const quotaIds = details.flatMap((d) => (d.violations ?? []).map((v) => v.quotaId ?? ''));
    // A spent daily quota, rather than a per-minute limit (DECISIONS.md T15). Google documents
    // `quota_exceeded` but not the QuotaFailure ids; `PerDay` is how those ids name the daily quotas.
    const dailyQuota = code === 'quota_exceeded' || quotaIds.some((id) => id.includes('PerDay'));
    return { message, status, reasons, dailyQuota };
  } catch {
    return {};
  }
}

/** Maps what the SDK throws to a ProviderError, using the status and the structured reason. */
export function toProviderError(err: unknown, model: string): ProviderError {
  if (err instanceof ProviderError) return err;

  if (err instanceof ApiError) {
    const { message, status: code, reasons = [], dailyQuota = false } = parseErrorBody(err);
    const status = err.status;
    const detail =
      [code, ...reasons, message?.slice(0, MAX_REASON_CHARS)].filter(Boolean).join(': ') ||
      undefined;
    const opts = { status, detail };

    if (status === 401 || status === 403 || reasons.includes('API_KEY_INVALID')) {
      return new ProviderError('auth', GEMINI_MESSAGES.auth, opts);
    }
    // 402: the prepaid credit is used up (Google's API errors page). Don't retry either.
    if (status === 402 || (status === 429 && dailyQuota)) {
      return new ProviderError('quota', GEMINI_MESSAGES.quota, opts);
    }
    if (status === 429) return new ProviderError('rate_limit', GEMINI_MESSAGES.rateLimit, opts);
    if (status === 404) {
      return new ProviderError(
        'validation',
        `Gemini doesn't offer the model "${model}" to this key. Choose another model.`,
        opts,
      );
    }
    if (status >= 500) return new ProviderError('server', GEMINI_MESSAGES.server, opts);
    if (status >= 400) {
      const userMessage = message
        ? `Gemini couldn't process the request: ${message.slice(0, MAX_REASON_CHARS).replace(/[.\s]+$/, '')}.`
        : GEMINI_MESSAGES.validation;
      return new ProviderError('validation', userMessage, opts);
    }
    return new ProviderError('unknown', GEMINI_MESSAGES.unexpected, opts);
  }
  // fetch rejects with a TypeError when the network fails or the host is blocked.
  if (err instanceof TypeError) {
    return new ProviderError('network', GEMINI_MESSAGES.network, { detail: err.message });
  }
  // A stream event the SDK can't read: its JSON parse throws a SyntaxError, or the SDK wraps it in a plain Error.
  if (
    err instanceof SyntaxError ||
    (err instanceof Error && err.message.startsWith('exception parsing stream chunk'))
  ) {
    return new ProviderError('bad_output', GEMINI_MESSAGES.badOutput, {
      detail: err.message.slice(0, MAX_REASON_CHARS),
    });
  }
  return new ProviderError('unknown', GEMINI_MESSAGES.unexpected, {
    detail: err instanceof Error ? err.message : undefined,
  });
}
