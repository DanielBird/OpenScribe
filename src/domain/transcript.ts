// Canonical transcript model (ROADMAP.md §6). This is the contract between all phases:
// UI, export and translation consume TranscriptDoc; provider-specific shapes never leave their folder.

export const TRANSCRIPT_SCHEMA_VERSION = 1 as const;

export type LanguageHint = 'auto' | 'en' | 'de' | 'fr';
export type TranscriptVersion = 'original' | 'en';
export type LlmProviderId = 'claude' | 'gemini';

export interface SourceInfo {
  fileName: string;
  fileSize: number; // bytes
  mimeType: string; // '' if the browser does not know
  lastModified: number; // File.lastModified (ms epoch)
  durationSec: number | null; // probed in the browser; null if unknown
}

export interface TranscriptionRequestInfo {
  provider: 'elevenlabs';
  model: string; // 'scribe_v2'
  languageHint: LanguageHint;
  numSpeakers: number | null; // null = auto
  zeroRetention: boolean;
  keyterms: string[]; // exactly what was sent
}

export interface TranscriptionResultInfo {
  providerTranscriptId: string | null;
  languageCode: string; // as returned by the provider, e.g. 'deu'
  languageProbability: number | null;
  audioDurationSec: number | null;
}

export interface Speaker {
  id: string; // provider speaker id, e.g. 'speaker_0'
  label: string; // user-editable; default 'Speaker 1', 'Speaker 2', …
}

export interface Word {
  text: string;
  start: number; // seconds
  end: number;
  logprob: number | null; // kept for the future AI audit
}

export interface Turn {
  id: string; // 't1', 't2', … stable within a doc
  speakerId: string;
  start: number; // seconds
  end: number;
  text: string;
  words: Word[];
}

export interface Translation {
  provider: LlmProviderId;
  model: string;
  createdAt: string; // ISO
  texts: Record<string, string>; // turnId → translated text (complete for all turns)
}

export interface TranscriptDoc {
  schemaVersion: typeof TRANSCRIPT_SCHEMA_VERSION;
  id: string; // uuid
  createdAt: string; // ISO
  source: SourceInfo;
  request: TranscriptionRequestInfo;
  result: TranscriptionResultInfo;
  speakers: Speaker[]; // in order of first appearance
  turns: Turn[]; // chronological
  translations: { en?: Translation };
}

/** Seconds → `HH:MM:SS`. Floors fractions; negative or non-finite input shows as 00:00:00. */
export function formatTimestamp(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * ISO date-time → "13 Oct 2026, 14:05" (en-GB, the viewer's time zone unless `timeZone` is given).
 * An invalid date is returned unchanged.
 */
export function formatDateTime(iso: string, opts: { timeZone?: string } = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: opts.timeZone,
  }).format(date);
}

/**
 * A date as ms since the epoch → "13 Oct 2026" (en-GB, the viewer's time zone unless `timeZone` is given).
 * An invalid date gives ''.
 */
export function formatDate(ms: number, opts: { timeZone?: string } = {}): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: opts.timeZone }).format(
    date,
  );
}

const LANGUAGE_ALIASES: Record<string, string> = {
  en: 'en',
  eng: 'en',
  de: 'de',
  deu: 'de',
  ger: 'de',
  fr: 'fr',
  fra: 'fr',
  fre: 'fr',
};

/**
 * Maps the language codes we support (ISO 639-1/-2/-3, optionally with a region such as `en-GB`) to
 * ISO 639-1. Any other code is returned lower-cased and otherwise unchanged.
 */
export function normalizeLanguage(code: string): string {
  const lower = code.trim().toLowerCase();
  const base = lower.split(/[-_]/)[0] ?? lower;
  return LANGUAGE_ALIASES[lower] ?? LANGUAGE_ALIASES[base] ?? lower;
}

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', de: 'German', fr: 'French' };

/** 'English' | 'German' | 'French' for the supported languages, otherwise the code upper-cased. */
export function languageName(code: string): string {
  return LANGUAGE_NAMES[normalizeLanguage(code)] ?? code.trim().toUpperCase();
}

/** Default label for the speaker at `index` (0-based, in order of first appearance). */
export function defaultSpeakerLabel(index: number): string {
  return `Speaker ${index + 1}`;
}

/** A run of whitespace with at least one line break in it (`\s` includes U+2028 and U+2029). */
const LINE_BREAK_RUN = /\s*[\r\n\u2028\u2029]\s*/g;

/** Each run of whitespace that contains a line break becomes one space. Nothing is trimmed. */
export function joinLines(text: string): string {
  return text.replace(LINE_BREAK_RUN, ' ');
}

/**
 * Turn text as it is saved (DECISIONS.md D19): line breaks become single spaces, and leading and
 * trailing whitespace is removed. Other spaces stay as typed.
 */
export function cleanTurnText(text: string): string {
  return joinLines(text).trim();
}
