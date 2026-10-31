import { describe, expect, it } from 'vitest';
import error400Keyword from '../../../../fixtures/elevenlabs/error-400-invalid-keyword.json';
import error401Permissions from '../../../../fixtures/elevenlabs/error-401-missing-permissions.json';
import error401 from '../../../../fixtures/elevenlabs/error-401.json';
import error403ZeroRetention from '../../../../fixtures/elevenlabs/error-403-zero-retention.json';
import error422 from '../../../../fixtures/elevenlabs/error-422.json';
import error429 from '../../../../fixtures/elevenlabs/error-429.json';
import { ELEVENLABS_MESSAGES, parseErrorBody, toProviderError } from './errors';

const body = (value: unknown) => JSON.stringify(value);

describe('parseErrorBody', () => {
  it('reads { detail: { status, message, request_id } }', () => {
    expect(parseErrorBody(body(error401))).toEqual({
      code: 'invalid_api_key',
      message: 'Invalid API key',
      requestId: 'fixture-request-0003',
    });
    expect(parseErrorBody(body({ detail: { status: 'x', message: 'y' } }))).toEqual({
      code: 'x',
      message: 'y',
    });
  });

  it('reads the full object shape seen live, preferring the specific status over the general code', () => {
    expect(parseErrorBody(body(error400Keyword))).toEqual({
      code: 'invalid_keyword',
      message: 'Some keyword contains invalid characters',
      requestId: 'fixture-request-0001',
    });
    expect(parseErrorBody(body({ detail: { code: 'forbidden' } }))).toEqual({ code: 'forbidden' });
  });

  it('reads { detail: "text" }', () => {
    expect(parseErrorBody(body({ detail: 'Unsupported file' }))).toEqual({
      message: 'Unsupported file',
    });
  });

  it('reads FastAPI-style validation lists', () => {
    expect(parseErrorBody(body(error422))).toEqual({ message: 'file: Field required' });
    expect(
      parseErrorBody(
        body({ detail: [{ msg: 'too big', loc: ['body', 'num_speakers'] }, { msg: 'x' }] }),
      ),
    ).toEqual({ message: 'num_speakers: too big; x' });
  });

  it('yields nothing for non-JSON or unexpected bodies', () => {
    expect(parseErrorBody('<html>Bad gateway</html>')).toEqual({});
    expect(parseErrorBody('')).toEqual({});
    expect(parseErrorBody(body({ error: 'nope' }))).toEqual({});
  });
});

describe('toProviderError (reference doc error table)', () => {
  it('status 0 → network', () => {
    const err = toProviderError(0, '');
    expect(err.kind).toBe('network');
    expect(err.userMessage).toBe(ELEVENLABS_MESSAGES.network);
    expect(err.retryable).toBe(true);
  });

  it('401 → auth', () => {
    const err = toProviderError(401, body(error401));
    expect(err.kind).toBe('auth');
    expect(err.userMessage).toBe('ElevenLabs rejected the API key. Check the key in Settings.');
    expect(err.opts).toEqual({
      status: 401,
      detail: 'invalid_api_key: Invalid API key (request fixture-request-0003)',
    });
    expect(err.retryable).toBe(false);
  });

  it('missing_permissions → auth, explaining that the key lacks Speech-to-Text access (V3)', () => {
    for (const status of [401, 403]) {
      const err = toProviderError(status, body(error401Permissions));
      expect(err.kind).toBe('auth');
      expect(err.userMessage).toBe(ELEVENLABS_MESSAGES.missingPermission);
      expect(err.userMessage).toContain("isn't allowed to use Speech-to-Text");
    }
  });

  it('zero retention on a non-Enterprise plan → validation, telling the user to switch it off (V2)', () => {
    const err = toProviderError(403, body(error403ZeroRetention));
    expect(err.kind).toBe('validation');
    expect(err.userMessage).toBe(
      'Zero retention is only available on ElevenLabs Enterprise plans. Switch off "Zero retention" on the Setup tab and try again.',
    );
    expect(err.retryable).toBe(false);
    expect(err.opts).toEqual({
      status: 403,
      detail:
        'not_allowed: Only users from the enterprise or trial tier can use ZRM mode. (request fixture-request-0002)',
    });
  });

  it('a glossary term with unsupported characters → validation naming the characters (V1)', () => {
    const err = toProviderError(400, body(error400Keyword));
    expect(err.kind).toBe('validation');
    expect(err.userMessage).toBe(ELEVENLABS_MESSAGES.invalidKeyterm);
    expect(err.userMessage).toContain('< > { } [ ] \\');
  });

  it("another 403 → auth, quoting ElevenLabs' reason instead of blaming the key", () => {
    const err = toProviderError(
      403,
      body({
        detail: { status: 'not_allowed', message: 'This feature is disabled for your workspace.' },
      }),
    );
    expect(err.kind).toBe('auth');
    expect(err.userMessage).toBe(
      'ElevenLabs refused the request: This feature is disabled for your workspace.',
    );
    expect(toProviderError(403, '').userMessage).toBe(ELEVENLABS_MESSAGES.auth);
  });

  it('402 → quota', () => {
    const err = toProviderError(402, '');
    expect(err.kind).toBe('quota');
    expect(err.userMessage).toBe('Your ElevenLabs account has no remaining credits for this file.');
  });

  it('a quota error in the body → quota, whatever the status', () => {
    const quotaBody = body({
      detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' },
    });
    expect(toProviderError(401, quotaBody).kind).toBe('quota');
    expect(toProviderError(400, body({ detail: 'Not enough credits left.' })).kind).toBe('quota');
  });

  it('422 → validation, with the detail in the message', () => {
    const err = toProviderError(422, body(error422));
    expect(err.kind).toBe('validation');
    expect(err.userMessage).toBe("ElevenLabs couldn't process the request: file: Field required.");
  });

  it('400 and 413 → validation; a detail ending in a full stop is not doubled', () => {
    expect(toProviderError(400, body({ detail: 'Unsupported audio format.' })).userMessage).toBe(
      "ElevenLabs couldn't process the request: Unsupported audio format.",
    );
    const tooLarge = toProviderError(413, '');
    expect(tooLarge.kind).toBe('validation');
    expect(tooLarge.userMessage).toBe("ElevenLabs couldn't process the request.");
  });

  it('truncates very long details', () => {
    const err = toProviderError(422, body({ detail: 'x'.repeat(1000) }));
    expect(err.userMessage.length).toBeLessThan(400);
    expect(err.opts.detail?.length).toBeLessThanOrEqual(300);
  });

  it('429 → rate_limit (retryable), even when the message mentions limits', () => {
    const err = toProviderError(429, body(error429));
    expect(err.kind).toBe('rate_limit');
    expect(err.userMessage).toBe(
      "ElevenLabs is busy or your plan's limit was reached. Try again in a minute.",
    );
    expect(err.retryable).toBe(true);
  });

  it.each([500, 502, 503])('%s → server (retryable)', (status) => {
    const err = toProviderError(status, '<html>oops</html>');
    expect(err.kind).toBe('server');
    expect(err.userMessage).toBe('ElevenLabs had a problem. Try again.');
    expect(err.retryable).toBe(true);
  });

  it('other statuses → unknown, naming the status', () => {
    const err = toProviderError(418, '');
    expect(err.kind).toBe('unknown');
    expect(err.userMessage).toBe('ElevenLabs returned an unexpected error (HTTP 418). Try again.');
  });

  it('never copies a non-JSON body (e.g. a proxy page) into the message', () => {
    const err = toProviderError(400, '<html><body>Blocked by corporate proxy</body></html>');
    expect(err.userMessage).not.toContain('proxy');
    expect(err.opts.detail).toBeUndefined();
  });
});
