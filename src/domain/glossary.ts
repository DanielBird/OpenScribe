// Glossary terms: parsing pasted text, removing duplicates and checking terms against a provider's
// keyterm limits (DECISIONS.md D6). One invalid term makes ElevenLabs reject the whole request (live
// check V1), so only the `valid` terms of `validateList` may be sent.

export interface KeytermLimits {
  maxTerms: number;
  maxChars: number;
  maxWords: number;
  forbiddenChars: string;
}

export type TermIssue = 'too_long' | 'too_many_words' | 'unsupported_chars';

/** Opening → closing quote pairs that are stripped from around a term. */
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['„', '“'], // German
  ['‘', '’'],
  ['«', '»'], // French
];

const SEPARATORS = /[\r\n,;\t]+/;

/**
 * Cleans up one term: trims, collapses internal whitespace to single spaces, strips one pair of
 * surrounding quotes and normalises to NFC. Returns '' if nothing is left.
 */
export function normalizeTerm(raw: string): string {
  let term = raw.replace(/\s+/g, ' ').trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (term.length >= 2 && term.startsWith(open) && term.endsWith(close)) {
      term = term.slice(open.length, -close.length).trim();
      break;
    }
  }
  return term.normalize('NFC');
}

/** The identity used to detect duplicates: case-insensitive, Unicode-normalised. */
export function termKey(term: string): string {
  return term.normalize('NFC').toLocaleLowerCase();
}

/** Splits pasted text on new lines, commas, semicolons and tabs into clean, non-empty terms. */
export function parseTerms(raw: string): string[] {
  return raw
    .split(SEPARATORS)
    .map(normalizeTerm)
    .filter((term) => term !== '');
}

/**
 * Appends `incoming` to `existing` without duplicates (compared with `termKey`). The first casing
 * seen is kept, and so is the order. `duplicates` counts incoming terms that were skipped.
 */
export function mergeTerms(
  existing: string[],
  incoming: string[],
): { terms: string[]; added: number; duplicates: number } {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of existing) {
    const key = termKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }

  let added = 0;
  let duplicates = 0;
  for (const term of incoming) {
    const key = termKey(term);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    terms.push(term);
    added++;
  }
  return { terms, added, duplicates };
}

/** Why the provider would reject `term`; empty when it is fine. */
export function validateTerm(term: string, limits: KeytermLimits): TermIssue[] {
  const issues: TermIssue[] = [];
  // Code points, not UTF-16 units, so characters outside the BMP count once.
  if ([...term].length > limits.maxChars) issues.push('too_long');
  const words = term.trim() === '' ? 0 : term.trim().split(/\s+/).length;
  if (words > limits.maxWords) issues.push('too_many_words');
  if ([...limits.forbiddenChars].some((c) => term.includes(c))) issues.push('unsupported_chars');
  return issues;
}

/**
 * Splits a list into the terms that can be sent, the invalid ones, and valid ones beyond
 * `maxTerms` (counted after the invalid ones are removed).
 */
export function validateList(
  terms: string[],
  limits: KeytermLimits,
): { valid: string[]; invalid: { term: string; issues: TermIssue[] }[]; overLimit: string[] } {
  const valid: string[] = [];
  const invalid: { term: string; issues: TermIssue[] }[] = [];
  const overLimit: string[] = [];
  for (const term of terms) {
    const issues = validateTerm(term, limits);
    if (issues.length > 0) invalid.push({ term, issues });
    else if (valid.length < limits.maxTerms) valid.push(term);
    else overLimit.push(term);
  }
  return { valid, invalid, overLimit };
}
