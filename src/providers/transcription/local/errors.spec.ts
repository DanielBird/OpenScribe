import { describe, expect, it } from 'vitest';
import { LocalSttError, type LocalErrorKind } from './bridge';
import { toProviderError } from './errors';

const err = (kind: LocalErrorKind, detail = 'x') =>
  toProviderError(new LocalSttError(kind, detail), 'a.m4a');

describe('toProviderError (local)', () => {
  it('sends the speech models’ failures to Settings, and nothing else', () => {
    for (const kind of ['pack-missing', 'pack-damaged', 'pack-outdated'] as const) {
      expect(err(kind).opts.fixIn).toBe('settings');
      expect(err(kind).kind).toBe('validation');
    }
    for (const kind of ['recording', 'cpu', 'unreadable', 'engine', 'busy'] as const) {
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
    const opus = toProviderError(new LocalSttError('unreadable', ''), 'call.opus');
    expect(opus.userMessage).toContain('Ogg Opus');
  });
});
