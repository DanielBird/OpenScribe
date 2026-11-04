// Small text helpers for the UI and for text sent to a model.

/** `1 hit`, `3 hits`; `many` for an irregular plural (`2 summaries`). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Text on one line: every run of whitespace becomes one space, and the ends are trimmed. Model-facing lines and a
 * copied citation must not be broken by a newline in a title or a turn. (`joinLines` in `transcript.ts` joins only
 * runs with a line break, and trims nothing.)
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
