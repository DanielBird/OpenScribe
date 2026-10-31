import { describe, expect, it } from 'vitest';
import { SPEAKER_COLOR_COUNT, speakerColor } from './speakerColor';
import tokens from './styles/tokens.css?raw';

describe('speakerColor', () => {
  it('uses the palette in order and cycles after the last colour', () => {
    expect(speakerColor(0)).toBe('var(--speaker-1)');
    expect(speakerColor(9)).toBe('var(--speaker-10)');
    expect(speakerColor(10)).toBe('var(--speaker-1)');
    expect(speakerColor(21)).toBe('var(--speaker-2)');
  });

  it('falls back to the first colour for an invalid index', () => {
    expect(speakerColor(-1)).toBe('var(--speaker-1)');
    expect(speakerColor(Number.NaN)).toBe('var(--speaker-1)');
  });

  it('matches the number of speaker tokens', () => {
    expect(tokens.match(/--speaker-\d+:/g)).toHaveLength(SPEAKER_COLOR_COUNT);
  });
});
