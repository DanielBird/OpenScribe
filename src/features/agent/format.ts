// Small text helpers shared by the agent's context and tools. Everything is plain text for the model.
import {
  isEnglishSession,
  isTranslatedSession,
  type SessionText,
  type SessionTurn,
} from '../../domain/corpus/sessionText';
import { formatTimestamp, languageOrUnknown } from '../../domain/transcript';

/** Text on one line: model-facing lines must not be broken by a newline in a title or a turn. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `YYYY-MM-DD` (UTC) of the recording's file date, or `?`. */
export function recordingDate(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '?' : date.toISOString().slice(0, 10);
}

/** `1:12` (hours:minutes), or `?` when the length isn't known. */
export function sessionLength(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '?';
  const minutes = Math.round(sec / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** `English`, `German, translated`, `French, not translated yet` or `Unknown language, translated`. */
export function sessionLanguage(session: SessionText): string {
  const name = languageOrUnknown(session.languageCode);
  if (isEnglishSession(session)) return name;
  return `${name}, ${isTranslatedSession(session) ? 'translated' : 'not translated yet'}`;
}

export function speakerLabel(session: SessionText, speakerId: string): string {
  return oneLine(session.speakers.find((s) => s.id === speakerId)?.label ?? speakerId);
}

/** `t412 [00:41:12] Anna: …`, or `Anna (original): …` for the original text among English (`original`). */
export function turnLine(
  session: SessionText,
  turn: SessionTurn,
  text: string,
  original = false,
): string {
  const speaker = speakerLabel(session, turn.speakerId) + (original ? ' (original)' : '');
  return `${turn.id} [${formatTimestamp(turn.start)}] ${speaker}: ${oneLine(text)}`;
}
