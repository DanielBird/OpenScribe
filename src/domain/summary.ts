// A session summary (PROJECTS.md §5.3, DECISIONS.md D21): what the project model writes about one session, after the
// app's check, and the file it is saved in. Turn ids in a summary always exist in the transcript it was made from.
import type { LlmProviderId } from './transcript';

export const SUMMARY_SCHEMA_VERSION = 1 as const;

/** The finding for a research question the session doesn't touch. */
export const NOT_DISCUSSED = 'Not discussed in this session.';

export interface RespondentAttribute {
  field: string; // the brief's metadata fields first, e.g. 'Age', then others
  value: string;
  turnIds: string[];
}

export interface Respondent {
  speakerId: string | null; // null for a person who is mentioned but isn't a speaker
  label: string;
  attributes: RespondentAttribute[];
}

/** A passage that supports a finding or shows a theme. */
export interface SummaryQuote {
  turnId: string;
  text: string; // the transcript's own words once checked (T13)
}

export interface ResearchQuestionFinding {
  question: string; // the brief's wording
  finding: string;
  turnIds: string[];
  quotes: SummaryQuote[]; // none when the question isn't discussed
}

export interface SummaryTheme {
  name: string;
  description: string;
  turnIds: string[];
  isNew: boolean; // false when the name is one the project already uses
  quotes: SummaryQuote[];
}

export interface SessionSummary {
  title: string; // short, e.g. "P07 – home visit, Hamburg"
  synopsis: string; // 2–3 sentences; used in the session card
  overview: string; // 250–500 words
  respondents: Respondent[];
  researchQuestions: ResearchQuestionFinding[]; // one per question in the brief, in its order
  themes: SummaryTheme[];
}

/** `sessions/<base>.summary.json` in the project folder (PROJECTS.md §5.2). */
export interface SessionSummaryFile {
  kind: 'describe.summary';
  schemaVersion: typeof SUMMARY_SCHEMA_VERSION;
  sessionId: string; // TranscriptDoc.id
  createdAt: string; // ISO
  model: string; // the model that was chosen
  provider?: LlmProviderId; // its provider (Phase 19, DECISIONS.md D26); missing = 'claude'
  transcriptHash: string; // of the session text the summary was made from
  briefHash: string; // of the brief it was made with
  droppedQuotes: number; // quotes removed because they weren't verified in the transcript (T13, D44)
  summary: SessionSummary;
}
