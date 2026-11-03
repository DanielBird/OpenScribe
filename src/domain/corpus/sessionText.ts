// A light, text-only view of a transcript for search, session cards and quotes (PROJECTS.md §5.4). It drops the
// word timings, which are most of a transcript file's size.
import { hashParts } from '../hash';
import { normalizeLanguage, type Speaker, type TranscriptDoc } from '../transcript';
import { currentTexts } from '../translation';

export interface SessionTurn {
  id: string;
  speakerId: string;
  start: number; // seconds
  text: string; // original language
  // The English translation; null for English sessions, untranslated ones, and a turn whose text changed since it
  // was translated (DECISIONS.md D39).
  en: string | null;
}

export interface SessionText {
  sessionId: string; // TranscriptDoc.id
  recordingName: string; // doc.source.fileName
  recordedAt: number; // doc.source.lastModified (ms epoch)
  durationSec: number | null; // result.audioDurationSec ?? source.durationSec
  languageCode: string; // doc.result.languageCode
  speakers: Speaker[];
  turns: SessionTurn[];
  transcriptHash: string;
}

function isEnglish(languageCode: string): boolean {
  return normalizeLanguage(languageCode) === 'en';
}

/**
 * The turn texts of the English translation that are still current (DECISIONS.md D39), unless the session is in
 * English (then its text is the English).
 */
function translationTexts(doc: TranscriptDoc): Record<string, string> | null {
  if (isEnglish(doc.result.languageCode)) return null;
  const en = doc.translations.en;
  return en ? currentTexts(en, doc.turns) : null;
}

export function toSessionText(doc: TranscriptDoc): SessionText {
  const texts = translationTexts(doc);
  return {
    sessionId: doc.id,
    recordingName: doc.source.fileName,
    recordedAt: doc.source.lastModified,
    durationSec: doc.result.audioDurationSec ?? doc.source.durationSec,
    languageCode: doc.result.languageCode,
    speakers: doc.speakers.map(({ id, label }) => ({ id, label })),
    turns: doc.turns.map((turn) => ({
      id: turn.id,
      speakerId: turn.speakerId,
      start: turn.start,
      text: turn.text,
      en: texts?.[turn.id] ?? null,
    })),
    transcriptHash: hashOf(doc, texts),
  };
}

/**
 * A hash of what a summary is made from: the speaker labels and every turn's id, speaker, text and current English
 * text. A rename, a text edit or a new translation changes it; word timings, playback and the view don't.
 */
export function transcriptHash(doc: TranscriptDoc): string {
  return hashOf(doc, translationTexts(doc));
}

function hashOf(doc: TranscriptDoc, texts: Record<string, string> | null): string {
  const parts = [String(doc.speakers.length), texts ? 'en' : ''];
  for (const speaker of doc.speakers) parts.push(speaker.id, speaker.label);
  for (const turn of doc.turns) {
    parts.push(turn.id, turn.speakerId, turn.text, texts?.[turn.id] ?? '');
  }
  return hashParts(parts);
}

export function isEnglishSession(session: SessionText): boolean {
  return isEnglish(session.languageCode);
}

/**
 * The English text of a turn: its translation, or its own text in an English session. In another language, a turn
 * without a translation, or changed since it was translated, has no English text (`null`).
 */
export function englishText(session: SessionText, turn: SessionTurn): string | null {
  return turn.en ?? (isEnglishSession(session) ? turn.text : null);
}

/** True when the session isn't in English and some turn has no English text: it needs translating first. */
export function lacksEnglish(session: SessionText): boolean {
  return !isEnglishSession(session) && session.turns.some((turn) => turn.en === null);
}

/** True when the session isn't in English and has an English translation. */
export function isTranslatedSession(session: SessionText): boolean {
  return !isEnglishSession(session) && session.turns.some((turn) => turn.en !== null);
}
