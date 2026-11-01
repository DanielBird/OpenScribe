import { describe, expect, it } from 'vitest';
import { makeDoc } from '../../testing/transcriptDoc';
import { exportFileName, fileBaseName, MAX_BASE_LENGTH } from './fileName';

/** The German fixture doc with another source file name and/or language. */
function docNamed(fileName: string, languageCode = 'deu') {
  const doc = makeDoc();
  return {
    ...doc,
    source: { ...doc.source, fileName },
    result: { ...doc.result, languageCode },
  };
}

describe('fileBaseName', () => {
  it.each([
    ['interview.mp3', 'interview'],
    ['interview.final.mp3', 'interview.final'],
    ['interview', 'interview'],
    ['.mp3', '.mp3'],
    ['', ''],
  ])('%j → %j', (name, base) => {
    expect(fileBaseName(name)).toBe(base);
  });
});

describe('exportFileName', () => {
  it('names the original by its language and the translation as English', () => {
    expect(exportFileName(docNamed('interview.mp3'), 'original')).toBe(
      'interview - transcript (German).docx',
    );
    expect(exportFileName(docNamed('interview.mp3'), 'en')).toBe(
      'interview - transcript (English).docx',
    );
    expect(exportFileName(docNamed('review.wav', 'eng'), 'original')).toBe(
      'review - transcript (English).docx',
    );
  });

  it('names any language, and uses the code for one it has no name for', () => {
    expect(exportFileName(docNamed('a.mp3', 'ita'), 'original')).toBe(
      'a - transcript (Italian).docx',
    );
    expect(exportFileName(docNamed('a.mp3', 'zzz'), 'original')).toBe('a - transcript (ZZZ).docx');
  });

  it('replaces characters Windows does not allow, and control characters', () => {
    expect(exportFileName(docNamed('a<b>c:d"e/f\\g|h?i*j\tk\u0001l.mp3'), 'original')).toBe(
      'a_b_c_d_e_f_g_h_i_j_k_l - transcript (German).docx',
    );
  });

  it('keeps a name without an extension, and trims spaces', () => {
    expect(exportFileName(docNamed('  Team meeting  '), 'original')).toBe(
      'Team meeting - transcript (German).docx',
    );
  });

  it('keeps a name that is only an extension', () => {
    expect(exportFileName(docNamed('.mp3'), 'original')).toBe('.mp3 - transcript (German).docx');
  });

  it('falls back to "Untitled" when nothing is left', () => {
    expect(exportFileName(docNamed(''), 'original')).toBe('Untitled - transcript (German).docx');
    expect(exportFileName(docNamed('   .mp3'), 'original')).toBe(
      'Untitled - transcript (German).docx',
    );
  });

  it(`cuts long names to ${MAX_BASE_LENGTH} characters`, () => {
    const name = exportFileName(docNamed(`${'x'.repeat(200)}.mp3`), 'original');
    expect(name).toBe(`${'x'.repeat(MAX_BASE_LENGTH)} - transcript (German).docx`);
  });

  it('counts code points, so the cut never splits a surrogate pair', () => {
    const name = exportFileName(docNamed(`${'x'.repeat(119)}😀😀.mp3`), 'original');
    const base = name.replace(' - transcript (German).docx', '');
    expect(Array.from(base)).toHaveLength(MAX_BASE_LENGTH);
    expect(base).toBe(`${'x'.repeat(119)}😀`);
  });
});
