import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboard } from './clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('writeClipboard', () => {
  it('writes the text and resolves true', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(writeClipboard('"Hi" — Anna, 00:00:01, P01')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('"Hi" — Anna, 00:00:01, P01');
  });

  it('resolves false when writing is refused', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      },
    });
    await expect(writeClipboard('x')).resolves.toBe(false);
  });

  it('resolves false without a clipboard', async () => {
    vi.stubGlobal('navigator', {});
    await expect(writeClipboard('x')).resolves.toBe(false);
  });
});
