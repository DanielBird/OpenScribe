import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../errors';
import { xhrTransport } from './transport';

type Handler = (() => void) | null;

/** A scriptable stand-in for XMLHttpRequest. */
class FakeXHR {
  static instances: FakeXHR[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = undefined;
  timeout = -1;
  status = 0;
  responseText = '';
  abortCalls = 0;
  upload: { onprogress: ((e: ProgressEvent) => void) | null; onload: Handler } = {
    onprogress: null,
    onload: null,
  };
  onload: Handler = null;
  onerror: Handler = null;
  ontimeout: Handler = null;
  onabort: Handler = null;

  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.abortCalls++;
    this.onabort?.();
  }

  // Test helpers
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent);
  }
  respond(status: number, text: string) {
    this.upload.onload?.();
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

const latest = () => {
  const xhr = FakeXHR.instances.at(-1);
  if (!xhr) throw new Error('no XHR was created');
  return xhr;
};

describe('xhrTransport', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the body with headers, no timeout, and reports upload progress', async () => {
    const form = new FormData();
    const onUploadProgress = vi.fn();
    const onUploadDone = vi.fn();
    const promise = xhrTransport.post(
      'https://api.example/x',
      form,
      { 'xi-api-key': 'k' },
      {
        signal: new AbortController().signal,
        onUploadProgress,
        onUploadDone,
      },
    );

    const xhr = latest();
    expect([xhr.method, xhr.url, xhr.timeout, xhr.body]).toEqual([
      'POST',
      'https://api.example/x',
      0,
      form,
    ]);
    expect(xhr.headers).toEqual({ 'xi-api-key': 'k' });

    xhr.progress(10, 100);
    xhr.progress(50, 0, false); // total unknown
    xhr.respond(200, '{"ok":true}');

    await expect(promise).resolves.toEqual({ status: 200, bodyText: '{"ok":true}' });
    expect(onUploadProgress.mock.calls).toEqual([
      [10, 100],
      [50, 0],
    ]);
    expect(onUploadDone).toHaveBeenCalledOnce();
  });

  it('resolves for error statuses too (mapping happens elsewhere)', async () => {
    const promise = xhrTransport.post(
      'u',
      new FormData(),
      {},
      { signal: new AbortController().signal },
    );
    latest().respond(500, 'boom');
    await expect(promise).resolves.toEqual({ status: 500, bodyText: 'boom' });
  });

  it('rejects with a network error when the request fails', async () => {
    const promise = xhrTransport.post(
      'u',
      new FormData(),
      {},
      { signal: new AbortController().signal },
    );
    latest().onerror?.();
    await expect(promise).rejects.toMatchObject({ kind: 'network' });
    await expect(promise).rejects.toBeInstanceOf(ProviderError);
  });

  it('aborts the request when the signal fires, and rejects as aborted', async () => {
    const controller = new AbortController();
    const promise = xhrTransport.post('u', new FormData(), {}, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
    expect(latest().abortCalls).toBe(1);
  });

  it('does not send anything if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const promise = xhrTransport.post('u', new FormData(), {}, { signal: controller.signal });
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it('stops listening to the signal once the request has finished', async () => {
    const controller = new AbortController();
    const promise = xhrTransport.post('u', new FormData(), {}, { signal: controller.signal });
    latest().respond(200, 'done');
    await promise;
    controller.abort();
    expect(latest().abortCalls).toBe(0);
  });

  it('GETs without a body or upload listeners', async () => {
    const promise = xhrTransport.get('https://api.example/user', { 'xi-api-key': 'k' });
    const xhr = latest();
    expect([xhr.method, xhr.body, xhr.upload.onprogress]).toEqual(['GET', null, null]);
    xhr.respond(401, '{}');
    await expect(promise).resolves.toEqual({ status: 401, bodyText: '{}' });
  });
});
