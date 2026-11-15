// Words and speaker segments from the engine on this computer → NormalizedTokens (DECISIONS.md T3, D51, D53). Rust
// returns the two models' raw results; joining them happens here, where it can be tested.
//
// - Each word goes to the speaker whose segments overlap it most, or to the nearest segment if none does (Phase 33,
//   M7: 98.8 % of words agree with ElevenLabs this way). With no segments at all, everything is one speaker.
// - A lone word between two words of one other speaker follows them, unless its own speaker's segment holds it.
// - The clean-up (on by default, the maintainer 2026-11-15): fillers are dropped and a word one speaker says twice in
//   a row is kept once. Parakeet is verbatim and ElevenLabs isn't (Phase 33, M12).
// - Spacing tokens go between words, as ElevenLabs' response has them, so segmentation treats both the same.
// - Speakers are `speaker_0…` in order of first appearance. Confidence is always 1 here, so `logprob` is null.
import type { NormalizedToken } from '../types';

export interface LocalWord {
  text: string;
  start: number;
  end: number;
  confidence: number | null;
}

export interface LocalSegment {
  speaker: number;
  start: number;
  end: number;
}

export interface MapOptions {
  cleanUp: boolean;
}

/** Fillers dropped by the clean-up. Only sounds, never a word of another language ("er" is German for "he"). */
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'äh', 'ähm', 'öhm', 'euh']);
/** Words that are said twice in a row in ordinary grammar ("I know that that is…", "had had"), so kept. */
const LEGITIMATE_DOUBLES = new Set(['that', 'had']);
/** A segment further than this from a word is never its nearest. */
const NEAREST_WITHIN_SEC = 30;

const SENTENCE_END = /[.?!…]["'”’)\]]*$/;
const TRAILING_PUNCTUATION = /[.,;:?!…]+["'”’)\]]*$/;

/** Lower-case, without punctuation: how two spellings of one word are compared. */
function bare(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, '')
    .replace(/^'+|'+$/g, '');
}

const endsSentence = (text: string) => SENTENCE_END.test(text);

function capitalise(text: string): string {
  const first = text.match(/\p{L}/u);
  if (!first || first.index === undefined) return text;
  const i = first.index;
  return text.slice(0, i) + text.charAt(i).toLocaleUpperCase() + text.slice(i + 1);
}

const startsUpper = (text: string) => {
  const first = text.match(/\p{L}/u)?.[0];
  return (
    first !== undefined &&
    first === first.toLocaleUpperCase() &&
    first !== first.toLocaleLowerCase()
  );
};

interface Placed {
  text: string;
  start: number;
  end: number;
  speaker: number;
  /** Overlap with its own speaker's segments, as a share of its length (0 when assigned by nearness). */
  held: number;
}

/** Words with usable times and text, in order. A word whose end is before its start ends where it starts. */
function usableWords(words: readonly LocalWord[]): LocalWord[] {
  return words
    .filter(
      (w) =>
        Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.text.trim() !== '',
    )
    .map((w) => ({ ...w, text: w.text.trim(), end: Math.max(w.start, w.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function usableSegments(segments: readonly LocalSegment[]): LocalSegment[] {
  return segments
    .filter(
      (s) =>
        Number.isInteger(s.speaker) &&
        s.speaker >= 0 &&
        Number.isFinite(s.start) &&
        Number.isFinite(s.end) &&
        s.end > s.start,
    )
    .sort((a, b) => a.start - b.start);
}

/** Gives each word a speaker: most overlap, else the nearest segment within NEAREST_WITHIN_SEC, else speaker 0. */
function place(words: readonly LocalWord[], segments: readonly LocalSegment[]): Placed[] {
  const placed: Placed[] = [];
  let from = 0; // segments before this end long before the current word (words are in order of start)
  for (const w of words) {
    while (from < segments.length && segments[from]!.end < w.start - NEAREST_WITHIN_SEC) from++;
    const overlapBySpeaker = new Map<number, number>();
    let nearest: { speaker: number; gap: number } | null = null;
    for (let i = from; i < segments.length; i++) {
      const s = segments[i]!;
      if (s.start > w.end + NEAREST_WITHIN_SEC) break;
      const overlap = Math.min(w.end, s.end) - Math.max(w.start, s.start);
      if (overlap > 0)
        overlapBySpeaker.set(s.speaker, (overlapBySpeaker.get(s.speaker) ?? 0) + overlap);
      const gap = Math.max(s.start - w.end, w.start - s.end, 0);
      if (nearest === null || gap < nearest.gap) nearest = { speaker: s.speaker, gap };
    }
    let best: { speaker: number; overlap: number } | null = null;
    for (const [speaker, overlap] of overlapBySpeaker) {
      if (best === null || overlap > best.overlap) best = { speaker, overlap };
    }
    const length = w.end - w.start;
    if (best) {
      const held = length > 0 ? Math.min(1, best.overlap / length) : 1;
      placed.push({ text: w.text, start: w.start, end: w.end, speaker: best.speaker, held });
    } else {
      placed.push({
        text: w.text,
        start: w.start,
        end: w.end,
        speaker: nearest?.speaker ?? 0,
        held: 0,
      });
    }
  }
  return placed;
}

/** A lone word between two words of one other speaker follows them, unless its own segment holds most of it. */
function smooth(placed: Placed[]): void {
  for (let i = 1; i + 1 < placed.length; i++) {
    const [before, word, after] = [placed[i - 1]!, placed[i]!, placed[i + 1]!];
    if (before.speaker === after.speaker && word.speaker !== before.speaker && word.held < 0.5) {
      word.speaker = before.speaker;
      word.held = 0;
    }
  }
}

/** Drops fillers and keeps once a word one speaker says twice in a row (the maintainer's clean-up, D53). */
export function cleanUp(placed: readonly Placed[]): Placed[] {
  const out: Placed[] = [];
  let capitaliseNext = false;
  for (const original of placed) {
    const word = { ...original };
    const prev = out.at(-1);
    const sameSpeaker = prev !== undefined && prev.speaker === word.speaker;
    const startsSentence = !sameSpeaker || endsSentence(prev.text);

    if (FILLERS.has(bare(word.text))) {
      // The filler's sentence end moves to the word before it; its comma goes with it.
      if (sameSpeaker && endsSentence(word.text) && !endsSentence(prev.text)) {
        const end = word.text.match(SENTENCE_END)?.[0] ?? '.';
        prev.text = prev.text.replace(TRAILING_PUNCTUATION, '') + end;
      }
      if (startsSentence && startsUpper(word.text)) capitaliseNext = true;
      continue;
    }
    if (capitaliseNext) {
      if (!startsUpper(word.text)) word.text = capitalise(word.text);
      capitaliseNext = false;
    }
    const key = bare(word.text);
    if (
      sameSpeaker &&
      key !== '' &&
      key === bare(prev.text) &&
      !endsSentence(prev.text) &&
      !LEGITIMATE_DOUBLES.has(key)
    ) {
      // "Yeah Yeah" → "Yeah": the first copy's capitals and start, the last copy's punctuation and end.
      const capitals = startsUpper(prev.text) && !startsUpper(word.text);
      prev.text = capitals ? capitalise(word.text) : word.text;
      prev.end = word.end;
      continue;
    }
    out.push(word);
  }
  return out;
}

/** The engine's words and segments as tokens, with spacing between words. */
export function toTokens(
  words: readonly LocalWord[],
  segments: readonly LocalSegment[],
  options: MapOptions,
): NormalizedToken[] {
  const placed = place(usableWords(words), usableSegments(segments));
  smooth(placed);
  const final = options.cleanUp ? cleanUp(placed) : placed;

  const ids = new Map<number, string>();
  const idOf = (speaker: number) => {
    let id = ids.get(speaker);
    if (id === undefined) {
      id = `speaker_${ids.size}`;
      ids.set(speaker, id);
    }
    return id;
  };

  const tokens: NormalizedToken[] = [];
  final.forEach((w, i) => {
    const speakerId = idOf(w.speaker);
    if (i > 0) {
      const prevEnd = final[i - 1]!.end;
      const at = Math.max(prevEnd, Math.min(w.start, prevEnd));
      tokens.push({
        text: ' ',
        start: at,
        end: Math.max(at, w.start),
        speakerId,
        kind: 'spacing',
        logprob: null,
      });
    }
    tokens.push({
      text: w.text,
      start: w.start,
      end: w.end,
      speakerId,
      kind: 'word',
      logprob: null,
    });
  });
  return tokens;
}
