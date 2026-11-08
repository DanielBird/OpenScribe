import { describe, expect, it } from 'vitest';
import tokens from './tokens.css?raw';

function readColor(name: string): string {
  const match = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!match?.[1]) throw new Error(`Token --${name} is missing or not a #rrggbb colour`);
  return match[1];
}

// WCAG 2 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens', () => {
  const bg = readColor('color-bg');

  it.each([
    'color-text',
    'color-text-muted',
    'color-accent',
    'color-danger',
    'color-warning',
    'color-success',
  ])('%s has >= 4.5:1 contrast on --color-bg', (name) => {
    expect(contrast(readColor(name), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('form control outlines have >= 3:1 contrast on --color-bg (WCAG 1.4.11)', () => {
    expect(contrast(readColor('color-border-strong'), bg)).toBeGreaterThanOrEqual(3);
  });

  it.each(['color-accent', 'color-accent-hover', 'color-danger', 'color-danger-hover'])(
    'white text on %s has >= 4.5:1 contrast',
    (name) => {
      expect(contrast(readColor('color-on-accent'), readColor(name))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('accent text on a hovered button has >= 4.5:1 contrast', () => {
    expect(
      contrast(readColor('color-accent'), readColor('color-button-hover')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('warning text on the warning background has >= 4.5:1 contrast', () => {
    expect(
      contrast(readColor('color-warning'), readColor('color-warning-bg')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('text on the search highlight has >= 4.5:1 contrast', () => {
    expect(contrast(readColor('color-text'), readColor('color-highlight'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
