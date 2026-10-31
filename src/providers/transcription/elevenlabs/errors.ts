// HTTP status + body → ProviderError (docs/reference/elevenlabs-stt.md, "Errors").
// Messages never include headers or the API key; provider.ts also redacts the key from anything derived
// from a response.
import { ProviderError } from '../../errors';
import { ElevenLabsErrorBodySchema } from './types';

const MAX_DETAIL_CHARS = 300;

export const ELEVENLABS_MESSAGES = {
  network:
    "Couldn't reach ElevenLabs. Check your internet connection or whether your network blocks api.elevenlabs.io.",
  auth: 'ElevenLabs rejected the API key. Check the key in Settings.',
  missingPermission:
    "This ElevenLabs API key isn't allowed to use Speech-to-Text. In the ElevenLabs dashboard, give the key " +
    'Speech-to-Text access, or use another key.',
  zeroRetention:
    'Zero retention is only available on ElevenLabs Enterprise plans. Switch off "Zero retention" on the Setup tab ' +
    'and try again.',
  invalidKeyterm:
    "A glossary term contains characters ElevenLabs doesn't accept (< > { } [ ] \\). Remove them from the " +
    'glossary and try again.',
  quota: 'Your ElevenLabs account has no remaining credits for this file.',
  validation: "ElevenLabs couldn't process the request.",
  rateLimit: "ElevenLabs is busy or your plan's limit was reached. Try again in a minute.",
  server: 'ElevenLabs had a problem. Try again.',
  aborted: 'Transcription cancelled.',
  badOutput: "ElevenLabs sent a response that DeScribe couldn't read. Try again.",
  multichannel: "ElevenLabs sent a multichannel transcript, which DeScribe doesn't support.",
  unexpected: 'Something went wrong while talking to ElevenLabs. Try again.',
  keyOk: 'The key works with ElevenLabs Speech-to-Text.',
  keyEmpty: 'Enter a key first.',
  keyInvalid: "ElevenLabs doesn't recognise this key. Check that you copied all of it.",
} as const;

export interface ParsedErrorBody {
  /** The specific reason, e.g. "invalid_api_key", "invalid_keyword", "not_allowed". */
  code?: string;
  message?: string;
  requestId?: string;
}

/** Extracts the provider's error code, message and request id. Non-JSON bodies yield nothing. */
export function parseErrorBody(bodyText: string): ParsedErrorBody {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return {};
  }
  const parsed = ElevenLabsErrorBodySchema.safeParse(json);
  if (!parsed.success) return {};

  const { detail } = parsed.data;
  if (typeof detail === 'string') return { message: detail };
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      const field = (item.loc ?? []).filter((p) => p !== 'body').join('.');
      return field && item.msg ? `${field}: ${item.msg}` : (item.msg ?? field);
    });
    const message = parts.filter((p) => p !== '').join('; ');
    return message ? { message } : {};
  }
  const result: ParsedErrorBody = {};
  const code = detail.status ?? detail.code;
  if (code) result.code = code;
  if (detail.message) result.message = detail.message;
  if (detail.request_id) result.requestId = detail.request_id;
  return result;
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…` : text;
}

/** "<code>: <message> (request <id>)" for support and debugging; never shown as the main message. */
function technicalDetail({ code, message, requestId }: ParsedErrorBody): string | undefined {
  const summary = [code, message].filter(Boolean).join(': ');
  const request = requestId ? `request ${requestId}` : '';
  if (summary && request) return `${truncate(summary)} (${request})`;
  return summary ? truncate(summary) : request || undefined;
}

const withReason = (reason: string) =>
  `ElevenLabs couldn't process the request: ${truncate(reason).replace(/[.\s]+$/, '')}.`;

const QUOTA_PATTERN = /quota|credits?\b/i;
const ZERO_RETENTION_PATTERN = /\bZRM\b|zero[\s-]?retention|enterprise/i;

export function toProviderError(status: number, bodyText: string): ProviderError {
  const body = parseErrorBody(bodyText);
  const { code, message } = body;
  const opts = { status, detail: technicalDetail(body) };

  if (status === 0) return new ProviderError('network', ELEVENLABS_MESSAGES.network, opts);

  // Specific cases seen in the live checks (docs/reference/elevenlabs-stt.md, V1–V3).
  if (code === 'missing_permissions') {
    return new ProviderError('auth', ELEVENLABS_MESSAGES.missingPermission, opts);
  }
  if (code === 'invalid_keyword') {
    return new ProviderError('validation', ELEVENLABS_MESSAGES.invalidKeyterm, opts);
  }
  if (status === 403 && code === 'not_allowed' && ZERO_RETENTION_PATTERN.test(message ?? '')) {
    return new ProviderError('validation', ELEVENLABS_MESSAGES.zeroRetention, opts);
  }

  const quotaSignal =
    QUOTA_PATTERN.test(code ?? '') || (status !== 429 && QUOTA_PATTERN.test(message ?? ''));
  if (status === 402 || (status >= 400 && quotaSignal)) {
    return new ProviderError('quota', ELEVENLABS_MESSAGES.quota, opts);
  }
  if (status === 401) return new ProviderError('auth', ELEVENLABS_MESSAGES.auth, opts);
  if (status === 403) {
    // Forbidden for a reason we don't recognise: show ElevenLabs' own explanation if there is one.
    const userMessage = message
      ? `ElevenLabs refused the request: ${truncate(message).replace(/[.\s]+$/, '')}.`
      : ELEVENLABS_MESSAGES.auth;
    return new ProviderError('auth', userMessage, opts);
  }
  if (status === 400 || status === 413 || status === 422) {
    const reason = message ?? code;
    return new ProviderError(
      'validation',
      reason ? withReason(reason) : ELEVENLABS_MESSAGES.validation,
      opts,
    );
  }
  if (status === 429) return new ProviderError('rate_limit', ELEVENLABS_MESSAGES.rateLimit, opts);
  if (status >= 500) return new ProviderError('server', ELEVENLABS_MESSAGES.server, opts);
  return new ProviderError(
    'unknown',
    `ElevenLabs returned an unexpected error (HTTP ${status}). Try again.`,
    opts,
  );
}
