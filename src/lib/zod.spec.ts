import { describe, expect, it } from 'vitest';
import { z } from './zod';

describe('lib/zod', () => {
  it('runs zod in jitless mode, so it never needs eval (blocked by our CSP)', () => {
    expect(z.config().jitless).toBe(true);
  });
});
