// The quote check (PROJECTS.md §5.5, DECISIONS.md T13, D44): is a quote really in a turn? Words are compared as for
// search, so case, accents and punctuation may differ, but every word must be there, in order. An omission is
// marked with an ellipsis, and it mustn't be able to change what was said: each part around it has at least
// `MIN_PART_WORDS` words, and the words it leaves out include no negation. A verified quote shows the transcript's
// own words, never the model's.
import { wordsWithOffsets, type MatchWord } from './normalize';

export type QuoteCheck =
  | { status: 'verified'; sourceText: string }
  | { status: 'not_found' }
  /** The words are in the turn, but what is left out between them could change what was said (D44). */
  | { status: 'unsafe_omission' };

const NOT_FOUND: QuoteCheck = { status: 'not_found' };
const UNSAFE_OMISSION: QuoteCheck = { status: 'unsafe_omission' };

/** Words in each part of a quote with an omission, so that single words can't be stitched together. */
export const MIN_PART_WORDS = 3;
/**
 * Negations, as normalised words, that an omission may not leave out. The check only ever runs on a turn's English
 * text, so the list is English. The "t" of "n't" is a word of its own once words split at apostrophes, and
 * `isNegation` finds it.
 */
const NEGATIONS = new Set([
  'not',
  'no',
  'never',
  'nor',
  'neither',
  'none',
  'nobody',
  'nothing',
  'nowhere',
  'cannot',
]);
/** What stands between "don" and "t" in "don't". */
const APOSTROPHE = /^['’ʼ]$/;

const ELLIPSIS = String.raw`\[\s*(?:…|\.{3,})\s*\]|\(\s*(?:…|\.{3,})\s*\)|…|\.{3,}`;
/** Quotation marks, whitespace and ellipses around a quote. An ellipsis there only says it starts or ends mid-sentence. */
const EDGES = new RegExp(
  String.raw`^(?:[\s"'“”„‟«»‘’‚‛‹›]|${ELLIPSIS})+|(?:[\s"'“”„‟«»‘’‚‛‹›]|${ELLIPSIS})+$`,
  'g',
);
const OMISSION = new RegExp(ELLIPSIS);
/** Punctuation that ends a sentence, kept after a quoted run so "…at night?" keeps its question mark. */
const SENTENCE_END = /^[.?!…]+/;

/** The index of the first run of `target` words in `words`, starting at `from`, or -1. */
function findRun(words: readonly MatchWord[], target: readonly string[], from: number): number {
  for (let i = from; i + target.length <= words.length; i++) {
    if (target.every((word, k) => words[i + k]?.word === word)) return i;
  }
  return -1;
}

/** Whether `words[i]` is a negation: one of `NEGATIONS`, or the "t" of "n't". */
function isNegation(words: readonly MatchWord[], i: number, text: string): boolean {
  const word = words[i];
  if (!word) return false;
  if (NEGATIONS.has(word.word)) return true;
  const before = words[i - 1];
  return (
    word.word === 't' &&
    before !== undefined &&
    before.word.endsWith('n') &&
    APOSTROPHE.test(text.slice(before.end, word.start))
  );
}

/**
 * Checks that `quote` appears in `turnText`. Each part between omission marks (`…`, `...`, `[…]`) must match a
 * run of consecutive words in the turn, in order. `sourceText` is the turn's own text for each run, joined with
 * ` … `.
 *
 * A quote with an omission is `unsafe_omission` when a part has fewer than `MIN_PART_WORDS` words, or when the
 * words left out include a negation. Each part matches its first run after the one before it, so a part that occurs
 * twice can leave a negation out when a later run of it wouldn't. That quote is then rejected, never wrongly
 * verified.
 */
export function checkQuote(turnText: string, quote: string): QuoteCheck {
  const parts = quote
    .replace(EDGES, '')
    .split(OMISSION)
    .map((part) => wordsWithOffsets(part).map((w) => w.word));
  if (parts.some((words) => words.length === 0)) return NOT_FOUND;

  const turnWords = wordsWithOffsets(turnText);
  const runs: string[] = [];
  let unsafe = parts.length > 1 && parts.some((words) => words.length < MIN_PART_WORDS);
  let from = 0;
  for (const words of parts) {
    const at = findRun(turnWords, words, from);
    const first = turnWords[at];
    const last = turnWords[at + words.length - 1];
    if (at < 0 || !first || !last) return NOT_FOUND;
    // The words this omission leaves out. Words before the first part aren't an omission.
    for (let i = from; runs.length > 0 && i < at && !unsafe; i++) {
      unsafe = isNegation(turnWords, i, turnText);
    }
    const end = last.end + (SENTENCE_END.exec(turnText.slice(last.end))?.[0].length ?? 0);
    runs.push(turnText.slice(first.start, end));
    from = at + words.length;
  }
  return unsafe ? UNSAFE_OMISSION : { status: 'verified', sourceText: runs.join(' … ') };
}
