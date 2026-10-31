// XMLHttpRequest transport (DECISIONS.md T2: fetch can't report upload progress). Injectable for tests.
import { ProviderError } from '../../errors';
import { ELEVENLABS_MESSAGES } from './errors';

export interface HttpResult {
  status: number;
  bodyText: string;
}

export interface Transport {
  post(
    url: string,
    body: FormData,
    headers: Record<string, string>,
    opts: {
      signal: AbortSignal;
      onUploadProgress?: (loaded: number, total: number) => void;
      onUploadDone?: () => void;
    },
  ): Promise<HttpResult>;
  get(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<HttpResult>;
}

interface SendOptions {
  signal?: AbortSignal;
  onUploadProgress?: (loaded: number, total: number) => void;
  onUploadDone?: () => void;
}

/** Resolves for any HTTP status; status mapping happens in errors.ts. Rejects only on abort or network failure. */
function send(
  method: 'GET' | 'POST',
  url: string,
  body: FormData | null,
  headers: Record<string, string>,
  { signal, onUploadProgress, onUploadDone }: SendOptions,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('aborted', ELEVENLABS_MESSAGES.aborted));
      return;
    }

    const xhr = new XMLHttpRequest();
    const onAbortSignal = () => xhr.abort();
    const settle = (fn: () => void) => {
      signal?.removeEventListener('abort', onAbortSignal);
      fn();
    };

    xhr.open(method, url);
    xhr.timeout = 0; // no client timeout: transcribing a long file can take many minutes
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    if (body) {
      xhr.upload.onprogress = (e) => onUploadProgress?.(e.loaded, e.lengthComputable ? e.total : 0);
      xhr.upload.onload = () => onUploadDone?.();
    }
    xhr.onload = () => settle(() => resolve({ status: xhr.status, bodyText: xhr.responseText }));
    xhr.onerror = () =>
      settle(() => reject(new ProviderError('network', ELEVENLABS_MESSAGES.network)));
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () =>
      settle(() => reject(new ProviderError('aborted', ELEVENLABS_MESSAGES.aborted)));

    signal?.addEventListener('abort', onAbortSignal, { once: true });
    xhr.send(body);
  });
}

export const xhrTransport: Transport = {
  post: (url, body, headers, opts) => send('POST', url, body, headers, opts),
  get: (url, headers, signal) => send('GET', url, null, headers, { signal }),
};
