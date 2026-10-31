/** Number of speaker colours in tokens.css (`--speaker-1` … `--speaker-10`). */
export const SPEAKER_COLOR_COUNT = 10;

/** The colour for the speaker at `index` (0-based, order of first appearance), cycling after 10 speakers.
 * For marks only (dots, swatches, bars), not text: see tokens.css. */
export function speakerColor(index: number): string {
  const i = Number.isInteger(index) && index > 0 ? index % SPEAKER_COLOR_COUNT : 0;
  return `var(--speaker-${i + 1})`;
}
