// The project context the agent sees in every request (PROJECTS.md §5.5): the brief and one card per session.
// Rendered once per conversation and cached by the API, so the same input must give the same bytes.
import type { ProjectBrief } from '../../domain/project';
import { briefLines } from '../summary/prompt';
import type { CorpusReader, CorpusSession } from './corpus';
import { oneLine, recordingDate, sessionLanguage, sessionLength } from './format';

function card(session: CorpusSession): string[] {
  const { text, summary } = session;
  const head = [
    session.key,
    recordingDate(text.recordedAt),
    sessionLength(text.durationSec),
    sessionLanguage(text),
    oneLine(session.title),
  ].join(' · ');
  if (!summary) return [`${head} (no summary yet)`];

  const lines = [head];
  const respondents = summary.respondents.map((r) => {
    const attributes = r.attributes.map((a) => `${oneLine(a.field)}: ${oneLine(a.value)}`);
    return attributes.length ? `${oneLine(r.label)} (${attributes.join('; ')})` : oneLine(r.label);
  });
  if (respondents.length) lines.push(`  Respondents: ${respondents.join(', ')}`);
  const themes = summary.themes.map((t) => oneLine(t.name)).filter(Boolean);
  if (themes.length) lines.push(`  Themes: ${themes.join('; ')}`);
  const synopsis = oneLine(summary.synopsis);
  if (synopsis) lines.push(`  Synopsis: ${synopsis}`);
  return lines;
}

export function renderContext(
  projectName: string,
  brief: ProjectBrief,
  corpus: CorpusReader,
): string {
  const lines: string[] = [];
  const name = oneLine(projectName);
  if (name) lines.push(`Project: ${name}`);
  lines.push(...briefLines(brief));
  if (lines.length) lines.push('');
  lines.push(`Sessions (${corpus.sessions.length}): key · date · length · language · title`);
  for (const session of corpus.sessions) lines.push(...card(session));
  return lines.join('\n');
}
