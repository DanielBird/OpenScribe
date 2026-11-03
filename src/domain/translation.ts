// Which turns of an English translation are still current (DECISIONS.md D39). A translation keeps the hash of each
// turn's text as it was translated; a turn whose text has changed since has English that is out of date.
import { hashText } from './hash';
import { normalizeLanguage, type Translation, type TranscriptDoc, type Turn } from './transcript';

/** The English texts of a translation, and what they were made from. */
export type TranslationTexts = Pick<Translation, 'texts' | 'sourceHashes'>;

/** The hash of each turn's text, by turn id: what a translation of these turns is made from. */
export function turnSourceHashes(turns: readonly Turn[]): Record<string, string> {
  return Object.fromEntries(turns.map((turn) => [turn.id, hashText(turn.text)]));
}

/**
 * The texts of `english` whose turn still has the text they were translated from. A translation without hashes
 * (from before D39) counts as current: all its texts for these turns are kept.
 */
export function currentTexts(
  english: TranslationTexts,
  turns: readonly Turn[],
): Record<string, string> {
  const { texts, sourceHashes } = english;
  const kept: Record<string, string> = {};
  for (const turn of turns) {
    if (!Object.hasOwn(texts, turn.id)) continue;
    if (sourceHashes && sourceHashes[turn.id] !== hashText(turn.text)) continue;
    kept[turn.id] = texts[turn.id]!;
  }
  return kept;
}

/**
 * The turns whose English translation is out of date: translated from a text that has changed since, or never
 * translated. Empty for an English transcript, and for one without a translation.
 */
export function staleTurnIds(doc: TranscriptDoc): string[] {
  const en = doc.translations.en;
  if (!en || normalizeLanguage(doc.result.languageCode) === 'en') return [];
  const current = currentTexts(en, doc.turns);
  return doc.turns.filter((turn) => !Object.hasOwn(current, turn.id)).map((turn) => turn.id);
}
