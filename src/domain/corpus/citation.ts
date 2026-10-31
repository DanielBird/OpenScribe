// The text that **Copy** puts on the clipboard for a quote (PROJECTS.md §5.5):
//   "I just put them on the charger by the bed." — Anna, 00:41:12, P02 – home visit, Lyon (translated from French)
import { formatTimestamp, languageName } from '../transcript';

export interface CitationParts {
  text: string;
  speakerLabel: string;
  start: number;
  sessionTitle: string;
  translatedFrom: string | null; // language code of the original, when the text is a translation
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** One quote with its citation, on one line. */
export function formatCitation(parts: CitationParts): string {
  const translated = parts.translatedFrom
    ? ` (translated from ${languageName(parts.translatedFrom)})`
    : '';
  return (
    `"${oneLine(parts.text)}" — ${oneLine(parts.speakerLabel)}, ${formatTimestamp(parts.start)}, ` +
    `${oneLine(parts.sessionTitle)}${translated}`
  );
}

/** Several quotes, separated by a blank line. */
export function formatCitations(parts: readonly CitationParts[]): string {
  return parts.map(formatCitation).join('\n\n');
}
