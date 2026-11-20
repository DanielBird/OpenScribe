import { describe, expect, it } from 'vitest';
import { LOCAL_ERROR_KINDS, LocalSttError, type LocalErrorKind } from './bridge';
import { toProviderError } from './errors';

const err = (kind: LocalErrorKind, detail = 'x', card: string | null = null) =>
  toProviderError(new LocalSttError(kind, detail), { fileName: 'a.m4a', card });

describe('toProviderError (local)', () => {
  it('sends the speech models’ failures to Settings, and nothing else', () => {
    for (const kind of ['pack-missing', 'pack-damaged', 'pack-outdated'] as const) {
      expect(err(kind).opts.fixIn).toBe('settings');
      expect(err(kind).kind).toBe('validation');
    }
    for (const kind of ['recording', 'cpu', 'unreadable', 'engine', 'busy', 'gpu'] as const) {
      expect(err(kind).opts.fixIn).toBeUndefined();
    }
  });

  it('says what to do when the models are gone', () => {
    expect(err('pack-missing').userMessage).toBe(
      "The speech models aren't on this computer any more. Download them in Settings, or transcribe with ElevenLabs.",
    );
  });

  it('keeps the kind and the detail behind Technical details', () => {
    expect(err('engine', 'exit 0xC0000409').opts.detail).toBe('engine: exit 0xC0000409');
  });

  it('names Ogg Opus when that is the file it can’t read', () => {
    const opus = toProviderError(new LocalSttError('unreadable', ''), {
      fileName: 'call.opus',
      card: null,
    });
    expect(opus.userMessage).toContain('Ogg Opus');
  });

  describe('a failure on a graphics card (Phase 37, decision 6)', () => {
    it('names the card, keeps Try again and offers the processor', () => {
      const gpu = err('gpu', 'ErrorDeviceLost', 'AMD Radeon 740M Graphics');
      expect(gpu.userMessage).toBe(
        'The graphics card (AMD Radeon 740M Graphics) stopped while transcribing.',
      );
      expect(gpu.retryable).toBe(true);
      expect(gpu.opts.retryOn).toBe('processor');
      expect(gpu.opts.detail).toBe('gpu: ErrorDeviceLost');
    });

    it('still reads without the card’s name', () => {
      expect(err('gpu').userMessage).toBe('The graphics card stopped while transcribing.');
    });

    it('is the only failure that offers the processor', () => {
      const offering = LOCAL_ERROR_KINDS.filter((kind) => err(kind).opts.retryOn === 'processor');
      expect(offering).toEqual(['gpu']);
    });
  });
});
