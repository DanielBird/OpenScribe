// Claude (Anthropic) from the browser (docs/reference/llm-providers.md). Each user supplies their own key,
// which is why `dangerouslyAllowBrowser` is acceptable here.
import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { ProviderError, withoutSecret } from '../errors';
import type { KeyCheckResult } from '../transcription/types';
import { CLAUDE_EFFORT } from './models';
import { DEFAULT_MAX_OUTPUT_TOKENS, type LlmProvider, type StructuredRequest } from './types';

/**
 * Server-side refusal fallback (DECISIONS.md T9): if a safety classifier declines a request, the API re-runs
 * it on the model Anthropic recommends for that refusal category, in the same call.
 */
export const CLAUDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const MAX_REASON_CHARS = 200;

export const CLAUDE_MESSAGES = {
  auth: "Claude didn't accept the API key. Check it in Settings.",
  quota:
    'Your Anthropic account has no credit left. Add credit in the Claude Console, then try again.',
  rateLimit: "Claude is busy or your account's rate limit was reached. Try again in a minute.",
  server: 'Claude had a problem. Try again in a few minutes.',
  network:
    "Couldn't reach Claude. Check your internet connection or whether your network blocks api.anthropic.com.",
  aborted: 'Cancelled.',
  refused: 'Claude declined to process this text.',
  badOutput: "Claude sent a reply that DeScribe couldn't read. Try again.",
  validation: "Claude couldn't process the request.",
  unexpected: 'Something went wrong while talking to Claude. Try again.',
  keyOk: 'The key works with Claude.',
  keyEmpty: 'Enter a key first.',
  keyInvalid: "Claude doesn't recognise this key. Check that you copied all of it.",
} as const;

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
  /** Tests inject a fake; the browser's fetch otherwise. */
  fetch?: typeof globalThis.fetch;
  /** Retries of 408/409/429/5xx and connection errors (SDK default 2). Tests set 0. */
  maxRetries?: number;
}

export function createClaudeProvider(opts: ClaudeProviderOptions): LlmProvider {
  const apiKey = opts.apiKey.trim();
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: opts.maxRetries ?? 2,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  return {
    id: 'claude',
    model: opts.model,

    async generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
      const format = betaZodOutputFormat(req.schema);
      try {
        // Streamed, so long replies don't hit HTTP timeouts (the SDK refuses large `max_tokens` without it).
        // The format goes without its `parse`: given one, the stream parses every text block when it ends and
        // throws before a refusal or a cut-off reply can be told apart. The text is parsed below instead.
        const stream = client.beta.messages.stream(
          {
            model: opts.model,
            max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            system: req.system,
            messages: [{ role: 'user', content: req.input }],
            output_config: {
              effort: CLAUDE_EFFORT,
              format: { type: format.type, schema: format.schema },
            },
            betas: [CLAUDE_FALLBACK_BETA],
            fallbacks: 'default',
          },
          { signal: req.signal },
        );
        const message = await stream.finalMessage();

        // A refusal arrives as HTTP 200, before any output or part-way through it; check it before reading.
        if (message.stop_reason === 'refusal') {
          const category = message.stop_details?.category;
          throw new ProviderError('refused', CLAUDE_MESSAGES.refused, {
            retryable: false,
            detail: category ? `refusal: ${category}` : 'refusal',
          });
        }
        if (message.stop_reason === 'max_tokens') {
          throw new ProviderError('bad_output', CLAUDE_MESSAGES.badOutput, {
            detail: 'stopped at max_tokens',
          });
        }

        const text = message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('');
        try {
          return format.parse(text);
        } catch (err) {
          throw new ProviderError('bad_output', CLAUDE_MESSAGES.badOutput, {
            detail: err instanceof Error ? err.message.slice(0, MAX_REASON_CHARS) : undefined,
          });
        }
      } catch (err) {
        throw withoutSecret(toProviderError(err, opts.model), apiKey);
      }
    },
  };
}

/**
 * Checks a key by listing one model (verification log K1): it costs nothing, and every key that can send messages
 * can list models. Rejects only when `signal` aborts; every other outcome is a result to show.
 */
export async function verifyClaudeKey(
  rawKey: string,
  signal: AbortSignal,
  opts: Pick<ClaudeProviderOptions, 'fetch' | 'maxRetries'> = {},
): Promise<KeyCheckResult> {
  const apiKey = rawKey.trim();
  if (apiKey === '') return { ok: false, message: CLAUDE_MESSAGES.keyEmpty };
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: opts.maxRetries ?? 2,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  try {
    await client.models.list({ limit: 1 }, { signal });
    return { ok: true, message: CLAUDE_MESSAGES.keyOk };
  } catch (err) {
    if (err instanceof APIUserAbortError) throw toProviderError(err, '');
    if (err instanceof AuthenticationError)
      return { ok: false, message: CLAUDE_MESSAGES.keyInvalid };
    return { ok: false, message: withoutSecret(toProviderError(err, ''), apiKey).userMessage };
  }
}

/** The API's own explanation, e.g. "max_tokens: … is too large", if the body has one. */
function apiReason(err: APIError): string | undefined {
  const body: unknown = err.error;
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const inner: unknown = body.error;
  if (typeof inner !== 'object' || inner === null || !('message' in inner)) return undefined;
  return typeof inner.message === 'string' && inner.message.trim() !== ''
    ? inner.message.trim()
    : undefined;
}

const withReason = (prefix: string, reason: string | undefined, fallback: string) =>
  reason ? `${prefix}: ${reason.slice(0, MAX_REASON_CHARS).replace(/[.\s]+$/, '')}.` : fallback;

/** Maps what the SDK throws to a ProviderError, most specific class first. Never matches on message text. */
export function toProviderError(err: unknown, model: string): ProviderError {
  if (err instanceof ProviderError) return err;

  if (err instanceof APIUserAbortError) {
    return new ProviderError('aborted', CLAUDE_MESSAGES.aborted);
  }
  if (err instanceof APIConnectionError) {
    // Includes APIConnectionTimeoutError.
    return new ProviderError('network', CLAUDE_MESSAGES.network, { detail: err.message });
  }
  if (err instanceof APIError) {
    const status = typeof err.status === 'number' ? err.status : undefined;
    const reason = apiReason(err);
    const opts = { status, detail: [err.type, reason].filter(Boolean).join(': ') || undefined };

    // Out of credit comes back as a 400 with a typed `billing_error`.
    if (err.type === 'billing_error')
      return new ProviderError('quota', CLAUDE_MESSAGES.quota, opts);
    if (err instanceof AuthenticationError) {
      return new ProviderError('auth', CLAUDE_MESSAGES.auth, opts);
    }
    if (err instanceof PermissionDeniedError) {
      const message = withReason('Claude refused the request', reason, CLAUDE_MESSAGES.auth);
      return new ProviderError('auth', message, opts);
    }
    if (err instanceof RateLimitError) {
      return new ProviderError('rate_limit', CLAUDE_MESSAGES.rateLimit, opts);
    }
    if (err instanceof NotFoundError) {
      return new ProviderError(
        'validation',
        `Claude doesn't offer the model "${model}" to this key. Choose another model.`,
        opts,
      );
    }
    if (err instanceof BadRequestError) {
      const message = withReason(
        "Claude couldn't process the request",
        reason,
        CLAUDE_MESSAGES.validation,
      );
      return new ProviderError('validation', message, opts);
    }
    if (err instanceof InternalServerError) {
      return new ProviderError('server', CLAUDE_MESSAGES.server, opts);
    }
    // A stream that fails part-way ends with an `error` event: no HTTP status, only the error's type.
    if (err.type === 'overloaded_error' || err.type === 'api_error') {
      return new ProviderError('server', CLAUDE_MESSAGES.server, opts);
    }
    if (err.type === 'rate_limit_error') {
      return new ProviderError('rate_limit', CLAUDE_MESSAGES.rateLimit, opts);
    }
    return new ProviderError('unknown', CLAUDE_MESSAGES.unexpected, opts);
  }
  if (err instanceof AnthropicError || err instanceof Error) {
    return new ProviderError('unknown', CLAUDE_MESSAGES.unexpected, { detail: err.message });
  }
  return new ProviderError('unknown', CLAUDE_MESSAGES.unexpected);
}
