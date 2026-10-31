// Normalized tokens → speakers + turns (ROADMAP.md §6, segmentation rules). Provider-agnostic (DECISIONS.md T3).
import type { NormalizedToken } from './tokens';
import { defaultSpeakerLabel, type Speaker, type Turn, type Word } from './transcript';

export const DEFAULT_SPEAKER_ID = 'speaker_0';

export interface SegmentationOptions {
  /** After this many seconds, a turn is split after the next word that ends a sentence. */
  softMaxTurnSec?: number;
  /** If no sentence has ended by this many seconds, the turn is split after the next word. */
  hardMaxTurnSec?: number;
}

interface TimedToken {
  text: string;
  start: number;
  end: number;
  speakerId: string;
  kind: NormalizedToken['kind'];
  logprob: number | null;
}

interface OpenTurn {
  speakerId: string;
  start: number;
  end: number;
  parts: string[];
  words: Word[];
}

// A sentence ends with . ? ! or …, optionally followed by closing quotes or brackets.
const SENTENCE_END = /[.?!…]["'”’»)\]]*$/;

/**
 * Groups tokens into turns. A new turn starts when the speaker changes; spacing tokens never cause a change.
 * Long turns are split so that click-to-play stays useful (see SegmentationOptions).
 */
export function buildTurns(
  tokens: NormalizedToken[],
  opts: SegmentationOptions = {},
): { speakers: Speaker[]; turns: Turn[] } {
  const softMax = opts.softMaxTurnSec ?? 90;
  const hardMax = opts.hardMaxTurnSec ?? 120;

  const turns: Turn[] = [];
  let open: OpenTurn | null = null;
  // Spacing seen since the last word. It joins the open turn only if the next word stays in that turn,
  // so turns never start or end with spacing.
  let pendingSpacing: string[] = [];

  for (const token of fillTimes(tokens)) {
    if (token.kind === 'spacing') {
      if (open) pendingSpacing.push(token.text);
      continue;
    }

    if (open && open.speakerId !== token.speakerId) {
      open = closeTurn(open, turns);
    }
    if (open) {
      open.parts.push(...pendingSpacing);
    } else {
      open = {
        speakerId: token.speakerId,
        start: token.start,
        end: token.end,
        parts: [],
        words: [],
      };
    }
    pendingSpacing = [];

    open.parts.push(token.text);
    open.words.push({
      text: token.text,
      start: token.start,
      end: token.end,
      logprob: token.logprob,
    });
    open.end = Math.max(open.end, token.end);

    const elapsed = token.end - open.start;
    const endsSentence = SENTENCE_END.test(token.text.trim());
    if ((elapsed > softMax && endsSentence) || elapsed > hardMax) {
      open = closeTurn(open, turns);
      pendingSpacing = [];
    }
  }
  closeTurn(open, turns);

  const speakers: Speaker[] = [];
  for (const turn of turns) {
    if (!speakers.some((s) => s.id === turn.speakerId)) {
      speakers.push({ id: turn.speakerId, label: defaultSpeakerLabel(speakers.length) });
    }
  }
  return { speakers, turns };
}

/** Appends the open turn to `turns` (unless its text is only whitespace) and returns null. */
function closeTurn(open: OpenTurn | null, turns: Turn[]): null {
  if (open) {
    const text = open.parts.join('').trim();
    if (text !== '') {
      turns.push({
        id: `t${turns.length + 1}`,
        speakerId: open.speakerId,
        start: open.start,
        end: open.end,
        text,
        words: open.words,
      });
    }
  }
  return null;
}

/**
 * Gives every token a speaker and times. A missing time is taken from the previous token's end, or from the
 * next timed token's start when there is no previous token. `end` is never before `start`.
 */
function fillTimes(tokens: NormalizedToken[]): TimedToken[] {
  const nextStart: (number | null)[] = new Array<number | null>(tokens.length).fill(null);
  let upcoming: number | null = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    nextStart[i] = upcoming;
    const t = tokens[i];
    if (t) upcoming = t.start ?? t.end ?? upcoming;
  }

  const result: TimedToken[] = [];
  let prevEnd: number | null = null;
  tokens.forEach((t, i) => {
    const start = t.start ?? prevEnd ?? nextStart[i] ?? 0;
    const end = Math.max(start, t.end ?? start);
    result.push({
      text: t.text,
      start,
      end,
      speakerId: t.speakerId ?? DEFAULT_SPEAKER_ID,
      kind: t.kind,
      logprob: t.logprob,
    });
    prevEnd = end;
  });
  return result;
}
