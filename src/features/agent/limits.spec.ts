import { describe, expect, it } from 'vitest';
import { estimateTokens } from './limits';

describe('estimateTokens', () => {
  it('counts about 3.5 characters a token in English, German or Spanish text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('I put them on the charger.')).toBe(Math.ceil(26 / 3.5));
    expect(estimateTokens('Lo pongo en el cargador.')).toBe(Math.ceil(24 / 3.5));
  });

  it('counts a token for each Chinese, Japanese or Korean character', () => {
    expect(estimateTokens('毎晩充電します')).toBe(7);
    expect(estimateTokens('침대 옆에서 충전해요')).toBe(Math.ceil(9 + 2 / 3.5));
    // Mixed text: the dense characters, then the rest at 3.5 a token.
    expect(estimateTokens('Oticonの充電器')).toBe(Math.ceil(4 + 6 / 3.5));
  });
});
