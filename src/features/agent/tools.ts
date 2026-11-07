// The project agent's tools (PROJECTS.md §5.5). They only read the corpus: none can write a file or reach the
// network. Each returns compact text for the model and one activity line for the UI. The budgets are enforced
// here, per question (A18, D45).
import { parseQuery } from '../../domain/corpus/query';
import type { SearchField, SessionHits } from '../../domain/corpus/search';
import { englishText, type SessionTurn } from '../../domain/corpus/sessionText';
import type { SummaryQuote } from '../../domain/summary';
import { oneLine, plural } from '../../domain/text';
import { formatTimestamp, languageOrUnknown } from '../../domain/transcript';
import { z } from '../../lib/zod';
import type { AgentTool } from '../../providers/llm/types';
import { themeKey, themeVocabulary } from '../summary/themes';
import type { CorpusReader, CorpusSession } from './corpus';
import { sessionLanguage, speakerLabel, turnLine } from './format';
import {
  AGENT_LIMITS,
  DEFAULT_AGENT_LIMITS,
  estimateTokens,
  type AgentBudgetLimits,
} from './limits';

export const TOOL_BUDGET_REACHED = 'Tool budget reached. Answer now.';
export const READING_BUDGET_REACHED = 'Reading budget reached. Answer from what you have.';
export const SUMMARY_BUDGET_REACHED =
  'Summary budget reached. Search or read the transcripts, or answer from what you have.';

/** What a question may use, and what it has used so far. Make a fresh one per question. */
export interface AgentBudget {
  limits: AgentBudgetLimits;
  toolCalls: number;
  transcriptTokens: number;
  summaryTokens: number;
}

export function createBudget(limits: AgentBudgetLimits = DEFAULT_AGENT_LIMITS): AgentBudget {
  return { limits, toolCalls: 0, transcriptTokens: 0, summaryTokens: 0 };
}

/** A budget with nothing left, so every tool says to answer: for the summary of `/compact` (Phase 22). */
export function spentBudget(limits: AgentBudgetLimits = DEFAULT_AGENT_LIMITS): AgentBudget {
  return {
    limits,
    toolCalls: limits.toolCalls,
    transcriptTokens: limits.transcriptTokens,
    summaryTokens: limits.summaryTokens,
  };
}

type ToolResult = Awaited<ReturnType<AgentTool['run']>>;

/** Sessions per page of search results: as many as fit the per-call hit cap at the per-session cap. */
const SESSIONS_PER_PAGE = AGENT_LIMITS.hitsPerCall / AGENT_LIMITS.hitsPerSession;

/** A tool whose input type is checked here; the provider validates the input against `input` before `run`. */
function defineTool<I>(tool: AgentTool<I>): AgentTool {
  return tool as unknown as AgentTool;
}

function sessionFor(corpus: CorpusReader, key: string): CorpusSession {
  const session = corpus.byKey(key);
  if (!session) throw new Error(`Unknown session ${key}. Use the keys from the session list.`);
  return session;
}

function turnIndex(session: CorpusSession, turnId: string): number {
  const index = session.text.turns.findIndex((t) => t.id === turnId.trim());
  if (index >= 0) return index;
  const { turns } = session.text;
  const range = turns.length
    ? ` Its turns are ${turns[0]?.id}–${turns[turns.length - 1]?.id}.`
    : '';
  throw new Error(`Session ${session.key} has no turn ${turnId}.${range}`);
}

// --- search_transcripts -------------------------------------------------------------------------------------

const SearchInput = z.object({
  query: z.string().describe('The keyword query.'),
  sessions: z.array(z.string()).optional().describe('Only these session keys, e.g. ["s3", "s12"].'),
  in: z
    .enum(['english', 'original', 'both'])
    .optional()
    .describe('Which text to search. Default: english.'),
  page: z.number().int().positive().optional().describe('Page of sessions, from 1. Default: 1.'),
});

const SEARCH_DESCRIPTION = `Find turns in all session transcripts. Syntax:
- all words must appear in one turn;
- "exact phrase";
- charg* matches charge, charging, charger (only at the end of a word without quotes);
- night OR evening for alternatives;
- -word excludes.
Case, accents and punctuation are ignored, but there's no stemming and no matching inside words (Akku doesn't find Hörgeräteakku), and ö matches o, not oe, so add variants yourself. in: english (default; the translation for translated sessions), original (the language spoken) or both. Results are grouped by session, most hits first, with refs like s12/t412. Use page for more sessions.`;

function hitLines(session: CorpusSession, hits: SessionHits): string[] {
  const shown = hits.hits.length;
  const count = plural(hits.hitCount, 'hit');
  const lines = [
    `${session.key} · ${oneLine(session.title)} · ${shown < hits.hitCount ? `${count}, first ${shown} shown` : count}`,
  ];
  for (const hit of hits.hits) {
    const original = hit.field === 'original' ? ' (original)' : '';
    lines.push(
      `${session.key}/${hit.turnId} [${formatTimestamp(hit.start)}] ` +
        `${speakerLabel(session.text, hit.speakerId)}${original}: ${oneLine(hit.snippet)}`,
    );
  }
  return lines;
}

function searchTool(corpus: CorpusReader): AgentTool {
  return defineTool({
    name: 'search_transcripts',
    description: SEARCH_DESCRIPTION,
    input: SearchInput,
    async run(input): Promise<ToolResult> {
      const query = parseQuery(input.query);
      if (query.kind === 'error') throw new Error(`Query error: ${query.message}`);
      const sessionIds = input.sessions?.map((key) => sessionFor(corpus, key).text.sessionId);
      const field: SearchField = input.in ?? 'english';
      const page = input.page ?? 1;
      const result = corpus.search(query, {
        field,
        sessionIds,
        maxHitsPerSession: AGENT_LIMITS.hitsPerSession,
        offset: (page - 1) * SESSIONS_PER_PAGE,
        limit: SESSIONS_PER_PAGE,
      });

      const quoted = `"${oneLine(input.query)}"${field === 'english' ? '' : ` (${field})`}`;
      const found = `${plural(result.totalHits, 'hit')} in ${plural(result.totalSessions, 'session')}`;
      const activity = `Searched ${quoted} · ${result.totalHits ? found : 'no hits'}`;
      if (result.totalHits === 0) return { content: `No hits for ${quoted}.`, activity };

      const pages = Math.ceil(result.totalSessions / SESSIONS_PER_PAGE);
      const lines = [`${found} · page ${page} of ${pages}`];
      if (result.sessions.length === 0) lines.push(`No more sessions after page ${pages}.`);
      for (const hits of result.sessions) {
        const session = corpus.byId(hits.sessionId);
        if (session) lines.push('', ...hitLines(session, hits));
      }
      return { content: lines.join('\n'), activity };
    },
  });
}

// --- get_summaries ------------------------------------------------------------------------------------------

const SummariesInput = z.object({
  sessions: z.array(z.string()).describe(`Up to ${AGENT_LIMITS.summariesPerCall} session keys.`),
});

const turnRefs = (key: string, turnIds: readonly string[]) =>
  turnIds.length ? ` (${turnIds.map((id) => `${key}/${id}`).join(', ')})` : '';

/** An entry's checked quotes, one indented line each. */
const quoteLines = (key: string, quotes: readonly SummaryQuote[], indent: string) =>
  quotes.map((q) => `${indent}- ${key}/${q.turnId} "${oneLine(q.text)}"`);

function summaryText(session: CorpusSession): string {
  const { key, summary } = session;
  const head = `${key} · ${oneLine(session.title)} · ${sessionLanguage(session.text)}`;
  if (!summary) return `${head}\nNo summary yet. Search or read its transcript instead.`;

  const lines = [
    head,
    `Synopsis: ${oneLine(summary.synopsis)}`,
    `Overview: ${oneLine(summary.overview)}`,
  ];
  if (summary.respondents.length) {
    lines.push('Respondents:');
    for (const r of summary.respondents) {
      const attributes = r.attributes.map((a) => `${oneLine(a.field)}: ${oneLine(a.value)}`);
      lines.push(`- ${oneLine(r.label)}${attributes.length ? ` (${attributes.join('; ')})` : ''}`);
    }
  }
  if (summary.researchQuestions.length) {
    lines.push('Research questions:');
    summary.researchQuestions.forEach((q, i) =>
      lines.push(
        `${i + 1}. ${oneLine(q.question)}: ${oneLine(q.finding)}${turnRefs(key, q.turnIds)}`,
        ...quoteLines(key, q.quotes, '   '),
      ),
    );
  }
  if (summary.themes.length) {
    lines.push('Themes:');
    for (const t of summary.themes) {
      lines.push(
        `- ${oneLine(t.name)}: ${oneLine(t.description)}${turnRefs(key, t.turnIds)}`,
        ...quoteLines(key, t.quotes, '  '),
      );
    }
  }
  return lines.join('\n');
}

function summariesTool(corpus: CorpusReader, budget: AgentBudget): AgentTool {
  return defineTool({
    name: 'get_summaries',
    description: `The full summaries of up to ${AGENT_LIMITS.summariesPerCall} sessions: overview, respondents, findings per research question, and themes, each with quotes already checked against the transcript. This counts against your summary budget.`,
    input: SummariesInput,
    async run(input): Promise<ToolResult> {
      const keys = [...new Set(input.sessions.map((k) => k.trim().toLowerCase()))];
      if (keys.length === 0) throw new Error('Give at least one session key.');
      if (keys.length > AGENT_LIMITS.summariesPerCall) {
        throw new Error(`At most ${AGENT_LIMITS.summariesPerCall} sessions per call.`);
      }
      const sessions = keys.map((key) => sessionFor(corpus, key));

      // Whole summaries, in the order asked for, until the next one would pass the budget (D45).
      const shown: CorpusSession[] = [];
      const texts: string[] = [];
      for (const session of sessions) {
        const text = summaryText(session);
        const tokens = estimateTokens(text);
        if (budget.summaryTokens + tokens > budget.limits.summaryTokens) break;
        budget.summaryTokens += tokens;
        shown.push(session);
        texts.push(text);
      }

      if (shown.length === 0) {
        return { content: SUMMARY_BUDGET_REACHED, activity: 'Summary budget reached' };
      }
      const left = sessions.slice(shown.length).map((s) => s.key);
      return {
        content: [
          ...texts,
          ...(left.length ? [`${SUMMARY_BUDGET_REACHED} Not shown: ${left.join(', ')}.`] : []),
        ].join('\n\n'),
        activity: `Read the summaries of ${shown.map((s) => oneLine(s.title)).join(', ')}`,
      };
    },
  });
}

// --- read_transcript ----------------------------------------------------------------------------------------

const ReadInput = z.object({
  session: z.string().describe('The session key, e.g. "s12".'),
  around: z.string().optional().describe('A turn id, e.g. "t412".'),
  before: z.number().int().nonnegative().optional().describe('Turns before `around`.'),
  after: z.number().int().nonnegative().optional().describe('Turns after `around`.'),
  from: z.string().optional().describe('The first turn id to read.'),
  to: z.string().optional().describe('The last turn id to read.'),
  original: z.boolean().optional().describe('Read the original language instead of English.'),
});

const READ_DESCRIPTION = `Read turns of one session in English, or in the original language with original: true. Pass around (a turn id) to read ${AGENT_LIMITS.windowTurns} turns either side, or before / after to change that, or from and to turn ids. Pass neither to read the whole session. This counts against your reading budget.`;

type ReadInputType = z.infer<typeof ReadInput>;

function turnRange(session: CorpusSession, input: ReadInputType): [number, number] {
  const last = session.text.turns.length - 1;
  if (input.around !== undefined) {
    const at = turnIndex(session, input.around);
    const before = input.before ?? AGENT_LIMITS.windowTurns;
    const after = input.after ?? AGENT_LIMITS.windowTurns;
    return [Math.max(0, at - before), Math.min(last, at + after)];
  }
  const from = input.from === undefined ? 0 : turnIndex(session, input.from);
  const to = input.to === undefined ? last : turnIndex(session, input.to);
  return from <= to ? [from, to] : [to, from];
}

function readTool(corpus: CorpusReader, budget: AgentBudget): AgentTool {
  return defineTool({
    name: 'read_transcript',
    description: READ_DESCRIPTION,
    input: ReadInput,
    async run(input): Promise<ToolResult> {
      const session = sessionFor(corpus, input.session);
      const { text } = session;
      const title = oneLine(session.title);
      if (text.turns.length === 0) {
        return { content: `${session.key} · ${title} has no turns.`, activity: `Read ${title}` };
      }
      const [from, to] = turnRange(session, input);

      const english = !input.original;
      const untranslated = english && text.turns.every((turn) => englishText(text, turn) === null);
      const language = languageOrUnknown(text.languageCode);
      // In a translated session, a turn changed since the translation has no English (DECISIONS.md D39): its line
      // is the original, marked as in search results.
      const isOriginal = (turn: SessionTurn) =>
        english && !untranslated && englishText(text, turn) === null;
      const lineOf = (turn: SessionTurn) =>
        turnLine(
          text,
          turn,
          (english ? englishText(text, turn) : null) ?? turn.text,
          isOriginal(turn),
        );
      let marked = false;

      const lines: string[] = [];
      let spent = false;
      let lastShown = from - 1;
      for (let i = from; i <= to; i++) {
        const turn = text.turns[i];
        if (!turn) break;
        const line = lineOf(turn);
        const tokens = estimateTokens(line);
        if (budget.transcriptTokens + tokens > budget.limits.transcriptTokens) {
          spent = true;
          break;
        }
        budget.transcriptTokens += tokens;
        lines.push(line);
        lastShown = i;
        if (isOriginal(turn)) marked = true;
      }

      if (lines.length === 0) {
        return { content: READING_BUDGET_REACHED, activity: 'Reading budget reached' };
      }
      const first = text.turns[from];
      const shownLast = text.turns[lastShown];
      const range = `${first?.id}–${shownLast?.id}`;
      const version = !english
        ? `${language} (original)`
        : untranslated
          ? `${language}, not translated yet: the original text, which can't be quoted`
          : marked
            ? `English, except turns marked (original): changed since the translation, so they can't be quoted`
            : 'English';
      const header = `${session.key} · ${title} · turns ${range} of ${text.turns.length} · ${version}`;
      const times = `${formatTimestamp(first?.start ?? 0)}–${formatTimestamp(shownLast?.start ?? 0)}`;
      return {
        content: [header, ...lines, ...(spent ? [READING_BUDGET_REACHED] : [])].join('\n'),
        activity: `Read ${title} ${times}${input.original ? ' (original)' : ''}`,
      };
    },
  });
}

// --- list_themes --------------------------------------------------------------------------------------------

function themesTool(corpus: CorpusReader): AgentTool {
  return defineTool({
    name: 'list_themes',
    description: 'Every theme in the session summaries, with the sessions that have it.',
    input: z.object({}),
    async run(): Promise<ToolResult> {
      const summarised = corpus.sessions.filter((s) => s.summary !== null);
      const vocabulary = themeVocabulary(summarised.flatMap((s) => (s.summary ? [s.summary] : [])));
      if (vocabulary.length === 0) {
        return {
          content: 'No session has a summary yet, so there are no themes.',
          activity: 'No themes yet',
        };
      }
      const keysByTheme = new Map<string, string[]>();
      for (const session of summarised) {
        const themes = new Set(session.summary?.themes.map((t) => themeKey(t.name)));
        for (const theme of themes) {
          const keys = keysByTheme.get(theme) ?? [];
          keys.push(session.key);
          keysByTheme.set(theme, keys);
        }
      }
      const lines = [
        `${plural(vocabulary.length, 'theme')} in ${plural(summarised.length, 'summary', 'summaries')}, most used first`,
        ...vocabulary.map(
          (t) =>
            `${oneLine(t.name)} (${t.count}): ${(keysByTheme.get(themeKey(t.name)) ?? []).join(', ')}`,
        ),
      ];
      return {
        content: lines.join('\n'),
        activity: `Listed ${plural(vocabulary.length, 'theme')}`,
      };
    },
  });
}

/** Estimated tokens in thousands, rounded down, and never below 0: `212k`. */
const thousands = (tokens: number) => `${Math.floor(Math.max(0, tokens) / 1000)}k`;

/** `reading budget 212k of 250k tokens` */
const tokensLeft = (name: string, used: number, limit: number) =>
  `${name} ${thousands(limit - used)} of ${thousands(limit)} tokens`;

/**
 * What's left of the question's budgets, as the last line of every result that runs (D46), so the model can plan
 * its remaining calls rather than be cut off part-way. It goes in the conversation, not in the cached prefix: the
 * instructions and the tool descriptions don't mention it, so it has to make sense on its own.
 */
export function budgetNote(budget: AgentBudget): string {
  const { limits } = budget;
  const calls = Math.max(0, limits.toolCalls - budget.toolCalls);
  const head = `Left for this question: ${calls} of ${limits.toolCalls} tool calls`;
  if (calls === 0) return `${head}. Answer now.`;
  return [
    head,
    tokensLeft('reading budget', budget.transcriptTokens, limits.transcriptTokens),
    tokensLeft('summary budget', budget.summaryTokens, limits.summaryTokens),
  ].join(' · ');
}

/**
 * Wraps a tool so that every result that runs ends with the budget note, and once the question has made its last
 * call, every call says to answer. A tool that throws gets no note: its message is also its activity line in the
 * chat. The next result that runs shows the count.
 */
function counted(tool: AgentTool, budget: AgentBudget): AgentTool {
  return {
    ...tool,
    async run(input, signal) {
      budget.toolCalls++;
      if (budget.toolCalls > budget.limits.toolCalls) {
        return { content: TOOL_BUDGET_REACHED, activity: 'Tool budget reached' };
      }
      const result = await tool.run(input, signal);
      // After the await: the loop starts a reply's calls together (`Promise.all` in agentLoop.ts), and each tool
      // counts and spends before its first await, so every result of a reply shows what's left after all of them.
      return { ...result, content: `${result.content}\n\n${budgetNote(budget)}` };
    },
  };
}

/** The four tools, always in this order (the request's tools are part of the cached prefix). */
export function createAgentTools(corpus: CorpusReader, budget: AgentBudget): AgentTool[] {
  return [
    searchTool(corpus),
    summariesTool(corpus, budget),
    readTool(corpus, budget),
    themesTool(corpus),
  ].map((tool) => counted(tool, budget));
}
