export type ProviderErrorKind =
  | 'auth'
  | 'quota'
  | 'validation'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'aborted'
  | 'refused'
  | 'bad_output'
  | 'unknown';

/** An error from any AI provider, with a message that is safe to show (it never contains secrets). */
export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly userMessage: string, // safe to show; never contains secrets
    public readonly opts: { status?: number; retryable?: boolean; detail?: string } = {},
  ) {
    super(userMessage);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.opts.retryable ?? ['rate_limit', 'server', 'network'].includes(this.kind);
  }
}

/** Replaces every occurrence of `secret` in `text`. Use on anything derived from a response. */
export function redactSecret(text: string, secret: string): string {
  return secret.length >= 4 ? text.replaceAll(secret, '[redacted]') : text;
}

/** Returns `err` with the secret removed from its message and detail (the same object if nothing changed). */
export function withoutSecret(err: ProviderError, secret: string): ProviderError {
  const userMessage = redactSecret(err.userMessage, secret);
  const detail = err.opts.detail === undefined ? undefined : redactSecret(err.opts.detail, secret);
  if (userMessage === err.userMessage && detail === err.opts.detail) return err;
  return new ProviderError(err.kind, userMessage, { ...err.opts, detail });
}
