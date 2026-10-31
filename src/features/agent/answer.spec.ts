import { describe, expect, it } from 'vitest';
import { makeAgentCorpus } from '../../testing/agentCorpus';
import { parseAnswer, parseInlines, type AnswerBlock } from './answer';

const corpus = makeAgentCorpus();
const parse = (text: string, streaming = false) => parseAnswer(text, corpus, { streaming });
const text = (t: string) => ({ kind: 'text', text: t });

describe('parseAnswer', () => {
  it('parses paragraphs, headings and lists', () => {
    const blocks = parse(
      [
        '# Charging at night',
        'Most people charge',
        'by the bed.',
        '',
        '## Who helps',
        '- Partners remind them',
        '* Some use an alarm',
        '  every evening',
        '1. First',
        '2) Second',
        '### Gaps',
        'Not read: P03.',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      { kind: 'heading', inlines: [text('Charging at night')] },
      { kind: 'paragraph', inlines: [text('Most people charge by the bed.')] },
      { kind: 'heading', inlines: [text('Who helps')] },
      {
        kind: 'list',
        ordered: false,
        items: [[text('Partners remind them')], [text('Some use an alarm every evening')]],
      },
      { kind: 'list', ordered: true, items: [[text('First')], [text('Second')]] },
      { kind: 'heading', inlines: [text('Gaps')] },
      { kind: 'paragraph', inlines: [text('Not read: P03.')] },
    ]);
  });

  it('parses bold and italic, and leaves unmatched markers as text', () => {
    expect(
      parseInlines('A **routine**, *mostly* at _night_; 2 * 3 and snake_case_name **open'),
    ).toEqual([
      text('A '),
      { kind: 'bold', text: 'routine' },
      text(', '),
      { kind: 'italic', text: 'mostly' },
      text(' at '),
      { kind: 'italic', text: 'night' },
      text('; 2 * 3 and snake_case_name **open'),
    ]);
  });

  it('keeps HTML-like text as text', () => {
    const blocks = parse(
      '<script>alert(1)</script> <b>bold</b> <img src=x onerror=alert(1)>\n<quote>no ref</quote>',
    );
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          text(
            '<script>alert(1)</script> <b>bold</b> <img src=x onerror=alert(1)> <quote>no ref</quote>',
          ),
        ],
      },
    ]);
  });

  it('verifies a quote against the English text and gives its citation', () => {
    const [quote] = parse('<quote ref="s1/t2">i put them on the CHARGER by the bed</quote>');
    expect(quote).toEqual({
      kind: 'quote',
      ref: 's1/t2',
      sessionId: 'session-1',
      modelText: 'i put them on the CHARGER by the bed',
      check: { status: 'verified', sourceText: 'I put them on the charger by the bed' },
      citation: {
        text: 'I put them on the charger by the bed',
        speakerLabel: 'Mary',
        start: 61,
        sessionTitle: 'P01 – kitchen interview, Leeds',
        translatedFrom: null,
      },
    });
  });

  it('checks a quote from a translated session against its translation, with omissions', () => {
    const [quote] = parse('<quote ref="s2/t2">In the evening … on the charger.</quote>');
    expect(quote).toMatchObject({
      check: { status: 'verified', sourceText: 'In the evening … on the charger.' },
      citation: {
        speakerLabel: 'Anna',
        translatedFrom: 'deu',
        sessionTitle: 'P02 – home visit, Hamburg',
      },
    });
  });

  it.each([
    [
      'changed words',
      '<quote ref="s1/t2">I put them on the charger next to the bed</quote>',
      'session-1',
    ],
    ['an unknown session', '<quote ref="s9/t2">by the bed</quote>', null],
    ['an unknown turn', '<quote ref="s1/t99">by the bed</quote>', 'session-1'],
    ['a malformed ref', '<quote ref="P01 t2">by the bed</quote>', null],
    ['an untranslated session', '<quote ref="s3/t2">La nuit</quote>', 'session-3'],
  ])('marks a quote with %s as not found, without a citation', (_, input, sessionId) => {
    expect(parse(input)).toEqual([
      expect.objectContaining({
        kind: 'quote',
        sessionId,
        check: { status: 'not_found' },
        citation: null,
      }),
    ]);
  });

  it('splits a paragraph around a quote tag', () => {
    const blocks = parse(
      'Mary says <quote ref="s1/t4">Every night.</quote> and her husband helps.',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'quote', 'paragraph']);
    expect(blocks[0]).toEqual({ kind: 'paragraph', inlines: [text('Mary says')] });
    expect(blocks[2]).toEqual({ kind: 'paragraph', inlines: [text('and her husband helps.')] });
  });

  it('holds back an unfinished quote tag while streaming', () => {
    const kinds = (blocks: AnswerBlock[]) => blocks.map((b) => b.kind);
    expect(parse('People charge at night.\n<quote ref="s1/t4">Every', true)).toEqual([
      { kind: 'paragraph', inlines: [text('People charge at night.')] },
    ]);
    expect(parse('People charge at night.\n<quo', true)).toHaveLength(1);
    expect(kinds(parse('A.\n<quote ref="s1/t4">Every night.</quote>\nB <', true))).toEqual([
      'paragraph',
      'quote',
      'paragraph',
    ]);
    // Without streaming, the unfinished tag is text.
    expect(parse('A.\n<quote ref="s1/t4">Every')).toEqual([
      { kind: 'paragraph', inlines: [text('A. <quote ref="s1/t4">Every')] },
    ]);
  });
});
