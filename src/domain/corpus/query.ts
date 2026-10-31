// The keyword query syntax (PROJECTS.md §5.4), shared by the researchers' search box and the agent's search tool:
//   charger night       both words, anywhere in the turn
//   "charger by the"    consecutive words
//   charg*              a word starting with "charg" (at least 2 letters before *)
//   night OR evening    either word; OR binds tighter than the spaces between terms
//   -phone, -"my phone" turns with this word or phrase are left out
// Terms are normalised like the text (normalize.ts), so `Hörgerät` matches "horgerat" but not "Hoergeraet". A
// term that is several words once normalised ("e-mail", "don't") is matched as a phrase.
import { wordsWithOffsets } from './normalize';

/** One term: its normalised words, matched as consecutive words. Internal to `domain/corpus`. */
export interface TermPattern {
  readonly words: readonly string[];
  /** The last word is a prefix. */
  readonly prefix: boolean;
  /** `' a b '`, or `' a b'` for a prefix: found with `includes` in a `matchString`. */
  readonly needle: string;
}

/** A parsed query. Its fields are internal to `domain/corpus`: elsewhere, pass it to `search()` as it is. */
export interface Query {
  readonly kind: 'query';
  /** Every clause must match a turn. A clause matches when any of its alternatives does. */
  readonly clauses: readonly (readonly TermPattern[])[];
  /** A turn that matches any of these is left out. */
  readonly exclusions: readonly TermPattern[];
}

export interface QueryError {
  kind: 'error';
  message: string;
}

export const QUERY_MESSAGES = {
  empty: 'Type a word to search for.',
  onlyExclusions: 'Add a word to find, not only words to leave out.',
  shortPrefix: 'Put at least 2 letters before *.',
  unclosedQuote: 'Close the quotation marks.',
  orOperands: 'Put a word on both sides of OR.',
} as const;

const PREFIX_MIN_LENGTH = 2;
const TYPOGRAPHIC_DOUBLE_QUOTES = /[“”„‟«»]/g;
const WHITESPACE = /\s/;

type Token = { kind: 'or' } | { kind: 'term'; text: string; quoted: boolean; negated: boolean };

function error(message: string): QueryError {
  return { kind: 'error', message };
}

function tokenize(input: string): Token[] | QueryError {
  const s = input.replace(TYPOGRAPHIC_DOUBLE_QUOTES, '"');
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    if (WHITESPACE.test(s.charAt(i))) {
      i++;
      continue;
    }
    let negated = false;
    if (s.charAt(i) === '-' && i + 1 < s.length && !WHITESPACE.test(s.charAt(i + 1))) {
      negated = true;
      i++;
    }
    if (s.charAt(i) === '"') {
      const close = s.indexOf('"', i + 1);
      if (close < 0) return error(QUERY_MESSAGES.unclosedQuote);
      tokens.push({ kind: 'term', text: s.slice(i + 1, close), quoted: true, negated });
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < s.length && !WHITESPACE.test(s.charAt(end)) && s.charAt(end) !== '"') end++;
    const text = s.slice(i, end);
    tokens.push(
      !negated && text === 'OR' ? { kind: 'or' } : { kind: 'term', text, quoted: false, negated },
    );
    i = end;
  }
  return tokens;
}

/** The pattern for a term, `null` for a term with no words (it's ignored), or an error. */
function toPattern(token: { text: string; quoted: boolean }): TermPattern | QueryError | null {
  let text = token.text;
  const prefix = !token.quoted && text.endsWith('*');
  if (prefix) text = text.replace(/\*+$/, '');
  const words = wordsWithOffsets(text).map((w) => w.word);
  const last = words[words.length - 1];
  if (last === undefined) return prefix ? error(QUERY_MESSAGES.shortPrefix) : null;
  if (prefix && last.length < PREFIX_MIN_LENGTH) return error(QUERY_MESSAGES.shortPrefix);
  return { words, prefix, needle: ` ${words.join(' ')}${prefix ? '' : ' '}` };
}

/** Parses a keyword query. An error's message is short and says what to change. */
export function parseQuery(input: string): Query | QueryError {
  const tokens = tokenize(input);
  if (!Array.isArray(tokens)) return tokens;

  const clauses: TermPattern[][] = [];
  const exclusions: TermPattern[] = [];
  let lastClause: TermPattern[] | null = null; // the clause an OR right now would extend
  let afterOr = false;

  for (const token of tokens) {
    if (token.kind === 'or') {
      if (lastClause === null || afterOr) return error(QUERY_MESSAGES.orOperands);
      afterOr = true;
      continue;
    }
    const pattern = toPattern(token);
    if (pattern === null) continue;
    if ('kind' in pattern) return pattern;
    if (token.negated) {
      if (afterOr) return error(QUERY_MESSAGES.orOperands);
      exclusions.push(pattern);
      lastClause = null;
    } else if (afterOr && lastClause !== null) {
      lastClause.push(pattern);
      afterOr = false;
    } else {
      lastClause = [pattern];
      clauses.push(lastClause);
    }
  }

  if (afterOr) return error(QUERY_MESSAGES.orOperands);
  if (clauses.length === 0) {
    return error(exclusions.length > 0 ? QUERY_MESSAGES.onlyExclusions : QUERY_MESSAGES.empty);
  }
  return { kind: 'query', clauses, exclusions };
}
