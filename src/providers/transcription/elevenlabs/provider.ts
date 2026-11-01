import { ProviderError, redactSecret, withoutSecret } from '../../errors';
import type { KeyCheckResult, NormalizedTranscription, TranscriptionProvider } from '../types';
import { normalizeLanguage } from '../../../domain/transcript';
import { ELEVENLABS_MESSAGES, parseErrorBody, toProviderError } from './errors';
import { ELEVENLABS_LANGUAGES } from './languages';
import { ELEVENLABS_LIMITS, ELEVENLABS_MODEL } from './limits';
import { toNormalized } from './mapper';
import { buildFormData, buildKeyCheckFormData, buildUrl, ELEVENLABS_STT_URL } from './request';
import { xhrTransport, type HttpResult, type Transport } from './transport';

/** ElevenLabs Speech-to-Text. */
export function createElevenLabsProvider(
  transport: Transport = xhrTransport,
): TranscriptionProvider {
  return {
    id: 'elevenlabs',
    model: ELEVENLABS_MODEL,
    limits: ELEVENLABS_LIMITS,
    languages: ELEVENLABS_LANGUAGES.map(normalizeLanguage),

    async transcribe(input, { signal, onProgress }): Promise<NormalizedTranscription> {
      const apiKey = input.apiKey.trim();
      try {
        const total = input.file.size;
        let processing = false;
        const toProcessing = () => {
          if (processing) return;
          processing = true;
          onProgress({ phase: 'processing' });
        };

        onProgress({ phase: 'uploading', loaded: 0, total });
        const res = await transport.post(
          buildUrl(input.zeroRetention),
          buildFormData(input),
          { 'xi-api-key': apiKey },
          {
            signal,
            onUploadProgress: (loaded, reportedTotal) => {
              if (!processing)
                onProgress({ phase: 'uploading', loaded, total: reportedTotal || total });
            },
            onUploadDone: toProcessing,
          },
        );
        if (signal.aborted) throw new ProviderError('aborted', ELEVENLABS_MESSAGES.aborted);
        toProcessing();

        if (res.status < 200 || res.status >= 300) throw toProviderError(res.status, res.bodyText);

        let json: unknown;
        try {
          json = JSON.parse(res.bodyText);
        } catch {
          throw new ProviderError('bad_output', ELEVENLABS_MESSAGES.badOutput, {
            status: res.status,
            detail: 'response is not JSON',
          });
        }
        return toNormalized(json);
      } catch (err) {
        if (err instanceof ProviderError) throw withoutSecret(err, apiKey);
        const detail = err instanceof Error ? redactSecret(err.message, apiKey) : undefined;
        throw new ProviderError('unknown', ELEVENLABS_MESSAGES.unexpected, { detail });
      }
    },

    /**
     * Checks a key with a transcription request that has no audio (verification log V3). Keys restricted to
     * Speech-to-Text can't call the account or model endpoints, but this works for them and costs nothing.
     * Rejects only when `signal` aborts; every other outcome is a result to show.
     */
    async verifyKey(rawKey, signal): Promise<KeyCheckResult> {
      const apiKey = rawKey.trim();
      if (apiKey === '') return { ok: false, message: ELEVENLABS_MESSAGES.keyEmpty };
      try {
        const res = await transport.post(
          ELEVENLABS_STT_URL,
          buildKeyCheckFormData(),
          { 'xi-api-key': apiKey },
          { signal: signal ?? new AbortController().signal },
        );
        return interpretKeyCheck(res, apiKey);
      } catch (err) {
        if (err instanceof ProviderError) {
          if (err.kind === 'aborted') throw err;
          return { ok: false, message: withoutSecret(err, apiKey).userMessage };
        }
        return { ok: false, message: ELEVENLABS_MESSAGES.unexpected };
      }
    },
  };
}

/**
 * Seen live (V3): a valid key gets 400 `invalid_parameters` "Must provide either file or a URL parameter.",
 * an invalid key gets 401 `invalid_api_key`. Anything else is explained with the normal error mapping.
 */
function interpretKeyCheck({ status, bodyText }: HttpResult, apiKey: string): KeyCheckResult {
  const { code, message } = parseErrorBody(bodyText);
  const onlyAudioMissing =
    (status === 400 || status === 422) &&
    (code === 'invalid_parameters' || /\bfile\b|\burl\b/i.test(message ?? ''));
  if (onlyAudioMissing || (status >= 200 && status < 300)) {
    return { ok: true, message: ELEVENLABS_MESSAGES.keyOk };
  }
  const err = toProviderError(status, bodyText);
  if (status === 401 && err.kind === 'auth' && code !== 'missing_permissions') {
    return { ok: false, message: ELEVENLABS_MESSAGES.keyInvalid };
  }
  return { ok: false, message: withoutSecret(err, apiKey).userMessage };
}
