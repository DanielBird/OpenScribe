import { describe, expect, it } from 'vitest';
import { cardLabel } from './gpuCard';

describe('cardLabel', () => {
  it('names the first card with a name alone, and a later one by its place', () => {
    expect(cardLabel({ name: 'NVIDIA RTX A2000', nth: 0 })).toBe('NVIDIA RTX A2000');
    expect(cardLabel({ name: 'NVIDIA RTX A2000', nth: 1 })).toBe('NVIDIA RTX A2000 (2)');
    expect(cardLabel({ name: 'NVIDIA RTX A2000', nth: 2 })).toBe('NVIDIA RTX A2000 (3)');
  });
});
