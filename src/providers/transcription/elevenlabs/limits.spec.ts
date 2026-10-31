import { describe, expect, it } from 'vitest';
import { ELEVENLABS_LIMITS } from './limits';

describe('ELEVENLABS_LIMITS.keyterms', () => {
  it('lists exactly the characters the API reference rejects', () => {
    expect([...ELEVENLABS_LIMITS.keyterms.forbiddenChars]).toEqual([
      '<',
      '>',
      '{',
      '}',
      '[',
      ']',
      '\\',
    ]);
  });

  it('keeps terms under 50 characters, as the API reference requires', () => {
    expect(ELEVENLABS_LIMITS.keyterms.maxChars).toBe(49);
  });
});
