import { describe, expect, it } from 'vitest';
import { parseQuery, QUERY_MESSAGES, type Query, type QueryError, type TermPattern } from './query';

function parsed(input: string): Query {
  const result = parseQuery(input);
  if (result.kind === 'error') throw new Error(`expected a query: ${result.message}`);
  return result;
}

function failed(input: string): QueryError {
  const result = parseQuery(input);
  if (result.kind !== 'error') throw new Error(`expected an error for ${input}`);
  return result;
}

const term = (words: string[], prefix = false): TermPattern => ({
  words,
  prefix,
  needle: ` ${words.join(' ')}${prefix ? '' : ' '}`,
});

describe('parseQuery', () => {
  it('needs every word (AND)', () => {
    expect(parsed('charger night')).toEqual({
      kind: 'query',
      clauses: [[term(['charger'])], [term(['night'])]],
      exclusions: [],
    });
  });

  it('normalises terms like the text', () => {
    expect(parsed('Hörgerät STRASSE Straße').clauses).toEqual([
      [term(['horgerat'])],
      [term(['strasse'])],
      [term(['strasse'])],
    ]);
  });

  it('reads an exact phrase as consecutive words', () => {
    expect(parsed('"Charger by the bed"').clauses).toEqual([
      [term(['charger', 'by', 'the', 'bed'])],
    ]);
  });

  it('accepts typographic quotation marks around a phrase', () => {
    for (const input of ['“by the bed”', '„by the bed“', '«by the bed»']) {
      expect(parsed(input).clauses).toEqual([[term(['by', 'the', 'bed'])]]);
    }
  });

  it('reads a term that is several words once normalised as a phrase', () => {
    expect(parsed("don't e-mail").clauses).toEqual([[term(['don', 't'])], [term(['e', 'mail'])]]);
  });

  it('reads word* as a prefix', () => {
    expect(parsed('charg*').clauses).toEqual([[term(['charg'], true)]]);
    expect(parsed('Ladeg**').clauses).toEqual([[term(['ladeg'], true)]]);
    // The prefix is on the last word of a term that is several words.
    expect(parsed('follow-up*').clauses).toEqual([[term(['follow', 'up'], true)]]);
  });

  it('treats * inside quotation marks as punctuation', () => {
    expect(parsed('"charg* by"').clauses).toEqual([[term(['charg', 'by'])]]);
  });

  it('makes OR bind tighter than AND', () => {
    expect(parsed('charg* night OR evening').clauses).toEqual([
      [term(['charg'], true)],
      [term(['night']), term(['evening'])],
    ]);
  });

  it('chains OR', () => {
    expect(parsed('night OR evening OR "before bed"').clauses).toEqual([
      [term(['night']), term(['evening']), term(['before', 'bed'])],
    ]);
  });

  it('reads a lower-case or as a word', () => {
    expect(parsed('night or evening').clauses).toHaveLength(3);
  });

  it('excludes words and phrases with -', () => {
    expect(parsed('charger -phone -"my phone"')).toEqual({
      kind: 'query',
      clauses: [[term(['charger'])]],
      exclusions: [term(['phone']), term(['my', 'phone'])],
    });
  });

  it('reads a - that is on its own or inside a word as punctuation', () => {
    expect(parsed('charger - night').clauses).toEqual([[term(['charger'])], [term(['night'])]]);
    expect(parsed('follow-up').exclusions).toEqual([]);
  });

  it('ignores terms with no words', () => {
    expect(parsed('charger !!! "" … night').clauses).toEqual([
      [term(['charger'])],
      [term(['night'])],
    ]);
  });

  it('ends a bare term at a quotation mark', () => {
    expect(parsed('night"by the bed"').clauses).toEqual([
      [term(['night'])],
      [term(['by', 'the', 'bed'])],
    ]);
  });

  describe('errors', () => {
    it.each(['', '   ', '!!!', '""'])('an empty query: %j', (input) => {
      expect(failed(input).message).toBe(QUERY_MESSAGES.empty);
    });

    it.each(['-phone', '-phone -"my phone"'])('only exclusions: %s', (input) => {
      expect(failed(input).message).toBe(QUERY_MESSAGES.onlyExclusions);
    });

    it.each(['a*', 'charger a*', '*', 'l’a*', 'follow-u*'])(
      'a prefix shorter than 2 letters: %s',
      (input) => {
        expect(failed(input).message).toBe(QUERY_MESSAGES.shortPrefix);
      },
    );

    it.each(['"by the bed', 'charger "by', '-"my phone'])('an unclosed quote: %s', (input) => {
      expect(failed(input).message).toBe(QUERY_MESSAGES.unclosedQuote);
    });

    it.each(['OR night', 'night OR', 'night OR OR evening', '-phone OR night', 'night OR -phone'])(
      'OR without a term on both sides: %s',
      (input) => {
        expect(failed(input).message).toBe(QUERY_MESSAGES.orOperands);
      },
    );
  });
});
