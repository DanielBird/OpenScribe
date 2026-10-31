import type { Turn } from '../../domain/transcript';

/** Turns translated in one request, plus the turns just before them as read-only context. */
export interface Batch {
  index: number;
  turns: Turn[];
  context: Turn[];
}

export interface BatchOptions {
  /** Text characters per batch. A longer single turn gets a batch of its own. */
  maxChars?: number;
  maxTurns?: number;
  /** How many earlier turns go along for understanding (not translated). */
  contextTurns?: number;
}

/** Groups turns, in order, into batches of at most `maxTurns` turns and about `maxChars` characters. */
export function makeBatches(
  turns: readonly Turn[],
  { maxChars = 6000, maxTurns = 60, contextTurns = 3 }: BatchOptions = {},
): Batch[] {
  const groups: { start: number; turns: Turn[] }[] = [];
  let current: { start: number; turns: Turn[]; chars: number } | null = null;

  turns.forEach((turn, i) => {
    const chars = turn.text.length;
    const fits =
      current !== null && current.turns.length < maxTurns && current.chars + chars <= maxChars;
    if (fits && current) {
      current.turns.push(turn);
      current.chars += chars;
    } else {
      current = { start: i, turns: [turn], chars };
      groups.push(current);
    }
  });

  return groups.map((g, index) => ({
    index,
    turns: g.turns,
    context: turns.slice(Math.max(0, g.start - contextTurns), g.start),
  }));
}
