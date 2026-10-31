// The project brief (PROJECTS.md §5.2, DECISIONS.md D21): what guides every session summary.
import { hashParts } from './hash';

export interface ProjectBrief {
  researchQuestions: string[]; // one per line in the editor
  context: string; // objectives, discussion guide, anything the summariser should know
  metadataFields: string[]; // respondent details to extract, e.g. 'Age', 'Country', 'Hearing aids used'
}

export const EMPTY_BRIEF: ProjectBrief = { researchQuestions: [], context: '', metadataFields: [] };

/**
 * A hash of everything a summary is made with. Any edit changes it, and so does reordering the research questions,
 * because the summary answers them in order. The list lengths keep a question apart from a metadata field.
 */
export function briefHash(brief: ProjectBrief): string {
  return hashParts([
    String(brief.researchQuestions.length),
    ...brief.researchQuestions,
    brief.context,
    String(brief.metadataFields.length),
    ...brief.metadataFields,
  ]);
}

export const PROJECT_SCHEMA_VERSION = 1 as const;

/** `describe-project.json` in the project folder (PROJECTS.md §5.2). */
export interface ProjectFile {
  kind: 'describe.project';
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string; // uuid; also keys the session-text cache
  name: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  brief: ProjectBrief;
}

/** Brief lines as they are saved: trimmed, without empty lines (the prompt and `briefHash` use them as given). */
export function cleanLines(lines: readonly string[]): string[] {
  return lines.map((line) => line.trim()).filter((line) => line !== '');
}
