// Test only: a scripted fake `fetch` for the project agent with Gemini (Phase 20), the twin of `agent.ts`. Request n
// gets reply n, and every request is kept for assertions. Replies are `generateContent` responses, streamed as
// server-sent events by `geminiSseEvents`, one network read per event (as Google sends them, so that an error inside
// the stream is seen).
import type { SeenRequest } from './agent';
import { geminiSseEvents, type GeminiSseOptions } from './geminiSse';

type Json = Record<string, unknown>;

export type GeminiScriptedReply =
  /** A streamed reply that ends as `response` does, or with `error` part-way. */
  | { response: Json; error?: GeminiSseOptions['error'] }
  /** An HTTP error, e.g. `{ status: 400, body: googleError(400, 'INVALID_ARGUMENT', '…') }`. */
  | { status: number; body: unknown }
  /** Anything else: a reply built from the request and its signal. */
  | ((request: SeenRequest, signal: AbortSignal | undefined) => Response | Promise<Response>);

/** A `text/event-stream` response that sends each event as its own read. */
export function geminiSseResponse(events: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export function scriptedGeminiFetch(replies: readonly GeminiScriptedReply[]) {
  const requests: SeenRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request: SeenRequest = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')) as Json,
    };
    requests.push(request);
    const reply = replies[requests.length - 1];
    if (reply === undefined)
      throw new Error(`scriptedGeminiFetch: no reply for request ${requests.length}`);
    if (typeof reply === 'function') return reply(request, init?.signal ?? undefined);
    if ('response' in reply) {
      return geminiSseResponse(geminiSseEvents(reply.response, { error: reply.error }));
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, requests };
}

/**
 * A reply that sends its first event, then waits as a long reply does until the request is aborted. `onWaiting` runs
 * once the first event is out (e.g. to abort).
 */
export function heldGeminiReply(response: Json, onWaiting: () => void): GeminiScriptedReply {
  const [first = ''] = geminiSseEvents(response);
  return (_, signal) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(first));
          signal?.addEventListener('abort', () =>
            stream.error(new DOMException('aborted', 'AbortError')),
          );
          setTimeout(onWaiting, 0);
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
}

/** A Google API error body: `{ error: { code, message, status, details? } }`. */
export const googleError = (
  code: number,
  status: string,
  message: string,
  details?: readonly unknown[],
) => ({ error: { code, message, status, ...(details ? { details } : {}) } });

/** The usage of a reply, as `usageMetadata` reports it (`promptTokenCount` includes the cached tokens). */
export const geminiUsage = (
  prompt: number,
  candidates: number,
  cached = 0,
  thoughts = 0,
): Json => ({
  promptTokenCount: prompt,
  candidatesTokenCount: candidates,
  ...(cached ? { cachedContentTokenCount: cached } : {}),
  ...(thoughts ? { thoughtsTokenCount: thoughts } : {}),
  totalTokenCount: prompt + candidates + thoughts,
});

/** A model turn, as `generateContent` returns it. */
export function geminiTurn(
  parts: readonly Json[],
  opts: { finishReason?: string; usage?: Json; promptFeedback?: Json } = {},
): Json {
  return {
    candidates: [
      { content: { role: 'model', parts }, finishReason: opts.finishReason ?? 'STOP', index: 0 },
    ],
    usageMetadata: opts.usage ?? geminiUsage(100, 50),
    ...(opts.promptFeedback ? { promptFeedback: opts.promptFeedback } : {}),
    modelVersion: 'gemini-3.8-flash',
  };
}

export const textPart = (text: string, thoughtSignature?: string): Json => ({
  text,
  ...(thoughtSignature ? { thoughtSignature } : {}),
});

/** A thought summary part, as Gemini sends it when thoughts are included; Describe never asks for them. */
export const thoughtPart = (text: string, thoughtSignature?: string): Json => ({
  text,
  thought: true,
  ...(thoughtSignature ? { thoughtSignature } : {}),
});

/** A function call. In a step's parallel calls, only the first one carries a signature. */
export const functionCallPart = (
  name: string,
  args: Json,
  opts: { id?: string; signature?: string } = {},
): Json => ({
  functionCall: { name, args, ...(opts.id ? { id: opts.id } : {}) },
  ...(opts.signature ? { thoughtSignature: opts.signature } : {}),
});
