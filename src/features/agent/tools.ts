// The project agent's tools (PROJECTS.md §5.5). They only read the corpus: none can write a file or reach the
// network. Each returns compact text for the model and one activity line for the UI. The budgets are enforced
// here, per question (A18).
import { parseQuery } from '../../domain/corpus/query';
import type { SearchField, SessionHits } from '../../domain/corpus/search';
import { englishText, type SessionTurn } from '../../domain/corpus/sessionText';
import type { SummaryQuote } from '../../domain/summary';
import { formatTimestamp, languageName } from '../../domain/transcript';
import { z } from '../../lib/zod';
import type { AgentTool } from '../../providers/llm/types';
import { themeKey, themeVocabulary } from '../summary/themes';
import type { CorpusReader, CorpusSession } from './corpus';
import { oneLine, sessionLanguage, speakerLabel, turnLine } from './format';
import { AGENT_LIMITS, estimateTokens } from './limits';

export const TOOL_BUDGET_REACHED = 'Tool budget reached. Answer now.';
export const READING_BUDGET_REACHED = 'Reading budget reached. Answer from what you have.';

/** What a question has used so far. Make a fresh one per question. */
export interface AgentBudget {
  toolCalls: number;
  transcriptTokens: number;
}

export function createBudget(): AgentBudget {
  return { toolCalls: 0, transcriptTokens: 0 };
}

/** A budget with nothing left, so every tool says to answer: for the summary of `/compact` (Phase 22). */
export function spentBudget(): AgentBudget {
  return {
    toolCalls: AGENT_LIMITS.toolCallsPerQuestion,
    transcriptTokens: AGENT_LIMITS.transcriptTokensPerQuestion,
  };
}

type ToolResult = Awaited<ReturnType<AgentTool['run']>>;

/** Sessions per page of search results: as many as fit the per-call hit cap at the per-session cap. */
const SESSIONS_PER_PAGE = AGENT_LIMITS.hitsPerCall / AGENT_LIMITS.hitsPerSession;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

function summariesTool(corpus: CorpusReader): AgentTool {
  return defineTool({
    name: 'get_summaries',
    description: `The full summaries of up to ${AGENT_LIMITS.summariesPerCall} sessions: overview, respondents, findings per research question, and themes, each with quotes already checked against the transcript.`,
    input: SummariesInput,
    async run(input): Promise<ToolResult> {
      const keys = [...new Set(input.sessions.map((k) => k.trim().toLowerCase()))];
      if (keys.length === 0) throw new Error('Give at least one session key.');
      if (keys.length > AGENT_LIMITS.summariesPerCall) {
        throw new Error(`At most ${AGENT_LIMITS.summariesPerCall} sessions per call.`);
      }
      const sessions = keys.map((key) => sessionFor(corpus, key));
      return {
        content: sessions.map(summaryText).join('\n\n'),
        activity: `Read the summaries of ${sessions.map((s) => oneLine(s.title)).join(', ')}`,
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
      const language = languageName(text.languageCode);
      const version = !english
        ? `${language} (original)`
        : untranslated
          ? `${language}, not translated yet: the original text, which can't be quoted`
          : 'English';
      const lineOf = (turn: SessionTurn) =>
        turnLine(text, turn, (english ? englishText(text, turn) : null) ?? turn.text);

      const lines: string[] = [];
      let spent = false;
      let lastShown = from - 1;
      for (let i = from; i <= to; i++) {
        const turn = text.turns[i];
        if (!turn) break;
        const line = lineOf(turn);
        const tokens = estimateTokens(line);
        if (budget.transcriptTokens + tokens > AGENT_LIMITS.transcriptTokensPerQuestion) {
          spent = true;
          break;
        }
        budget.transcriptTokens += tokens;
        lines.push(line);
        lastShown = i;
      }

      if (lines.length === 0) {
        return { content: READING_BUDGET_REACHED, activity: 'Reading budget reached' };
      }
      const first = text.turns[from];
      const shownLast = text.turns[lastShown];
      const range = `${first?.id}–${shownLast?.id}`;
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

/** Wraps a tool so that once the question has made its last call, every call says to answer. */
function counted(tool: AgentTool, budget: AgentBudget): AgentTool {
  return {
    ...tool,
    run(input, signal) {
      budget.toolCalls++;
      if (budget.toolCalls > AGENT_LIMITS.toolCallsPerQuestion) {
        return Promise.resolve({ content: TOOL_BUDGET_REACHED, activity: 'Tool budget reached' });
      }
      return tool.run(input, signal);
    },
  };
}

/** The four tools, always in this order (the request's tools are part of the cached prefix). */
export function createAgentTools(corpus: CorpusReader, budget: AgentBudget): AgentTool[] {
  return [
    searchTool(corpus),
    summariesTool(corpus),
    readTool(corpus, budget),
    themesTool(corpus),
  ].map((tool) => counted(tool, budget));
}
