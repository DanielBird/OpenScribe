import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlossaryStore } from './glossary';

const STORAGE_KEY = 'describe.v1.glossary';
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;

/**
 * Puts a wrapper around the real localStorage so a test can count writes, or make them fail
 * (e.g. quota exceeded). Restored by `vi.restoreAllMocks()`.
 */
function spyOnWrites(fail = false) {
  const real = window.localStorage;
  const setItem = vi.fn((key: string, value: string) => {
    if (fail) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    real.setItem(key, value);
  });
  const wrapper = {
    getItem: (key: string) => real.getItem(key),
    setItem,
    removeItem: (key: string) => real.removeItem(key),
  } as unknown as Storage;
  vi.spyOn(window, 'localStorage', 'get').mockReturnValue(wrapper);
  return setItem;
}

/** A fresh store, as after a reload. */
function reload() {
  setActivePinia(createPinia());
  return useGlossaryStore();
}

describe('glossary store', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts empty when nothing is saved', () => {
    const glossary = useGlossaryStore();
    expect(glossary.terms).toEqual([]);
    expect(glossary.count).toBe(0);
    expect(glossary.validTerms).toEqual([]);
  });

  describe('saves after every change', () => {
    it('addFromText', () => {
      const glossary = useGlossaryStore();
      expect(glossary.addFromText('Oticon\nPhilips; hearing aid, Hörgerät\n\n oticon ')).toEqual({
        added: 4,
        duplicates: 1,
      });
      expect(stored()).toEqual(['Oticon', 'Philips', 'hearing aid', 'Hörgerät']);

      expect(glossary.addFromText('Demant')).toEqual({ added: 1, duplicates: 0 });
      expect(stored()).toEqual(['Oticon', 'Philips', 'hearing aid', 'Hörgerät', 'Demant']);
    });

    it('updateTerm', () => {
      const glossary = useGlossaryStore();
      glossary.addFromText('Oticon, Philips');
      expect(glossary.updateTerm(1, '  "Philips   Hue" ')).toEqual({ ok: true });
      expect(stored()).toEqual(['Oticon', 'Philips Hue']);
    });

    it('removeTerm', () => {
      const glossary = useGlossaryStore();
      glossary.addFromText('a, b, c');
      glossary.removeTerm(1);
      expect(stored()).toEqual(['a', 'c']);
      expect(glossary.count).toBe(2);
    });

    it('clear', () => {
      const glossary = useGlossaryStore();
      glossary.addFromText('a, b, c');
      glossary.clear();
      expect(stored()).toEqual([]);
      expect(glossary.count).toBe(0);
    });

    it('a plain assignment', () => {
      const glossary = useGlossaryStore();
      glossary.terms = ['x'];
      expect(stored()).toEqual(['x']);
    });
  });

  it('reloads an identical list', () => {
    const glossary = useGlossaryStore();
    glossary.addFromText('Oticon\nHörgerät\nprothèse auditive\nFoo [bar]');
    glossary.updateTerm(0, 'Oticon Intent');
    glossary.removeTerm(1);
    const before = [...glossary.terms];

    expect(reload().terms).toEqual(before);
  });

  it('does not save when nothing was added', () => {
    const glossary = useGlossaryStore();
    glossary.addFromText('a');
    const setItem = spyOnWrites();
    expect(glossary.addFromText('A\n ,;')).toEqual({ added: 0, duplicates: 1 });
    expect(setItem).not.toHaveBeenCalled();

    // The spy does see real writes.
    glossary.addFromText('b');
    expect(setItem).toHaveBeenCalledOnce();
  });

  describe('updateTerm', () => {
    it('rejects an empty value without saving', () => {
      const glossary = useGlossaryStore();
      glossary.addFromText('a, b');
      const setItem = spyOnWrites();
      expect(glossary.updateTerm(0, '   ')).toEqual({ ok: false, reason: 'empty' });
      expect(glossary.updateTerm(0, '""')).toEqual({ ok: false, reason: 'empty' });
      expect(setItem).not.toHaveBeenCalled();
      expect(glossary.terms).toEqual(['a', 'b']);
    });

    it('rejects a duplicate of another term, ignoring case, without saving', () => {
      const glossary = useGlossaryStore();
      glossary.addFromText('Oticon, Philips');
      const setItem = spyOnWrites();
      expect(glossary.updateTerm(1, 'OTICON')).toEqual({ ok: false, reason: 'duplicate' });
      expect(setItem).not.toHaveBeenCalled();
      expect(glossary.terms).toEqual(['Oticon', 'Philips']);
    });

    it('allows changing only the case of the edited term', () => {
      const glossary = useGlossaryStore();
      glossary.addFromText('oticon, Philips');
      expect(glossary.updateTerm(0, 'Oticon')).toEqual({ ok: true });
      expect(glossary.terms).toEqual(['Oticon', 'Philips']);
    });

    it('keeps a value with a comma as one term', () => {
      const glossary = useGlossaryStore();
      glossary.addFromText('a');
      expect(glossary.updateTerm(0, 'Smith, John')).toEqual({ ok: true });
      expect(glossary.terms).toEqual(['Smith, John']);
    });

    it('ignores an index out of range', () => {
      const glossary = useGlossaryStore();
      glossary.addFromText('a');
      expect(glossary.updateTerm(5, 'b')).toEqual({ ok: true });
      glossary.removeTerm(-1);
      expect(glossary.terms).toEqual(['a']);
    });
  });

  describe('loading', () => {
    it.each([
      ['corrupt JSON', '{not json'],
      ['an object', '{"a":1}'],
      ['a string', '"Oticon"'],
      ['a mixed array', '["Oticon", 3]'],
      ['null', 'null'],
    ])('falls back to [] for %s', (_name, raw) => {
      localStorage.setItem(STORAGE_KEY, raw);
      expect(reload().terms).toEqual([]);
    });

    it('drops empty and duplicate terms from a saved list', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(['Oticon', ' ', 'oticon', ' "Philips" ']));
      expect(reload().terms).toEqual(['Oticon', 'Philips']);
    });
  });

  describe('validation', () => {
    it('leaves invalid terms out of validTerms but keeps them in the list', () => {
      const glossary = useGlossaryStore();
      const fifty = 'a'.repeat(50);
      const fortyNine = 'b'.repeat(49);
      glossary.addFromText(
        ['Oticon', fifty, fortyNine, 'Foo [bar]', 'one two three four five six'].join('\n'),
      );
      expect(glossary.count).toBe(5);
      expect(glossary.validTerms).toEqual(['Oticon', fortyNine]);
      expect(glossary.validation.invalid).toEqual([
        { term: fifty, issues: ['too_long'] },
        { term: 'Foo [bar]', issues: ['unsupported_chars'] },
        { term: 'one two three four five six', issues: ['too_many_words'] },
      ]);
    });

    it.each([...'<>{}[]\\'])('leaves a term containing %s out of validTerms', (char) => {
      const glossary = useGlossaryStore();
      glossary.addFromText(`ok\nbad ${char} term`);
      expect(glossary.validTerms).toEqual(['ok']);
    });

    it('leaves terms beyond 1000 out of validTerms', () => {
      const glossary = useGlossaryStore();
      glossary.addFromText(Array.from({ length: 1002 }, (_, i) => `term ${i}`).join('\n'));
      expect(glossary.validTerms).toHaveLength(1000);
      expect(glossary.validation.overLimit).toEqual(['term 1000', 'term 1001']);
    });

    it('uses the ElevenLabs keyterm limits', () => {
      expect(useGlossaryStore().limits).toEqual({
        maxTerms: 1000,
        maxChars: 49,
        maxWords: 5,
        forbiddenChars: '<>{}[]\\',
      });
    });
  });

  it('flags a failed save, and clears the flag when a save works again', () => {
    const glossary = useGlossaryStore();
    spyOnWrites(true);
    glossary.addFromText('a');
    expect(glossary.saveFailed).toBe(true);
    expect(glossary.terms).toEqual(['a']);

    vi.restoreAllMocks();
    glossary.addFromText('b');
    expect(glossary.saveFailed).toBe(false);
    expect(stored()).toEqual(['a', 'b']);
  });
});
