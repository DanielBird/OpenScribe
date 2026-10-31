// Test only: turns a Gemini `generateContent` response into the server-sent events of
// `streamGenerateContent?alt=sse`, as the SDK reads them: each event is `data: <chunk JSON>`, and events are separated
// by a blank line (the SDK accepts `\n\n`, `\r\r` and `\r\n\r\n`; Google sends `\r\n\r\n`). Used by the unit tests'
// fake `fetch` and by the e2e `mockGemini`, so it imports nothing.

export interface GeminiSseOptions {
  /**
   * End with an error after the content, as a stream that fails part-way does. The SDK treats a network read that is
   * exactly a `{ "error": … }` JSON object as an error, so it must arrive as a read of its own: send
   * `geminiSseEvents` one read per event (a single-string body would hide it).
   */
  error?: { code: number; status: string; message: string; details?: readonly unknown[] };
}

type Json = Record<string, unknown>;

/** Characters per text chunk, so the SDK yields several chunks to join. */
const TEXT_CHUNK = 40;

const event = (data: Json) => `data: ${JSON.stringify(data)}\r\n\r\n`;

/** The text in pieces of at most `TEXT_CHUNK` characters, never splitting a character. */
function pieces(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += TEXT_CHUNK) {
    out.push(chars.slice(i, i + TEXT_CHUNK).join(''));
  }
  return out.length > 0 ? out : [''];
}

function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`geminiSse: ${what} must be an object`);
  }
  return value as Json;
}

/** The SSE body of a streamed reply that ends as `response` does (see `geminiSseEvents`). */
export function geminiSse(response: unknown, opts: GeminiSseOptions = {}): string {
  return geminiSseEvents(response, opts).join('');
}

/**
 * The events of a streamed reply that ends as `response` does: the same parts (text split into several chunks,
 * thought and function-call parts kept as their own chunks, thought signatures where they were), then the finish
 * reason, prompt feedback and usage on a last chunk with an empty text part.
 */
export function geminiSseEvents(response: unknown, opts: GeminiSseOptions = {}): string[] {
  const res = asObject(response, 'the response');
  const candidate = Array.isArray(res.candidates)
    ? asObject(res.candidates[0] ?? {}, 'a candidate')
    : undefined;
  const content = candidate ? asObject(candidate.content ?? {}, 'content') : undefined;
  const parts = Array.isArray(content?.parts)
    ? content.parts.map((p) => asObject(p, 'a part'))
    : [];

  const events: string[] = [];
  const chunk = (part: Json) =>
    event({ candidates: [{ content: { role: 'model', parts: [part] }, index: 0 }] });
  for (const part of parts) {
    if (typeof part.text === 'string' && !part.thought) {
      // A thought signature on a text part comes once, with its last piece.
      const { thoughtSignature, ...rest } = part;
      const texts = pieces(part.text);
      texts.forEach((text, i) =>
        events.push(
          chunk({
            ...rest,
            text,
            ...(i === texts.length - 1 && thoughtSignature !== undefined
              ? { thoughtSignature }
              : {}),
          }),
        ),
      );
    } else {
      events.push(chunk(part));
    }
  }

  if (opts.error) {
    events.push(JSON.stringify({ error: opts.error }));
    return events;
  }

  const { candidates: _candidates, ...rest } = res;
  const last: Json = { ...rest };
  if (candidate) {
    const { content: _content, ...end } = candidate;
    last.candidates = [{ content: { role: 'model', parts: [{ text: '' }] }, index: 0, ...end }];
  }
  events.push(event(last));
  return events;
}
