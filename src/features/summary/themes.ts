// The project's theme names, so each new summary can reuse them (PROJECTS.md §5.3, A3).
import type { SessionSummary } from '../../domain/summary';

export interface ThemeCount {
  name: string;
  count: number; // the number of summaries that use it
}

/** Names that differ only in case or spacing are one theme. */
export const themeKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Every theme name in the summaries, with the number of summaries that use it, most used first and then by name.
 * Names that differ only in case or spacing are merged under their most common spelling (the first seen on a tie).
 */
export function themeVocabulary(summaries: readonly SessionSummary[]): ThemeCount[] {
  const themes = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const summary of summaries) {
    const seen = new Set<string>();
    for (const theme of summary.themes) {
      const spelling = theme.name.replace(/\s+/g, ' ').trim();
      const key = themeKey(spelling);
      if (!key) continue;
      let entry = themes.get(key);
      if (!entry) themes.set(key, (entry = { count: 0, spellings: new Map() }));
      entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + 1);
      if (!seen.has(key)) {
        seen.add(key);
        entry.count++;
      }
    }
  }

  return [...themes.values()]
    .map(({ count, spellings }) => {
      let name = '';
      let best = 0;
      for (const [spelling, uses] of spellings) {
        if (uses > best) [name, best] = [spelling, uses];
      }
      return { name, count };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en'));
}
