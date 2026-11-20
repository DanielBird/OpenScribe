// Find and replace names (Phase 38, DECISIONS.md D59). Matching uses the search's words (T12, T19): case, accents
// and punctuation are ignored, and a match is a run of whole words equal to Find's words. Between those words the
// text must have what Find has, once normalised: whitespace (or nothing, in scripts without spaces) where Find has a
// space, so "Anna Schmidt" doesn't match "Anna, Schmidt", and an apostrophe or hyphen where Find has one.
import { matchString, normalizeForMatch, wordsWithOffsets } from './corpus/normalize';
import type { Word } from './transcript';

/** A match of Find in one turn's text: offsets in that text. */
export interface TextMatch {
  turnId: string;
  start: number;
  end: number;
}

/** How many words a snippet shows on each side of its match. */
export const SNIPPET_WORDS = 8;

const ASCII = /^\p{ASCII}*$/u;

/** Find, ready to match: its normalised words, the normalised text between them, and the prefilter key. */
interface Pattern {
  words: string[];
  gaps: string[];
  key: string;
}

function compile(find: string): Pattern | null {
  const found = wordsWithOffsets(find);
  if (found.length === 0) return null;
  const gaps: string[] = [];
  for (let k = 0; k + 1 < found.length; k++) {
    gaps.push(normalizeForMatch(find.slice(found[k]!.end, found[k + 1]!.start)));
  }
  const words = found.map((w) => w.word);
  return { words, gaps, key: ` ${words.join(' ')} ` };
}

/** The ranges of `pattern` in `text`, in order and never overlapping. */
function matchRanges(text: string, pattern: Pattern): { start: number; end: number }[] {
  // matchString is cheap for ASCII text, and most turns have no match.
  if (ASCII.test(text) && !matchString(text).includes(pattern.key)) return [];
  const words = wordsWithOffsets(text);
  const n = pattern.words.length;
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i + n <= words.length;) {
    if (matchesAt(text, words, i, pattern)) {
      ranges.push({ start: words[i]!.start, end: words[i + n - 1]!.end });
      i += n;
    } else {
      i++;
    }
  }
  return ranges;
}

function matchesAt(
  text: string,
  words: readonly { word: string; start: number; end: number }[],
  i: number,
  pattern: Pattern,
): boolean {
  for (let k = 0; k < pattern.words.length; k++) {
    if (words[i + k]!.word !== pattern.words[k]) return false;
    if (k > 0) {
      // A reversed range (the pieces of one word NFKD splits) slices to ''.
      const gap = text.slice(words[i + k - 1]!.end, words[i + k]!.start);
      if (normalizeForMatch(gap) !== pattern.gaps[k - 1]) return false;
    }
  }
  return true;
}

/** The matches of `find` in `texts`, in their order. None for a `find` without letters or digits. */
export function findMatches(
  texts: readonly { turnId: string; text: string }[],
  find: string,
): TextMatch[] {
  const pattern = compile(find);
  if (!pattern) return [];
  const matches: TextMatch[] = [];
  for (const { turnId, text } of texts) {
    for (const { start, end } of matchRanges(text, pattern)) matches.push({ turnId, start, end });
  }
  return matches;
}

/** `text` with each of `matches` (all in this text) replaced by `replacement`. */
export function replaceInText(
  text: string,
  matches: readonly TextMatch[],
  replacement: string,
): string {
  let out = text;
  for (const { start, end } of [...matches].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, start) + replacement + out.slice(end);
  }
  return out;
}

/**
 * The words with `find` replaced (Phase 38, decision 7). A match may start and end inside a word ("Anna's"): the
 * first word of the run becomes the text before the match, the replacement and the text after it, with the first
 * word's start, the last word's end and no logprob; the run's other words go. `which` is every occurrence, or the
 * one at `index` when the words have as many occurrences as the turn's text (`of`), otherwise every one.
 * Returns `words` itself when nothing changes.
 */
export function replaceInWords(
  words: readonly Word[],
  find: string,
  replacement: string,
  which: 'all' | { index: number; of: number },
): Word[] {
  const pattern = compile(find);
  if (!pattern || words.length === 0) return words as Word[];

  // The words joined by single spaces, with where each one starts.
  const from: number[] = [];
  let joined = '';
  for (const [i, word] of words.entries()) {
    if (i > 0) joined += ' ';
    from.push(joined.length);
    joined += word.text;
  }

  const ranges = matchRanges(joined, pattern);
  if (ranges.length === 0) return words as Word[];
  const one = which !== 'all' && ranges.length === which.of ? ranges[which.index] : undefined;
  const chosen = one ? [one] : ranges;

  const out = words.slice();
  let changed = false;
  for (const { start, end } of [...chosen].reverse()) {
    const a = wordAt(from, start);
    const b = wordAt(from, end - 1);
    const first = words[a]!;
    const last = words[b]!;
    const text =
      first.text.slice(0, start - from[a]!) + replacement + last.text.slice(end - from[b]!);
    if (a === b && text === first.text) continue; // "Anna" for "Anna"
    out.splice(a, b - a + 1, { ...first, text, end: last.end, logprob: null });
    changed = true;
  }
  return changed ? out : (words as Word[]);
}

/** The index of the word that `offset` (in the joined words) falls in. */
function wordAt(from: readonly number[], offset: number): number {
  let i = 0;
  while (i + 1 < from.length && from[i + 1]! <= offset) i++;
  return i;
}

/**
 * The match with about eight words either side, for the dialog's list to mark without `v-html`. `…` shows where
 * the text is cut.
 */
export function snippet(
  text: string,
  match: TextMatch,
): { before: string; match: string; after: string } {
  const words: { start: number; end: number }[] = [];
  for (const w of wordsWithOffsets(text)) {
    if (words.at(-1)?.start !== w.start) words.push(w);
  }
  let first = words.findIndex((w) => w.end > match.start);
  if (first === -1) first = words.length;
  let last = first - 1;
  while (last + 1 < words.length && words[last + 1]!.start < match.end) last++;

  const cutBefore = first - SNIPPET_WORDS > 0 ? words[first - SNIPPET_WORDS]!.start : 0;
  const cutAfter =
    last + SNIPPET_WORDS < words.length - 1 ? words[last + SNIPPET_WORDS]!.end : text.length;
  return {
    before: (cutBefore > 0 ? '…' : '') + text.slice(cutBefore, match.start),
    match: text.slice(match.start, match.end),
    after: text.slice(match.end, cutAfter) + (cutAfter < text.length ? '…' : ''),
  };
}

/**
 * The matches still to go after `replaced` was replaced by `replacement`: without it, and with the later matches
 * in its turn moved, so they still point at their text (Phase 38, decision 3).
 */
export function shiftMatches(
  remaining: readonly TextMatch[],
  replaced: TextMatch,
  replacement: string,
): TextMatch[] {
  const delta = replacement.length - (replaced.end - replaced.start);
  const out: TextMatch[] = [];
  for (const m of remaining) {
    if (m.turnId !== replaced.turnId) {
      out.push(m);
    } else if (m.start === replaced.start && m.end === replaced.end) {
      continue;
    } else if (m.start >= replaced.end) {
      out.push({ ...m, start: m.start + delta, end: m.end + delta });
    } else {
      out.push(m);
    }
  }
  return out;
}
