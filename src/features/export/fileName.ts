import { languageName, type TranscriptDoc, type TranscriptVersion } from '../../domain/transcript';

/** Longest base name kept in an export file name, in characters (code points). */
export const MAX_BASE_LENGTH = 120;

/** `interview.final.mp3` → `interview.final`. A name that is only an extension (`.mp3`) is kept whole. */
export function fileBaseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

// Characters Windows doesn't allow in file names, plus control characters.
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * `<base> - transcript (German).docx`, safe to save on Windows. An original whose language isn't known is
 * `<base> - transcript.docx`.
 */
export function exportFileName(doc: TranscriptDoc, version: TranscriptVersion): string {
  const safe = fileBaseName(doc.source.fileName).replace(UNSAFE, '_').trim();
  const base = Array.from(safe).slice(0, MAX_BASE_LENGTH).join('').trim() || 'Untitled';
  const language = version === 'en' ? 'English' : languageName(doc.result.languageCode);
  return language ? `${base} - transcript (${language}).docx` : `${base} - transcript.docx`;
}
