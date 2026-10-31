import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetKey, isRemembered, KEY_PROVIDERS, loadKey, saveKey } from './secrets';

const local = (p: string) => localStorage.getItem(`describe.v1.key.${p}`);
const session = (p: string) => sessionStorage.getItem(`describe.v1.key.${p}`);

describe('storage/secrets', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty string when no key is stored', () => {
    for (const p of KEY_PROVIDERS) {
      expect(loadKey(p)).toBe('');
      expect(isRemembered(p)).toBe(false);
    }
  });

  it('stores an unremembered key in sessionStorage only, under describe.v1.key.<provider>', () => {
    saveKey('elevenlabs', 'test-key', false);
    expect(session('elevenlabs')).toBe('"test-key"');
    expect(local('elevenlabs')).toBeNull();
    expect(loadKey('elevenlabs')).toBe('test-key');
    expect(isRemembered('elevenlabs')).toBe(false);
  });

  it('stores a remembered key in localStorage only', () => {
    saveKey('claude', 'test-key', true);
    expect(local('claude')).toBe('"test-key"');
    expect(session('claude')).toBeNull();
    expect(loadKey('claude')).toBe('test-key');
    expect(isRemembered('claude')).toBe(true);
  });

  it('moves the key from session to local when remember is ticked', () => {
    saveKey('gemini', 'test-key', false);
    saveKey('gemini', 'test-key', true);
    expect(local('gemini')).toBe('"test-key"');
    expect(session('gemini')).toBeNull();
  });

  it('moves the key from local to session when remember is unticked', () => {
    saveKey('gemini', 'test-key', true);
    saveKey('gemini', 'test-key', false);
    expect(local('gemini')).toBeNull();
    expect(session('gemini')).toBe('"test-key"');
    expect(isRemembered('gemini')).toBe(false);
  });

  it.each([true, false])(
    'deletes the key from both stores for an empty value (remember %s)',
    (remember) => {
      saveKey('elevenlabs', 'a', true);
      sessionStorage.setItem('describe.v1.key.elevenlabs', '"b"');
      saveKey('elevenlabs', '   ', remember);
      expect(local('elevenlabs')).toBeNull();
      expect(session('elevenlabs')).toBeNull();
      expect(loadKey('elevenlabs')).toBe('');
    },
  );

  it('trims the key before storing it', () => {
    saveKey('elevenlabs', '  test-key\n', false);
    expect(loadKey('elevenlabs')).toBe('test-key');
  });

  it('prefers localStorage over sessionStorage when loading', () => {
    localStorage.setItem('describe.v1.key.elevenlabs', '"from-local"');
    sessionStorage.setItem('describe.v1.key.elevenlabs', '"from-session"');
    expect(loadKey('elevenlabs')).toBe('from-local');
  });

  it('ignores stored values that are not strings', () => {
    localStorage.setItem('describe.v1.key.elevenlabs', '42');
    sessionStorage.setItem('describe.v1.key.elevenlabs', '"from-session"');
    expect(loadKey('elevenlabs')).toBe('from-session');
    expect(isRemembered('elevenlabs')).toBe(false);
  });

  it('forgetKey deletes the key from both stores', () => {
    localStorage.setItem('describe.v1.key.claude', '"a"');
    sessionStorage.setItem('describe.v1.key.claude', '"b"');
    forgetKey('claude');
    expect(local('claude')).toBeNull();
    expect(session('claude')).toBeNull();
  });

  it('keeps providers separate', () => {
    saveKey('elevenlabs', 'eleven', true);
    saveKey('claude', 'claude', false);
    forgetKey('gemini');
    expect(loadKey('elevenlabs')).toBe('eleven');
    expect(loadKey('claude')).toBe('claude');
    expect(loadKey('gemini')).toBe('');
  });

  it('does not throw when storage is unavailable', () => {
    const denied = () => {
      throw new DOMException('Access denied', 'SecurityError');
    };
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(denied);
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(denied);
    expect(() => saveKey('elevenlabs', 'test-key', true)).not.toThrow();
    expect(() => saveKey('elevenlabs', 'test-key', false)).not.toThrow();
    expect(() => forgetKey('elevenlabs')).not.toThrow();
    expect(loadKey('elevenlabs')).toBe('');
    expect(isRemembered('elevenlabs')).toBe(false);
  });
});
