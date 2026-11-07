import { describe, expect, it } from 'vitest';
import { checkQuote } from './quoteCheck';

const TURN =
  'I just put them on the charger by the bed, like my phone. Do you charge them at night? Yes, every night.';
const GERMAN = 'Ich lege das Hörgerät nachts auf das Ladegerät, neben dem Bett.';

const verified = (sourceText: string) => ({ status: 'verified', sourceText });
const NOT_FOUND = { status: 'not_found' };
const UNSAFE = { status: 'unsafe_omission' };

describe('checkQuote', () => {
  it('verifies an exact quote and returns the turn’s own text', () => {
    expect(checkQuote(TURN, 'I just put them on the charger by the bed')).toEqual(
      verified('I just put them on the charger by the bed'),
    );
  });

  it('verifies a quote with changed case and punctuation', () => {
    expect(checkQuote(TURN, '“i just put them on the charger, by the bed!”')).toEqual(
      verified('I just put them on the charger by the bed'),
    );
  });

  it('verifies a quote with changed accents and shows the accents of the turn', () => {
    expect(checkQuote(GERMAN, 'das Horgerat nachts')).toEqual(verified('das Hörgerät nachts'));
    expect(checkQuote(GERMAN, 'LADEGERÄT NEBEN DEM BETT')).toEqual(
      verified('Ladegerät, neben dem Bett.'),
    );
  });

  it('rejects a quote with one changed word', () => {
    expect(checkQuote(TURN, 'I just put them on the charger by my bed')).toEqual(NOT_FOUND);
  });

  it('rejects a quote with one added word', () => {
    expect(checkQuote(TURN, 'I just put them on the new charger by the bed')).toEqual(NOT_FOUND);
  });

  it('rejects a quote with an omission that isn’t marked', () => {
    expect(checkQuote(TURN, 'I put them on the charger')).toEqual(NOT_FOUND);
  });

  it.each(['…', '...', '[…]', '[...]', '(…)', ' … '])(
    'verifies an omission marked %j and shows it in sourceText',
    (mark) => {
      expect(checkQuote(TURN, `I just put them${mark}like my phone`)).toEqual(
        verified('I just put them … like my phone.'),
      );
    },
  );

  it('verifies several omissions, in order', () => {
    expect(checkQuote(TURN, 'I just put … by the bed … yes every night')).toEqual(
      verified('I just put … by the bed … Yes, every night.'),
    );
  });

  it('rejects parts that are out of order', () => {
    expect(checkQuote(TURN, 'like my phone … I just put them')).toEqual(NOT_FOUND);
  });

  it('matches repeated words in order', () => {
    const quote = 'night after night … night after night';
    expect(checkQuote('Night after night, and night after night again.', quote)).toEqual(
      verified('Night after night … night after night'),
    );
    expect(checkQuote('Night after night again.', quote)).toEqual(NOT_FOUND);
  });

  it('verifies a quote across a sentence boundary', () => {
    expect(checkQuote(TURN, 'like my phone do you charge them')).toEqual(
      verified('like my phone. Do you charge them'),
    );
  });

  it('keeps the punctuation that ends the quoted sentence', () => {
    expect(checkQuote(TURN, 'Do you charge them at night')).toEqual(
      verified('Do you charge them at night?'),
    );
  });

  it('ignores an ellipsis at the start or end of the quote', () => {
    expect(checkQuote(TURN, '“…on the charger by the bed…”')).toEqual(
      verified('on the charger by the bed'),
    );
    expect(checkQuote(TURN, '[...] on the charger ...')).toEqual(verified('on the charger'));
  });

  it('rejects an empty part between two omission marks', () => {
    expect(checkQuote(TURN, 'I just … … like my phone')).toEqual(NOT_FOUND);
    expect(checkQuote(TURN, 'I just … ! … like my phone')).toEqual(NOT_FOUND);
  });

  it('rejects a quote longer than the turn', () => {
    expect(checkQuote(TURN, `${TURN} And the charger.`)).toEqual(NOT_FOUND);
  });

  it.each(['', '   ', '""', '“ ”', '…', '[…]', '!?'])('rejects an empty quote: %j', (quote) => {
    expect(checkQuote(TURN, quote)).toEqual(NOT_FOUND);
  });

  it('rejects any quote against an empty turn', () => {
    expect(checkQuote('', 'charger')).toEqual(NOT_FOUND);
  });

  it('splits words at apostrophes, like search', () => {
    expect(checkQuote("The doctor's advice.", 'the doctor’s advice')).toEqual(
      verified("The doctor's advice."),
    );
    expect(checkQuote("The doctor's advice.", 'the doctors advice')).toEqual(NOT_FOUND);
  });
});

describe('checkQuote: omissions that could change what was said (D44)', () => {
  it('rejects a part shorter than three words', () => {
    expect(checkQuote(TURN, 'I just … like my phone')).toEqual(UNSAFE);
    expect(checkQuote(TURN, 'I just put them … phone')).toEqual(UNSAFE);
    expect(
      checkQuote("I don't love the way the charger makes them hot.", 'I … love … them'),
    ).toEqual(UNSAFE);
  });

  it.each([
    [
      'Honestly I would not recommend them to anyone.',
      'Honestly I would … recommend them to anyone',
    ],
    ['To be honest I never charge them at night.', 'To be honest … charge them at night'],
    ["To be fair I don't like them at all.", 'To be fair … like them at all'],
    ['To be fair I don’t like them at all.', 'To be fair … like them at all'],
    ['To be fair I cannot see them at all.', 'To be fair … see them at all'],
  ])('rejects an omission that leaves out a negation: %j', (turn, quote) => {
    expect(checkQuote(turn, quote)).toEqual(UNSAFE);
  });

  it('allows a negation outside the words left out', () => {
    const turn = "I don't know, I put them on the charger by the bed every night.";
    expect(checkQuote(turn, 'I put them on … by the bed every night')).toEqual(
      verified('I put them on … by the bed every night.'),
    );
  });

  it('takes a "t" as a negation only after "n" and an apostrophe', () => {
    expect(
      checkQuote(
        'I wear a T-shirt and charge them at night.',
        'I wear a … and charge them at night',
      ),
    ).toEqual(verified('I wear a … and charge them at night.'));
  });

  it('applies the rules only to a quote with an omission', () => {
    expect(checkQuote(TURN, 'the bed')).toEqual(verified('the bed'));
    expect(checkQuote(TURN, '… the bed …')).toEqual(verified('the bed'));
  });

  it('allows an omission that leaves nothing out', () => {
    expect(checkQuote(TURN, 'I just put … them on the charger')).toEqual(
      verified('I just put … them on the charger'),
    );
  });

  it('says a quote is not found before it says an omission is unsafe', () => {
    expect(checkQuote(TURN, 'I … charger by my bed')).toEqual(NOT_FOUND);
  });
});
