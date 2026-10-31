import type { Turn } from './transcript';

/**
 * The index of the turn playing at `t` seconds: the last turn that starts at or before `t`. A turn stays
 * active through any gap until the next one starts. `-1` before the first turn, for an empty list, or when
 * `t` isn't a number. `turns` must be in chronological order (as in every TranscriptDoc).
 */
export function findActiveTurnIndex(turns: readonly Pick<Turn, 'start'>[], t: number): number {
  if (Number.isNaN(t)) return -1;
  let lo = 0;
  let hi = turns.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (turns[mid]!.start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
