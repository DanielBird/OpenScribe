import { describe, expect, it } from 'vitest';
import type { TranscriptionInput } from '../types';
import { buildFormData, buildUrl } from './request';

const file = new File(['RIFF'], 'meeting.wav', { type: 'audio/wav' });
const input = (overrides: Partial<TranscriptionInput> = {}): TranscriptionInput => ({
  file,
  apiKey: 'sk_test_SENTINEL_0123456789',
  languageHint: 'auto',
  numSpeakers: null,
  zeroRetention: false,
  keyterms: [],
  ...overrides,
});

/** FormData → [name, value] pairs; files are shown as `File(<name>)`. */
function fields(form: FormData): [string, string][] {
  return [...form.entries()].map(([name, value]) => [
    name,
    typeof value === 'string' ? value : `File(${value.name})`,
  ]);
}

const ALWAYS: [string, string][] = [
  ['model_id', 'scribe_v2'],
  ['file', 'File(meeting.wav)'],
  ['diarize', 'true'],
  ['timestamps_granularity', 'word'],
  ['tag_audio_events', 'false'],
  ['no_verbatim', 'true'],
];

describe('buildFormData', () => {
  it('sends only the fixed fields for Auto language, Auto speakers and an empty glossary', () => {
    expect(fields(buildFormData(input()))).toEqual(ALWAYS);
  });

  it('adds language_code when a language is chosen', () => {
    for (const languageHint of ['en', 'de', 'fr'] as const) {
      const form = buildFormData(input({ languageHint }));
      expect(form.getAll('language_code')).toEqual([languageHint]);
    }
  });

  it('adds num_speakers when a number is set', () => {
    expect(buildFormData(input({ numSpeakers: 1 })).getAll('num_speakers')).toEqual(['1']);
    expect(buildFormData(input({ numSpeakers: 32 })).getAll('num_speakers')).toEqual(['32']);
  });

  it('sends each glossary term as a repeated keyterms field, in order (V1 default)', () => {
    const form = buildFormData(input({ keyterms: ['Oticon', 'hearing aid', 'Hörgerät'] }));
    expect(form.getAll('keyterms')).toEqual(['Oticon', 'hearing aid', 'Hörgerät']);
  });

  it('sends exactly the documented fields with every option set', () => {
    const form = buildFormData(
      input({ languageHint: 'de', numSpeakers: 3, keyterms: ['A', 'B'], zeroRetention: true }),
    );
    expect(fields(form)).toEqual([
      ['model_id', 'scribe_v2'],
      ['file', 'File(meeting.wav)'],
      ['language_code', 'de'],
      ['diarize', 'true'],
      ['num_speakers', '3'],
      ['timestamps_granularity', 'word'],
      ['tag_audio_events', 'false'],
      ['no_verbatim', 'true'],
      ['keyterms', 'A'],
      ['keyterms', 'B'],
    ]);
  });

  it('never puts the API key or the zero-retention flag in the body', () => {
    const form = buildFormData(input({ zeroRetention: true }));
    const flat = fields(form).flat().join(' ');
    expect(flat).not.toContain('SENTINEL');
    expect(form.has('enable_logging')).toBe(false);
  });
});

describe('buildUrl', () => {
  it('uses the plain endpoint normally', () => {
    expect(buildUrl(false)).toBe('https://api.elevenlabs.io/v1/speech-to-text');
  });

  it('adds enable_logging=false for zero retention', () => {
    expect(buildUrl(true)).toBe('https://api.elevenlabs.io/v1/speech-to-text?enable_logging=false');
  });
});
