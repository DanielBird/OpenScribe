// Test only: a scripted fake `fetch` for the project agent. Request n gets reply n, and every request is kept for
// assertions. Replies are Messages API responses, streamed as server-sent events by `claudeSse`.
import type { AgentEvent } from '../providers/llm/types';
import { claudeSse, type ClaudeSseOptions } from './claudeSse';

export interface SeenRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

type Json = Record<string, unknown>;

export type ScriptedReply =
  /** A streamed reply that ends as `message` does, or with `error` part-way. */
  | { message: Json; error?: ClaudeSseOptions['error'] }
  /** An HTTP error, e.g. `{ status: 401, body: apiError('authentication_error', '…') }`. */
  | { status: number; body: unknown }
  /** Anything else: a reply built from the request and its signal. */
  | ((request: SeenRequest, signal: AbortSignal | undefined) => Response | Promise<Response>);

const sseResponse = (body: BodyInit) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });

export function scriptedFetch(replies: readonly ScriptedReply[]) {
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
      throw new Error(`scriptedFetch: no reply for request ${requests.length}`);
    if (typeof reply === 'function') return reply(request, init?.signal ?? undefined);
    if ('message' in reply) return sseResponse(claudeSse(reply.message, { error: reply.error }));
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, requests };
}

/**
 * A reply that sends its first events, then waits as a long reply does until the request is aborted. `onWaiting`
 * runs once the first events are out (e.g. to abort).
 */
export function heldReply(message: Json, onWaiting: () => void): ScriptedReply {
  const firstEvents = claudeSse(message).split('event: content_block_delta')[0] ?? '';
  return (_, signal) =>
    sseResponse(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(firstEvents));
          signal?.addEventListener('abort', () =>
            stream.error(new DOMException('aborted', 'AbortError')),
          );
          setTimeout(onWaiting, 0);
        },
      }),
    );
}

export const apiError = (type: string, message: string) => ({
  type: 'error',
  error: { type, message },
});

let messageCount = 0;

/** An assistant message, as the API returns it. */
export function agentMessage(
  content: readonly Json[],
  opts: { stop_reason?: string; stop_details?: Json; usage?: Json; model?: string } = {},
): Json {
  const toolUse = content.some((block) => block.type === 'tool_use');
  return {
    id: `msg_${++messageCount}`,
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-sonnet-5-5',
    content,
    stop_reason: opts.stop_reason ?? (toolUse ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    stop_details: opts.stop_details ?? null,
    usage: opts.usage ?? {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

export const textBlock = (text: string): Json => ({ type: 'text', text });

/** A thinking block as Sonnet 5.5 and Opus 5.5 send it by default: no text, only a signature. */
export const thinkingBlock = (signature: string): Json => ({
  type: 'thinking',
  thinking: '',
  signature,
});

export const toolUseBlock = (id: string, name: string, input: Json): Json => ({
  type: 'tool_use',
  id,
  name,
  input,
});

/** A tool call whose input JSON the SDK's stream can't parse, so the agent sends the request again. */
export const brokenToolUseBlock = (id: string, name: string): Json => ({
  type: 'tool_use',
  id,
  name,
  input: '{"query": charg*}',
});

/** The text as the chat shows it: the streamed deltas, less what each `retry` takes back. */
export function streamedText(events: readonly AgentEvent[]): string {
  let text = '';
  for (const event of events) {
    if (event.type === 'text') text += event.delta;
    else if (event.type === 'retry') text = text.slice(0, Math.max(0, text.length - event.discard));
  }
  return text;
}

export const fallbackBlock = (from: string, to: string): Json => ({
  type: 'fallback',
  from: { model: from },
  to: { model: to },
});
