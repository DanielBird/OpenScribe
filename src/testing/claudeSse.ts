// Test only: turns a Claude Messages API response into the server-sent events of a streamed reply, as the SDK's
// stream reads them. Used by the unit tests' fake `fetch` and by the e2e `mockAnthropic`, so it imports nothing.
// Supports text, thinking, tool_use and fallback blocks.

export interface ClaudeSseOptions {
  /** End with an `error` event after the content, as a stream that fails part-way does (e.g. `overloaded_error`). */
  error?: { type: string; message: string };
}

type Json = Record<string, unknown>;

/** Characters per `text_delta`, so the SDK has to join several deltas. */
const TEXT_CHUNK = 40;

const event = (name: string, data: Json) =>
  `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`;

function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`claudeSse: ${what} must be an object`);
  }
  return value as Json;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The text in pieces of at most `TEXT_CHUNK` characters, never splitting a character. */
function chunks(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += TEXT_CHUNK)
    out.push(chars.slice(i, i + TEXT_CHUNK).join(''));
  return out;
}

/** The events for one content block: start, deltas, stop. */
function blockEvents(block: Json, index: number): string[] {
  const events: string[] = [];
  switch (block.type) {
    case 'text':
      events.push(
        event('content_block_start', { index, content_block: { type: 'text', text: '' } }),
      );
      for (const text of chunks(asString(block.text))) {
        events.push(event('content_block_delta', { index, delta: { type: 'text_delta', text } }));
      }
      break;
    case 'thinking': {
      const start = { type: 'thinking', thinking: '', signature: '' };
      events.push(event('content_block_start', { index, content_block: start }));
      const thinking = asString(block.thinking);
      if (thinking) {
        events.push(
          event('content_block_delta', { index, delta: { type: 'thinking_delta', thinking } }),
        );
      }
      const signature = asString(block.signature);
      if (signature) {
        events.push(
          event('content_block_delta', { index, delta: { type: 'signature_delta', signature } }),
        );
      }
      break;
    }
    case 'tool_use': {
      // The input arrives as JSON in pieces, as eager input streaming sends it.
      const start = {
        type: 'tool_use',
        id: asString(block.id),
        name: asString(block.name),
        input: {},
      };
      events.push(event('content_block_start', { index, content_block: start }));
      for (const partial_json of chunks(JSON.stringify(block.input ?? {}))) {
        events.push(
          event('content_block_delta', {
            index,
            delta: { type: 'input_json_delta', partial_json },
          }),
        );
      }
      break;
    }
    case 'fallback':
      // The API sends a fallback block whole, with no deltas.
      events.push(event('content_block_start', { index, content_block: block }));
      break;
    default:
      throw new Error(`claudeSse: unsupported content block type ${String(block.type)}`);
  }
  events.push(event('content_block_stop', { index }));
  return events;
}

/** The SSE body of a streamed reply that ends as `message` does: same content, stop reason and usage. */
export function claudeSse(message: unknown, opts: ClaudeSseOptions = {}): string {
  const msg = asObject(message, 'the message');
  const content = Array.isArray(msg.content) ? msg.content : [];
  const usage = asObject(msg.usage ?? {}, 'usage');

  const events = [
    event('message_start', {
      message: {
        ...msg,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: { ...usage, output_tokens: 0 },
      },
    }),
  ];
  content.forEach((block, index) => events.push(...blockEvents(asObject(block, 'a block'), index)));

  if (opts.error) {
    events.push(event('error', { error: opts.error }));
    return events.join('');
  }
  events.push(
    event('message_delta', {
      delta: {
        stop_reason: msg.stop_reason ?? 'end_turn',
        stop_sequence: msg.stop_sequence ?? null,
        stop_details: msg.stop_details ?? null,
      },
      usage,
    }),
    event('message_stop', {}),
  );
  return events.join('');
}
