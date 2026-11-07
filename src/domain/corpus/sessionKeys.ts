// Short session keys for the agent's prompts and quote refs (PROJECTS.md §5.5): `s1…sN`, as turns are `t1…tN`
// (DECISIONS.md T5). A quote ref is `s12/t412`.
import type { SessionText } from './sessionText';

const KEY = /^s([1-9]\d*)$/;

/**
 * `sessionId → 's1'…'sN'`, in a stable order: oldest recording first, then by session id. With `fixed` (a saved
 * chat's keys, D29), those sessions keep their keys, and the others are numbered after the highest fixed key, so a
 * key in an old answer never comes to mean another session. Sessions that are gone leave gaps.
 */
export function assignSessionKeys(
  sessions: readonly SessionText[],
  fixed: Readonly<Record<string, string>> = {},
): Map<string, string> {
  const ordered = [...sessions].sort(
    (a, b) =>
      a.recordedAt - b.recordedAt ||
      (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
  );
  const keys = new Map<string, string>();
  const taken = new Set<string>();
  let highest = 0;
  for (const key of Object.values(fixed)) {
    const n = Number(KEY.exec(key)?.[1] ?? 0);
    highest = Math.max(highest, n);
  }
  for (const session of ordered) {
    const key = fixed[session.sessionId];
    if (key === undefined || !KEY.test(key) || taken.has(key)) continue;
    keys.set(session.sessionId, key);
    taken.add(key);
  }
  for (const session of ordered) {
    if (!keys.has(session.sessionId)) keys.set(session.sessionId, `s${++highest}`);
  }
  // In key order, as without `fixed`.
  return new Map([...keys].sort(([, a], [, b]) => Number(a.slice(1)) - Number(b.slice(1))));
}

const REF = /^(s\d+)\/(t\d+)$/;

/** `'s12/t412'` → `{ sessionKey: 's12', turnId: 't412' }`, or `null` if it isn't a ref. */
export function parseRef(ref: string): { sessionKey: string; turnId: string } | null {
  const match = REF.exec(ref.trim());
  if (!match?.[1] || !match[2]) return null;
  return { sessionKey: match[1], turnId: match[2] };
}
