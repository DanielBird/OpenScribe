// The check every summary reply goes through before it is kept (PROJECTS.md §5.3, DECISIONS.md T13): turn ids must
// exist, research questions follow the brief, and every quote must be found in its turn. A verified quote is kept
// in the transcript's own words; the others are dropped and counted.
import { matchString } from '../../domain/corpus/normalize';
import { checkQuote } from '../../domain/corpus/quoteCheck';
import { englishText, type SessionText } from '../../domain/corpus/sessionText';
import type { ProjectBrief } from '../../domain/project';
import {
  NOT_DISCUSSED,
  type ResearchQuestionFinding,
  type SessionSummary,
  type SummaryQuote,
} from '../../domain/summary';

export const SUMMARY_LIMITS = { themes: 12, quotesPerEntry: 3, titleChars: 80 } as const;

export interface CheckedSummary {
  summary: SessionSummary;
  /** Quotes removed because they weren't found in their turn (or the turn doesn't exist). */
  droppedQuotes: number;
  /** Quotes found in their turn, before the cap. */
  verifiedQuotes: number;
  /** `droppedQuotes` out of the quotes that were checked; 0 when none were. */
  quoteFailureRate: number;
}

/** The title on one line, at most `titleChars` long, cut after a word with `…`. */
function shortTitle(title: string): string {
  const max = SUMMARY_LIMITS.titleChars;
  const text = title.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * One finding per brief question, in the brief's order and wording. A reply entry is matched by its question
 * (ignoring case and punctuation). When the reply has one entry per question, an entry that matches no brief
 * question is taken as its position's question, reworded. A question with no entry is "Not discussed in this
 * session", with no turns and no quotes.
 */
function alignQuestions(
  given: readonly ResearchQuestionFinding[],
  brief: ProjectBrief,
  knownTurns: (ids: readonly string[]) => string[],
  checkQuotes: (quotes: readonly SummaryQuote[]) => SummaryQuote[],
): ResearchQuestionFinding[] {
  const keys = brief.researchQuestions.map(matchString);
  const givenKeys = given.map((g) => matchString(g.question));
  const byPosition = given.length === keys.length;
  const used = new Set<number>();
  const notDiscussed = matchString(NOT_DISCUSSED);

  return brief.researchQuestions.map((question, i) => {
    let at = givenKeys.findIndex((key, j) => !used.has(j) && key === keys[i]);
    if (at < 0 && byPosition && !used.has(i) && !keys.includes(givenKeys[i]!)) at = i;
    const entry = given[at];
    if (!entry) return { question, finding: NOT_DISCUSSED, turnIds: [], quotes: [] };
    used.add(at);
    const finding = entry.finding.trim();
    return !finding || matchString(finding) === notDiscussed
      ? { question, finding: NOT_DISCUSSED, turnIds: [], quotes: [] }
      : {
          question,
          finding,
          turnIds: knownTurns(entry.turnIds),
          quotes: checkQuotes(entry.quotes),
        };
  });
}

/** Applies every rule to a reply. Pure: `output` isn't changed. */
export function checkSummary(
  output: SessionSummary,
  session: SessionText,
  brief: ProjectBrief,
): CheckedSummary {
  const turns = new Map(session.turns.map((t) => [t.id, t]));
  const speakerIds = new Set(session.speakers.map((s) => s.id));
  const knownTurns = (ids: readonly string[]) => [
    ...new Set(ids.map((id) => id.trim()).filter((id) => turns.has(id))),
  ];

  let checkedQuotes = 0;
  let droppedQuotes = 0;
  let verifiedQuotes = 0;
  /** An entry's quotes that are found in their turn, in its own words, up to the cap. The others are counted. */
  const checkQuotes = (given: readonly SummaryQuote[]): SummaryQuote[] => {
    const kept: SummaryQuote[] = [];
    for (const quote of given) {
      checkedQuotes++;
      const turn = turns.get(quote.turnId.trim());
      const english = turn ? englishText(session, turn) : null;
      const result = turn && english !== null ? checkQuote(english, quote.text) : null;
      if (turn && result?.status === 'verified') {
        verifiedQuotes++;
        kept.push({ turnId: turn.id, text: result.sourceText });
      } else {
        droppedQuotes++;
      }
    }
    return kept.slice(0, SUMMARY_LIMITS.quotesPerEntry);
  };

  const summary: SessionSummary = {
    title: shortTitle(output.title),
    synopsis: output.synopsis.trim(),
    overview: output.overview.trim(),
    respondents: output.respondents.map((r) => ({
      speakerId: r.speakerId !== null && speakerIds.has(r.speakerId) ? r.speakerId : null,
      label: r.label,
      attributes: r.attributes.map((a) => ({ ...a, turnIds: knownTurns(a.turnIds) })),
    })),
    researchQuestions: alignQuestions(output.researchQuestions, brief, knownTurns, checkQuotes),
    // Cut first, so the quotes of themes that are cut aren't checked or counted.
    themes: output.themes
      .slice(0, SUMMARY_LIMITS.themes)
      .map((t) => ({ ...t, turnIds: knownTurns(t.turnIds), quotes: checkQuotes(t.quotes) })),
  };

  return {
    summary,
    droppedQuotes,
    verifiedQuotes,
    quoteFailureRate: checkedQuotes === 0 ? 0 : droppedQuotes / checkedQuotes,
  };
}
