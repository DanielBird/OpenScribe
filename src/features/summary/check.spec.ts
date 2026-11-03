import { describe, expect, it } from 'vitest';
import { toSessionText } from '../../domain/corpus/sessionText';
import { EMPTY_BRIEF, type ProjectBrief } from '../../domain/project';
import {
  NOT_DISCUSSED,
  type SessionSummary,
  type SummaryQuote,
  type SummaryTheme,
} from '../../domain/summary';
import { makeSummaryReply } from '../../testing/summary';
import { makeDoc, withTranslation } from '../../testing/transcriptDoc';
import { checkSummary, SUMMARY_LIMITS } from './check';

// The German fixture with its English translation: t1–t5, speakers speaker_0 and speaker_1.
const SESSION = toSessionText(withTranslation(makeDoc()));

const reply = (overrides: Partial<SessionSummary> = {}) => makeSummaryReply(SESSION, overrides);

const quote = (turnId: string, text: string): SummaryQuote => ({ turnId, text });

const theme = (
  name: string,
  quotes: SummaryQuote[] = [],
  turnIds: string[] = [],
): SummaryTheme => ({
  name,
  description: '',
  turnIds,
  isNew: true,
  quotes,
});

const many = <T>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

const BRIEF: ProjectBrief = {
  researchQuestions: ['How long have they worked on it?', 'What is hard?', 'Who helps?'],
  context: '',
  metadataFields: [],
};

describe('checkSummary', () => {
  it('keeps a valid reply as it is', () => {
    const output = reply();
    const { summary, droppedQuotes, verifiedQuotes, quoteFailureRate } = checkSummary(
      output,
      SESSION,
      EMPTY_BRIEF,
    );
    expect(summary).toEqual(output);
    expect(droppedQuotes).toBe(0);
    expect(verifiedQuotes).toBe(output.themes.flatMap((t) => t.quotes).length);
    expect(quoteFailureRate).toBe(0);
  });

  it('drops unknown and repeated turn ids everywhere they appear', () => {
    const output = reply({
      respondents: [
        {
          speakerId: 'speaker_1',
          label: 'Speaker 2',
          attributes: [{ field: 'Age', value: '54', turnIds: ['t2', 't99', 't2', ' t4 '] }],
        },
      ],
      researchQuestions: [
        {
          question: BRIEF.researchQuestions[0]!,
          finding: 'Two years.',
          turnIds: ['t4', 'x'],
          quotes: [],
        },
      ],
      themes: [theme('teamwork', [], ['t0', 't4'])],
    });
    const { summary } = checkSummary(output, SESSION, {
      ...BRIEF,
      researchQuestions: BRIEF.researchQuestions.slice(0, 1),
    });
    expect(summary.respondents[0]!.attributes[0]!.turnIds).toEqual(['t2', 't4']);
    expect(summary.researchQuestions[0]!.turnIds).toEqual(['t4']);
    expect(summary.themes[0]!.turnIds).toEqual(['t4']);
  });

  it('drops quotes whose turn does not exist, in findings and themes, and counts them', () => {
    const quotes = [quote('t4', 'For about two years'), quote('t42', 'For about two years')];
    const output = reply({
      researchQuestions: [
        { question: 'Who helps?', finding: 'A small team.', turnIds: [], quotes },
      ],
      themes: [theme('teamwork', quotes)],
    });
    const brief = { ...BRIEF, researchQuestions: ['Who helps?'] };
    const { summary, droppedQuotes, verifiedQuotes, quoteFailureRate } = checkSummary(
      output,
      SESSION,
      brief,
    );
    expect(summary.researchQuestions[0]!.quotes.map((q) => q.turnId)).toEqual(['t4']);
    expect(summary.themes[0]!.quotes.map((q) => q.turnId)).toEqual(['t4']);
    expect(droppedQuotes).toBe(2);
    expect(verifiedQuotes).toBe(2);
    expect(quoteFailureRate).toBe(0.5);
  });

  it("keeps a respondent's speaker id only if it is a speaker in the session", () => {
    const output = reply({
      respondents: [
        { speakerId: 'speaker_1', label: 'Speaker 2', attributes: [] },
        { speakerId: 'speaker_7', label: 'Anna', attributes: [] },
        { speakerId: null, label: 'Her husband', attributes: [] },
      ],
    });
    const { summary } = checkSummary(output, SESSION, EMPTY_BRIEF);
    expect(summary.respondents.map((r) => r.speakerId)).toEqual(['speaker_1', null, null]);
    expect(summary.respondents.map((r) => r.label)).toEqual(['Speaker 2', 'Anna', 'Her husband']);
  });

  describe('research questions', () => {
    const finding = (
      question: string,
      text: string,
      turnIds = ['t4'],
      quotes: SummaryQuote[] = [],
    ) => ({ question, finding: text, turnIds, quotes });

    const notDiscussed = (question: string) => ({
      question,
      finding: NOT_DISCUSSED,
      turnIds: [],
      quotes: [],
    });

    it("give one finding per brief question, in the brief's order and wording", () => {
      const output = reply({
        researchQuestions: [
          finding('who helps?', 'A small team.'), // case differs, out of order
          finding('How long have they worked on it?', 'Two years.'),
          finding('What is hard', 'Not said.', ['t5']), // punctuation differs
        ],
      });
      const { summary } = checkSummary(output, SESSION, BRIEF);
      expect(summary.researchQuestions).toEqual([
        finding('How long have they worked on it?', 'Two years.'),
        finding('What is hard?', 'Not said.', ['t5']),
        finding('Who helps?', 'A small team.'),
      ]);
    });

    it('match a reworded question by its position, when the reply has one entry per question', () => {
      const output = reply({
        researchQuestions: [
          finding('How long has the project run?', 'Two years.'),
          finding('What is hard?', 'Hard to say.'),
          finding('Who helps?', 'A small team.'),
        ],
      });
      const { summary } = checkSummary(output, SESSION, BRIEF);
      expect(summary.researchQuestions.map((q) => q.question)).toEqual(BRIEF.researchQuestions);
      expect(summary.researchQuestions[0]!.finding).toBe('Two years.');
    });

    it('mark a question the reply left out as not discussed, and drop extra entries', () => {
      const output = reply({
        researchQuestions: [
          finding('Who helps?', 'A small team.'),
          finding('What did they eat?', 'Nothing.', ['t4'], [quote('t42', 'invented')]),
        ],
      });
      const { summary, droppedQuotes } = checkSummary(output, SESSION, BRIEF);
      expect(summary.researchQuestions).toEqual([
        notDiscussed('How long have they worked on it?'),
        notDiscussed('What is hard?'),
        finding('Who helps?', 'A small team.'),
      ]);
      expect(droppedQuotes).toBe(0); // an extra entry's quotes aren't checked
    });

    it('keep no turns or quotes for a question the session does not discuss', () => {
      const output = reply({
        researchQuestions: [
          finding('Who helps?', 'Not discussed in this session', ['t2'], [quote('t42', 'x')]),
        ],
      });
      const brief = { ...BRIEF, researchQuestions: ['Who helps?'] };
      const { summary, droppedQuotes } = checkSummary(output, SESSION, brief);
      expect(summary.researchQuestions).toEqual([notDiscussed('Who helps?')]);
      expect(droppedQuotes).toBe(0);
    });

    it('are empty when the brief has none', () => {
      const output = reply({ researchQuestions: [finding('Anything?', 'Something.')] });
      expect(checkSummary(output, SESSION, EMPTY_BRIEF).summary.researchQuestions).toEqual([]);
    });
  });

  it("verifies each quote against its turn's English text and keeps the transcript's own words", () => {
    const output = reply({
      themes: [
        theme('welcome', [
          quote('t2', '“thank you, i’m very pleased to be here”'), // case and quotation marks differ
          quote('t4', 'For about two years … a small team'), // an omission
          quote('t4', 'For about three years'), // changed
          quote('t2', 'Danke, ich freue mich sehr'), // the German original
        ]),
      ],
    });
    const { summary, droppedQuotes, verifiedQuotes, quoteFailureRate } = checkSummary(
      output,
      SESSION,
      EMPTY_BRIEF,
    );
    expect(summary.themes[0]!.quotes).toEqual([
      { turnId: 't2', text: "Thank you, I'm very pleased to be here." },
      { turnId: 't4', text: 'For about two years … a small team.' },
    ]);
    expect(droppedQuotes).toBe(2);
    expect(verifiedQuotes).toBe(2);
    expect(quoteFailureRate).toBe(0.5);
  });

  it("caps the themes and each entry's quotes, and checks only the quotes of themes it keeps", () => {
    const output = reply({
      themes: many(15, (i) =>
        theme(`theme ${i}`, [
          quote('t9', 'invented'),
          ...many(5, () => quote('t4', 'For about two years')),
        ]),
      ),
    });
    const { summary, droppedQuotes, verifiedQuotes, quoteFailureRate } = checkSummary(
      output,
      SESSION,
      EMPTY_BRIEF,
    );
    expect(summary.themes).toHaveLength(SUMMARY_LIMITS.themes);
    expect(summary.themes.at(-1)!.name).toBe('theme 11');
    expect(summary.themes.map((t) => t.quotes.length)).toEqual(
      many(SUMMARY_LIMITS.themes, () => SUMMARY_LIMITS.quotesPerEntry),
    );
    // One invented quote per kept theme: capped quotes aren't dropped ones.
    expect(droppedQuotes).toBe(SUMMARY_LIMITS.themes);
    // Capped quotes still count as verified.
    expect(verifiedQuotes).toBe(5 * SUMMARY_LIMITS.themes);
    expect(quoteFailureRate).toBe(1 / 6);
  });

  it('trims the title to 80 characters, cut after a word', () => {
    const long = `P07   home visit in Hamburg, ${'with a very long description '.repeat(4)}`;
    const { summary } = checkSummary(reply({ title: long }), SESSION, EMPTY_BRIEF);
    expect(summary.title.length).toBeLessThanOrEqual(80);
    expect(summary.title).toMatch(/^P07 home visit in Hamburg, with a very long .*\w…$/);
    expect(
      checkSummary(reply({ title: '  P07 – Hamburg ' }), SESSION, EMPTY_BRIEF).summary.title,
    ).toBe('P07 – Hamburg');
  });

  it('leaves the reply unchanged', () => {
    const output = reply({ themes: [theme('invented', [quote('t9', 'invented')])] });
    const copy = structuredClone(output);
    checkSummary(output, SESSION, BRIEF);
    expect(output).toEqual(copy);
  });
});
