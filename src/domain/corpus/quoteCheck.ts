// The quote check (PROJECTS.md §5.5, DECISIONS.md T13): is a quote really in a turn? Words are compared as for
// search, so case, accents and punctuation may differ, but every word must be there, in order. An omission is
// marked with an ellipsis. A verified quote shows the transcript's own words, never the model's.
import { wordsWithOffsets, type MatchWord } from './normalize';

export type QuoteCheck = { status: 'verified'; sourceText: string } | { status: 'not_found' };

const NOT_FOUND: QuoteCheck = { status: 'not_found' };

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

/**
 * Checks that `quote` appears in `turnText`. Each part between omission marks (`…`, `...`, `[…]`) must match a
 * run of consecutive words in the turn, in order. `sourceText` is the turn's own text for each run, joined with
 * ` … `.
 */
export function checkQuote(turnText: string, quote: string): QuoteCheck {
  const parts = quote
    .replace(EDGES, '')
    .split(OMISSION)
    .map((part) => wordsWithOffsets(part).map((w) => w.word));
  if (parts.some((words) => words.length === 0)) return NOT_FOUND;

  const turnWords = wordsWithOffsets(turnText);
  const runs: string[] = [];
  let from = 0;
  for (const words of parts) {
    const at = findRun(turnWords, words, from);
    const first = turnWords[at];
    const last = turnWords[at + words.length - 1];
    if (at < 0 || !first || !last) return NOT_FOUND;
    const end = last.end + (SENTENCE_END.exec(turnText.slice(last.end))?.[0].length ?? 0);
    runs.push(turnText.slice(first.start, end));
    from = at + words.length;
  }
  return { status: 'verified', sourceText: runs.join(' … ') };
}
