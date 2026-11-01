// Normalisation shared by keyword search and the quote check (PROJECTS.md §5.4–5.5, DECISIONS.md T12, T19).
// Matching works on words: case, accents and punctuation are ignored. A word is a run of letters and digits, so
// apostrophes and hyphens separate words ("doctor's" is "doctor s", "l'appareil" is "l appareil"). Scripts written
// without spaces (Chinese, Japanese, Thai, …) are split into words by `Intl.Segmenter` instead.

const ASCII = /^\p{ASCII}*$/u;
const ASCII_WORD = /^[A-Za-z0-9]+$/;
/**
 * The marks that are accents: the combining marks shared by every script (Latin, Greek and Cyrillic accents,
 * Arabic vowel points, Japanese voicing marks) and Hebrew points. A script's own vowel signs spell its words
 * (Thai, Hindi, Kannada, …), so they stay.
 */
const ACCENTS = /(?=\p{M})\p{Script=Inherited}|[֑-ׇֽֿׁׂׅׄ]/gu;
const SINGLE_QUOTES = /[‘’‚‛ʼ′]/g;
const DOUBLE_QUOTES = /[“”„‟″«»]/g;
const DASHES = /[‐‑‒–—―−]/g;
/** What NFKD can leave inside a word that isn't part of it, e.g. the fraction slash in "½" → "1⁄2". */
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/u;
/** Scripts that don't put spaces between words. A run of letters with one of them in it is segmented. */
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const WORD_SEGMENTER = new Intl.Segmenter('und', { granularity: 'word' });

/**
 * Text as compared for matching: NFKD with the accents removed (so "ö" is "o", not "oe"), lower case, `ß` → `ss`,
 * typographic quotes and dashes made plain, and whitespace collapsed.
 */
export function normalizeForMatch(text: string): string {
  const out = ASCII.test(text)
    ? text.toLowerCase()
    : text
        .normalize('NFKD')
        .replace(ACCENTS, '')
        .toLowerCase()
        .replace(/ß/g, 'ss')
        .replace(SINGLE_QUOTES, "'")
        .replace(DOUBLE_QUOTES, '"')
        .replace(DASHES, '-');
  return out.replace(/\s+/g, ' ').trim();
}

/** A normalised word, with the offsets of the word it came from in the original text. */
export interface MatchWord {
  word: string;
  start: number;
  end: number;
}

/**
 * Calls `visit` for each normalised word of `text`, with its offsets in `text`. Every matcher goes through this
 * one walker, so search, snippets and the quote check always agree on what the words are.
 */
function forEachWord(
  text: string,
  visit: (word: string, start: number, end: number) => void,
): void {
  // Marks are part of a word, so text that is already decomposed ("o" + U+0308) stays one word.
  const pattern = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    if (ASCII_WORD.test(raw)) {
      visit(raw.toLowerCase(), start, end);
      continue;
    }
    if (UNSPACED_SCRIPT.test(raw)) {
      // "私は毎晩充電します" is one run of letters, and several words.
      for (const { segment, index, isWordLike } of WORD_SEGMENTER.segment(raw)) {
        if (isWordLike) visitPieces(segment, start + index, start + index + segment.length, visit);
      }
      continue;
    }
    visitPieces(raw, start, end, visit);
  }
}

/** Visits a word once normalised. Rarely, NFKD splits it ("½" → "1", "2"); each piece keeps its offsets. */
function visitPieces(
  raw: string,
  start: number,
  end: number,
  visit: (word: string, start: number, end: number) => void,
): void {
  for (const piece of normalizeForMatch(raw).split(NON_WORD)) {
    if (piece) visit(piece, start, end);
  }
}

/** The normalised words of `text`, each with the start and end offset of its word in `text`. */
export function wordsWithOffsets(text: string): MatchWord[] {
  const words: MatchWord[] = [];
  forEachWord(text, (word, start, end) => words.push({ word, start, end }));
  return words;
}

/**
 * The normalised words of `text` joined by single spaces, with a space at each end: `' w1 w2 … wn '`. Words
 * never contain spaces, so `matchString(t).includes(' a b ')` is true exactly when the words `a b` follow each
 * other in `t`, and `includes(' ab')` when a word starts with `ab`.
 */
export function matchString(text: string): string {
  if (ASCII.test(text)) {
    // The same words forEachWord finds in ASCII text, without the per-word work.
    const words = text.toLowerCase().match(/[a-z0-9]+/g);
    return words ? ` ${words.join(' ')} ` : ' ';
  }
  const words: string[] = [];
  forEachWord(text, (word) => words.push(word));
  return words.length > 0 ? ` ${words.join(' ')} ` : ' ';
}
