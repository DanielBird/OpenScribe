import { describe, expect, it } from 'vitest';
import { checkFile, formatBytes } from './filecheck';

const LIMITS = { maxFileBytes: 3 * 1024 ** 3, maxDurationSec: 10 * 3600, minDurationSec: 0.1 };
const file = (overrides: Partial<Parameters<typeof checkFile>[0]> = {}) => ({
  name: 'interview.mp3',
  size: 5 * 1024 ** 2,
  type: 'audio/mpeg',
  durationSec: 600,
  ...overrides,
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [23.4 * 1024 ** 2, '23.4 MB'],
    [3 * 1024 ** 3, '3.0 GB'],
  ])('%s → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('checkFile', () => {
  it('accepts a normal recording without errors or warnings', () => {
    expect(checkFile(file(), LIMITS)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('rejects an empty file', () => {
    const result = checkFile(file({ size: 0, durationSec: null }), LIMITS);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['The file is empty. Choose another file.']);
  });

  it('rejects a file over the size limit and says how large it is', () => {
    const result = checkFile(file({ size: 3.5 * 1024 ** 3 }), LIMITS);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('too large (3.5 GB)');
    expect(result.errors[0]).toContain('The limit is 3.0 GB');
  });

  it('accepts a file exactly at the size limit', () => {
    expect(checkFile(file({ size: LIMITS.maxFileBytes }), LIMITS).ok).toBe(true);
  });

  it('rejects a recording over the duration limit', () => {
    const result = checkFile(file({ durationSec: 10 * 3600 + 1 }), LIMITS);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('too long (10:00:01)');
    expect(result.errors[0]).toContain('The limit is 10:00:00');
  });

  it('rejects a recording under the minimum duration', () => {
    const result = checkFile(file({ durationSec: 0.05 }), LIMITS);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      'The recording is too short. It must be at least 0.1 seconds long.',
    ]);
  });

  it('warns, but allows, when the duration is unknown', () => {
    const result = checkFile(file({ durationSec: null }), LIMITS);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      "The recording's length couldn't be read. You can still try to transcribe it.",
    ]);
  });

  it('warns about an unusual extension', () => {
    const result = checkFile(file({ name: 'notes.txt', type: 'text/plain' }), LIMITS);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      '".txt" files are not a usual audio or video format, so the transcription may fail.',
    ]);
  });

  it('warns about a missing extension', () => {
    const result = checkFile(file({ name: 'recording', type: '' }), LIMITS);
    expect(result.warnings).toEqual([
      'The file has no extension, so it may not be an audio or video file.',
    ]);
  });

  it('accepts every allow-listed extension, case-insensitively', () => {
    for (const ext of [
      'MP3',
      'm4a',
      'wav',
      'aac',
      'flac',
      'ogg',
      'opus',
      'webm',
      'MP4',
      'mov',
      'mkv',
      'wma',
      'aiff',
    ]) {
      expect(checkFile(file({ name: `a.${ext}`, type: '' }), LIMITS).warnings).toEqual([]);
    }
  });

  it('does not warn about an unlisted extension when the browser reports an audio or video type', () => {
    expect(checkFile(file({ name: 'book.m4b', type: 'audio/mp4' }), LIMITS).warnings).toEqual([]);
  });

  it('can report several problems at once', () => {
    const result = checkFile(
      file({ name: 'huge.bin', type: '', size: 4 * 1024 ** 3, durationSec: 11 * 3600 }),
      LIMITS,
    );
    expect(result.errors).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
  });
});
