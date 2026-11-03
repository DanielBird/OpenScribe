import { describe, expect, it } from 'vitest';
import { ProviderError, redactSecret, technicalDetails, withoutSecret } from './errors';

describe('ProviderError', () => {
  it('carries kind, message and options', () => {
    const err = new ProviderError('auth', 'Bad key.', { status: 401, detail: 'invalid_api_key' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ProviderError');
    expect(err.message).toBe('Bad key.');
    expect(err.userMessage).toBe('Bad key.');
    expect(err.opts).toEqual({ status: 401, detail: 'invalid_api_key' });
  });

  it.each([
    ['rate_limit', true],
    ['server', true],
    ['network', true],
    ['auth', false],
    ['quota', false],
    ['validation', false],
    ['aborted', false],
    ['bad_output', false],
  ] as const)('%s is retryable: %s', (kind, retryable) => {
    expect(new ProviderError(kind, 'x').retryable).toBe(retryable);
  });

  it('lets opts.retryable override the default', () => {
    expect(new ProviderError('server', 'x', { retryable: false }).retryable).toBe(false);
    expect(new ProviderError('bad_output', 'x', { retryable: true }).retryable).toBe(true);
  });
});

describe('secret redaction', () => {
  const key = 'sk_test_SENTINEL_0123456789';

  it('replaces every occurrence of the secret', () => {
    expect(redactSecret(`a ${key} b ${key}`, key)).toBe('a [redacted] b [redacted]');
  });

  it('ignores empty or very short secrets', () => {
    expect(redactSecret('abc', '')).toBe('abc');
    expect(redactSecret('abc', 'b')).toBe('abc');
  });

  it('cleans message and detail, keeping kind and status', () => {
    const err = new ProviderError('validation', `Bad: ${key}`, { status: 422, detail: key });
    const clean = withoutSecret(err, key);
    expect(clean.userMessage).toBe('Bad: [redacted]');
    expect(clean.message).toBe('Bad: [redacted]');
    expect(clean.opts).toEqual({ status: 422, detail: '[redacted]' });
    expect(clean.kind).toBe('validation');
  });

  it('returns the same error when there is nothing to redact', () => {
    const err = new ProviderError('server', 'Oops.', { status: 500 });
    expect(withoutSecret(err, key)).toBe(err);
  });
});

describe('technicalDetails', () => {
  it('gives the kind and status, then the detail', () => {
    const err = new ProviderError('auth', 'Bad key.', {
      status: 401,
      detail: 'invalid_api_key: Invalid API key (request r-1)',
    });
    expect(technicalDetails(err)).toBe(
      'auth · HTTP 401\ninvalid_api_key: Invalid API key (request r-1)',
    );
  });

  it('leaves out what the error lacks', () => {
    expect(technicalDetails(new ProviderError('rate_limit', 'x', { status: 429 }))).toBe(
      'rate_limit · HTTP 429',
    );
    expect(technicalDetails(new ProviderError('refused', 'x', { detail: 'refusal: cyber' }))).toBe(
      'refused\nrefusal: cyber',
    );
  });

  it('is null with nothing beyond the message', () => {
    expect(technicalDetails(new ProviderError('aborted', 'Cancelled.'))).toBeNull();
    expect(technicalDetails(new ProviderError('unknown', 'x', { detail: '' }))).toBeNull();
    expect(technicalDetails(new Error('boom'))).toBeNull();
    expect(technicalDetails(null)).toBeNull();
  });
});
