import { describe, expect, it } from 'vitest';
import {
  BASE_NAME_MAX,
  classifySessionFile,
  sessionBaseName,
  sessionFileName,
} from './sessionFiles';

const ID = '3f9a1c2e-1111-4222-8333-444455556666';

describe('sessionBaseName', () => {
  it('drops the extension, turns spaces into dashes and adds the id', () => {
    expect(sessionBaseName('P07 Hamburg home visit.wav', ID)).toBe(
      'P07-Hamburg-home-visit--3f9a1c2e',
    );
  });

  it('removes accents and spells ß as ss', () => {
    expect(sessionBaseName('Zoë Müller – Straße, Café.m4a', ID)).toBe(
      'Zoe-Muller-Strasse-Cafe--3f9a1c2e',
    );
  });

  it('keeps letters in other scripts, digits, dashes and underscores', () => {
    expect(sessionBaseName('Интервью_02 東京-a.mp3', ID)).toBe('Интервью_02-東京-a--3f9a1c2e');
  });

  it('collapses runs of other characters and trims dashes at the ends', () => {
    expect(sessionBaseName('  (P07)  ...  notes!!.wav', ID)).toBe('P07-notes--3f9a1c2e');
    expect(sessionBaseName('a -- b.wav', ID)).toBe('a-b--3f9a1c2e');
  });

  it('never keeps a dot, so the kind can be found after the base', () => {
    const base = sessionBaseName('v1.2 final.take.wav', ID);
    expect(base).toBe('v1-2-final-take--3f9a1c2e');
    expect(base).not.toContain('.');
  });

  it('cuts the recording part at 60 characters, without a trailing dash', () => {
    const long = `${'abcdefghi '.repeat(10)}.wav`;
    const base = sessionBaseName(long, ID);
    const part = base.slice(0, base.indexOf('--'));
    expect([...part].length).toBeLessThanOrEqual(BASE_NAME_MAX);
    expect(part.endsWith('-')).toBe(false);
    expect(part.startsWith('abcdefghi-abcdefghi')).toBe(true);
  });

  it('cuts by characters, never inside a surrogate pair', () => {
    const base = sessionBaseName(`${'𠮷'.repeat(70)}.wav`, ID);
    expect([...base.slice(0, base.indexOf('--'))]).toHaveLength(BASE_NAME_MAX);
    expect(base).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('falls back to "session" when nothing is left', () => {
    expect(sessionBaseName('', ID)).toBe('session--3f9a1c2e');
    expect(sessionBaseName('!!! ???.wav', ID)).toBe('session--3f9a1c2e');
    expect(sessionBaseName('.wav', ID)).toBe('wav--3f9a1c2e');
  });
});

describe('classifySessionFile', () => {
  it('reads transcripts and summaries', () => {
    const base = sessionBaseName('P07 Hamburg.wav', ID);
    expect(classifySessionFile(sessionFileName(base, 'transcript'))).toEqual({
      kind: 'transcript',
      base,
      conflictCopy: false,
    });
    expect(classifySessionFile(`${base}.summary.json`)).toEqual({
      kind: 'summary',
      base,
      conflictCopy: false,
    });
  });

  it('marks conflict copies: OneDrive puts the device name before .json, Explorer adds " - Copy"', () => {
    expect(classifySessionFile('x--3f9a1c2e.summary-Aristotle.json')).toEqual({
      kind: 'summary',
      base: 'x--3f9a1c2e',
      conflictCopy: true,
    });
    expect(classifySessionFile('x--3f9a1c2e.transcript-LAPTOP-123.json')?.conflictCopy).toBe(true);
    expect(classifySessionFile('x--3f9a1c2e.summary - Copy.json')?.conflictCopy).toBe(true);
    expect(classifySessionFile('x--3f9a1c2e.transcript.old.json')?.conflictCopy).toBe(true);
  });

  it('ignores the case of the kind and the extension', () => {
    expect(classifySessionFile('x--3f9a1c2e.Transcript.JSON')?.kind).toBe('transcript');
  });

  it('ignores swap files, temporary files and anything else', () => {
    for (const name of [
      'x--3f9a1c2e.transcript.json.crswap',
      'x--3f9a1c2e.summary.json.txt',
      'x--3f9a1c2e.json',
      'x--3f9a1c2e.notes.json',
      '.transcript.json',
      'describe-project.json',
      'desktop.ini',
      '~$x.transcript.json.tmp',
    ]) {
      expect(classifySessionFile(name), name).toBeNull();
    }
  });
});
