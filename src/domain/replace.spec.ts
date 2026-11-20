import { describe, expect, it } from 'vitest';
import {
  findMatches,
  hiddenInWords,
  replaceInText,
  replaceInWords,
  shiftMatches,
  snippet,
  withoutReplacements,
  type TextMatch,
} from './replace';
import type { Word } from './transcript';

/** The matched text of each match of `find` in one turn's `text`. */
function found(text: string, find: string): string[] {
  return findMatches([{ turnId: 't1', text }], find).map((m) => text.slice(m.start, m.end));
}

function word(text: string, start: number, logprob: number | null = -0.1): Word {
  return { text, start, end: start + 0.5, logprob };
}

describe('findMatches', () => {
  it('ignores case and accents', () => {
    expect(found('Anna, anna and ANNA.', 'anna')).toEqual(['Anna', 'anna', 'ANNA']);
    expect(found('Ask Zoë.', 'Zoe')).toEqual(['Zoë']);
    expect(found('Frau Müller kam.', 'Muller')).toEqual(['Müller']);
    expect(found('Herr Weiß sagt das.', 'Weiss')).toEqual(['Weiß']);
    expect(found('Herr Weiss sagt das.', 'Weiß')).toEqual(['Weiss']);
  });

  it('matches whole words only', () => {
    expect(found('Annabel and Hanna came.', 'Anna')).toEqual([]);
    expect(found("That was Anna's idea.", 'Anna')).toEqual(['Anna']);
    expect(found('Anna-Lena said so.', 'Anna')).toEqual(['Anna']);
  });

  it('matches a name of several words across whitespace, not across punctuation', () => {
    expect(found('I met Anna Schmidt today.', 'Anna Schmidt')).toEqual(['Anna Schmidt']);
    expect(found('I met Anna   Schmidt today.', 'anna schmidt')).toEqual(['Anna   Schmidt']);
    expect(found('I met Anna, Schmidt said.', 'Anna Schmidt')).toEqual([]);
  });

  it('needs the punctuation Find has between its words, in any typographic form', () => {
    expect(found('That was Anna’s idea.', "Anna's")).toEqual(['Anna’s']);
    expect(found('Anna s idea.', "Anna's")).toEqual([]);
    expect(found('Anna–Lena said so.', 'Anna-Lena')).toEqual(['Anna–Lena']);
  });

  it('has no matches for a find without letters or digits', () => {
    expect(found('Anna, she said.', ', !')).toEqual([]);
    expect(found('Anna', '   ')).toEqual([]);
  });

  it('finds several matches in one turn, in transcript order across turns', () => {
    const matches = findMatches(
      [
        { turnId: 't1', text: 'Anna asked Anna.' },
        { turnId: 't2', text: 'Nobody here.' },
        { turnId: 't3', text: 'Thanks, anna.' },
      ],
      'Anna',
    );
    expect(matches).toEqual([
      { turnId: 't1', start: 0, end: 4 },
      { turnId: 't1', start: 11, end: 15 },
      { turnId: 't3', start: 8, end: 12 },
    ]);
  });

  it('finds a name in a script written without spaces', () => {
    // Intl.Segmenter splits this into 田中 / さん / は / 来 / ま / した.
    expect(found('田中さんは来ました', '田中')).toEqual(['田中']);
  });
});

describe('replaceInText', () => {
  it('replaces several ranges in one turn, given in any order, and leaves the rest alone', () => {
    const text = 'Anna asked Anna, then anna left.';
    const matches = findMatches([{ turnId: 't1', text }], 'anna').reverse();
    expect(replaceInText(text, matches, 'Participant 1')).toBe(
      'Participant 1 asked Participant 1, then Participant 1 left.',
    );
  });

  it("keeps what follows the match in a word: Anna's", () => {
    const text = "It was Anna's idea.";
    expect(replaceInText(text, findMatches([{ turnId: 't1', text }], 'Anna'), 'P1')).toBe(
      "It was P1's idea.",
    );
  });
});

describe('replaceInWords', () => {
  it('replaces a one-word name, keeping its times', () => {
    const words = [word('I', 0), word('met', 1), word('Anna.', 2)];
    const out = replaceInWords(words, 'Anna', 'Participant 1', 'all');
    expect(out.map((w) => w.text)).toEqual(['I', 'met', 'Participant 1.']);
    expect(out[2]).toEqual({ text: 'Participant 1.', start: 2, end: 2.5, logprob: null });
    expect(out[0]).toBe(words[0]);
  });

  it('merges a name of two words into one, from the first start to the last end', () => {
    const words = [
      word('I', 0),
      word('met', 1),
      word('Anna', 2),
      word('Schmidt,', 3),
      word('yes', 4),
    ];
    const out = replaceInWords(words, 'Anna Schmidt', 'P1', 'all');
    expect(out.map((w) => w.text)).toEqual(['I', 'met', 'P1,', 'yes']);
    expect(out[2]).toMatchObject({ start: 2, end: 3.5, logprob: null });
  });

  it('keeps punctuation and the rest of the word', () => {
    expect(replaceInWords([word('Anna,', 0)], 'anna', 'Participant 1', 'all')[0]?.text).toBe(
      'Participant 1,',
    );
    expect(replaceInWords([word("Anna's", 0)], 'Anna', 'P1', 'all')[0]?.text).toBe("P1's");
  });

  it('does not match across punctuation between words', () => {
    const words = [word('Anna,', 0), word('Schmidt', 1)];
    expect(replaceInWords(words, 'Anna Schmidt', 'P1', 'all')).toBe(words);
  });

  it('replaces one occurrence by index when the counts agree, otherwise all', () => {
    const words = [word('Anna', 0), word('and', 1), word('Anna', 2)];
    expect(replaceInWords(words, 'Anna', 'P1', { index: 1, of: 2 }).map((w) => w.text)).toEqual([
      'Anna',
      'and',
      'P1',
    ]);
    expect(replaceInWords(words, 'Anna', 'P1', { index: 0, of: 2 }).map((w) => w.text)).toEqual([
      'P1',
      'and',
      'Anna',
    ]);
    expect(replaceInWords(words, 'Anna', 'P1', 'all').map((w) => w.text)).toEqual([
      'P1',
      'and',
      'P1',
    ]);
    expect(replaceInWords(words, 'Anna', 'P1', { index: 0, of: 3 }).map((w) => w.text)).toEqual([
      'P1',
      'and',
      'P1',
    ]);
  });

  it('returns the same array when nothing matches', () => {
    const words = [word('Annabel', 0), word('came', 1)];
    expect(replaceInWords(words, 'Anna', 'P1', 'all')).toBe(words);
    expect(replaceInWords(words, '...', 'P1', 'all')).toBe(words);
  });

  it('replaces every match inside one word', () => {
    expect(replaceInWords([word('Anna-Anna', 0)], 'Anna', 'P1', 'all')[0]?.text).toBe('P1-P1');
    expect(replaceInWords([word('田中さんと田中', 0)], '田中', 'P1', 'all')[0]?.text).toBe(
      'P1さんとP1',
    );
  });

  it('merges matches that share a word into one word, from the first start to the last end', () => {
    const words = [word('Anna', 0), word('Lena-Anna', 1), word('Lena', 2), word('kam', 3)];
    const out = replaceInWords(words, 'Anna Lena', 'P1', 'all');
    expect(out.map((w) => w.text)).toEqual(['P1-P1', 'kam']);
    expect(out[0]).toMatchObject({ start: 0, end: words[2]!.end, logprob: null });
  });

  it("leaves the name inside an earlier replacement's words, for every occurrence", () => {
    const words = [word('Anna B.', 0, null), word('und', 1), word('Anna', 2)];
    expect(replaceInWords(words, 'Anna', 'Anna B.', 'all').map((w) => w.text)).toEqual([
      'Anna B.',
      'und',
      'Anna B.',
    ]);
    // By index, the counts are the text's, which has the earlier replacement's Anna too.
    expect(
      replaceInWords(words, 'Anna', 'Anna B.', { index: 1, of: 2 }).map((w) => w.text),
    ).toEqual(['Anna B.', 'und', 'Anna B.']);
  });
});

describe('hiddenInWords', () => {
  it('counts the occurrences the words have beyond the text', () => {
    const words = [word('Anna', 0), word('und', 1), word('Anna', 2)];
    expect(hiddenInWords('Anna und sie', words, 'Anna')).toBe(1);
    expect(hiddenInWords('Anna und Anna', words, 'anna')).toBe(0);
    expect(hiddenInWords('sie', [], 'Anna')).toBe(0);
    expect(hiddenInWords('sie', words, '...')).toBe(0);
  });
});

describe('withoutReplacements', () => {
  it('leaves out the ranges inside an occurrence of the replacement, as typed', () => {
    const text = 'Anna B. and Anna and ANNA B.';
    const ranges = findMatches([{ turnId: 't1', text }], 'Anna');
    expect(withoutReplacements(text, ranges, 'Anna B.').map((r) => r.start)).toEqual([12, 21]);
    expect(withoutReplacements(text, ranges, '')).toEqual(ranges);
  });
});

describe('snippet', () => {
  const text =
    'one two three four five six seven eight nine ten Anna eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen.';
  const at = (t: string, find: string): TextMatch =>
    findMatches([{ turnId: 't1', text: t }], find)[0]!;

  it('shows eight words either side, with … where it cuts', () => {
    expect(snippet(text, at(text, 'Anna'))).toEqual({
      before: '…three four five six seven eight nine ten ',
      match: 'Anna',
      after: ' eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen…',
    });
  });

  it('does not cut at the start or end of the turn', () => {
    const t = 'Anna said yes.';
    expect(snippet(t, at(t, 'Anna'))).toEqual({ before: '', match: 'Anna', after: ' said yes.' });
    const u = 'Thank you, Anna.';
    expect(snippet(u, at(u, 'anna'))).toEqual({ before: 'Thank you, ', match: 'Anna', after: '.' });
  });
});

describe('shiftMatches', () => {
  it('drops the replaced match and moves the later ones in its turn', () => {
    const replaced = { turnId: 't1', start: 0, end: 4 };
    const remaining = [
      { turnId: 't1', start: 0, end: 4 },
      { turnId: 't1', start: 11, end: 15 },
      { turnId: 't2', start: 0, end: 4 },
    ];
    expect(shiftMatches(remaining, replaced, 'Participant 1')).toEqual([
      { turnId: 't1', start: 20, end: 24 },
      { turnId: 't2', start: 0, end: 4 },
    ]);
  });

  it('leaves earlier matches in the turn where they are', () => {
    const replaced = { turnId: 't1', start: 11, end: 15 };
    expect(shiftMatches([{ turnId: 't1', start: 0, end: 4 }, replaced], replaced, 'P1')).toEqual([
      { turnId: 't1', start: 0, end: 4 },
    ]);
  });
});
