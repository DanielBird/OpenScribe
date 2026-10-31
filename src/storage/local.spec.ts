import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readJson, removeKey, STORAGE_PREFIX, writeJson } from './local';

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

describe('storage/local', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['local', 'session'] as const)('round-trips JSON in %s storage', (area) => {
    expect(writeJson(area, 'prefs', { a: 1, b: ['x'] })).toBe(true);
    expect(readJson(area, 'prefs', null)).toEqual({ a: 1, b: ['x'] });
  });

  it('namespaces keys with describe.v1.', () => {
    writeJson('local', 'glossary', ['Oticon']);
    expect(STORAGE_PREFIX).toBe('describe.v1.');
    expect(localStorage.getItem('describe.v1.glossary')).toBe('["Oticon"]');
    expect(localStorage.getItem('glossary')).toBeNull();
  });

  it('keeps local and session storage separate', () => {
    writeJson('session', 'key', 'session-value');
    expect(readJson('local', 'key', 'fallback')).toBe('fallback');
    expect(sessionStorage.getItem('describe.v1.key')).toBe('"session-value"');
  });

  it('returns the fallback for a missing key', () => {
    expect(readJson('local', 'missing', 42)).toBe(42);
  });

  it('returns the fallback when the stored JSON is corrupt', () => {
    localStorage.setItem('describe.v1.broken', '{not json');
    expect(readJson('local', 'broken', ['fallback'])).toEqual(['fallback']);
  });

  it('returns the fallback when the guard rejects the value', () => {
    writeJson('local', 'glossary', [1, 2, 3]);
    expect(readJson('local', 'glossary', [], isStringArray)).toEqual([]);
    writeJson('local', 'glossary', ['a', 'b']);
    expect(readJson('local', 'glossary', [], isStringArray)).toEqual(['a', 'b']);
  });

  it('removes keys', () => {
    writeJson('local', 'gone', true);
    removeKey('local', 'gone');
    expect(localStorage.getItem('describe.v1.gone')).toBeNull();
  });

  describe('when storage is unavailable', () => {
    // An in-memory Storage that already holds a value for 'prefs', with one method made to throw.
    function storageWhere(failing: 'getItem' | 'setItem' | 'removeItem', error: DOMException) {
      const data = new Map([[`${STORAGE_PREFIX}prefs`, '"stored"']]);
      const storage: Storage = {
        get length() {
          return data.size;
        },
        clear: () => data.clear(),
        key: (i) => [...data.keys()][i] ?? null,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
      };
      storage[failing] = () => {
        throw error;
      };
      return storage;
    }

    it('falls back when getItem throws', () => {
      const denied = new DOMException('Access denied', 'SecurityError');
      vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storageWhere('setItem', denied));
      expect(readJson('local', 'prefs', 'fallback')).toBe('stored'); // sanity check of the fake

      vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storageWhere('getItem', denied));
      expect(readJson('local', 'prefs', 'fallback')).toBe('fallback');
    });

    it('reports false when setItem throws (e.g. quota exceeded)', () => {
      const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
      vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storageWhere('setItem', quota));
      expect(writeJson('local', 'prefs', { big: true })).toBe(false);
    });

    it('does not throw when removeItem throws', () => {
      const denied = new DOMException('Access denied', 'SecurityError');
      vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(storageWhere('removeItem', denied));
      expect(() => removeKey('session', 'prefs')).not.toThrow();
    });

    it('copes when even reading window.localStorage throws', () => {
      vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });
      expect(readJson('local', 'prefs', 'fallback')).toBe('fallback');
      expect(writeJson('local', 'prefs', 1)).toBe(false);
      expect(() => removeKey('local', 'prefs')).not.toThrow();
    });
  });
});
