// API keys (AGENTS.md rule 3: the only module that reads or writes them). DECISIONS.md D3:
// "Remember keys on this computer" ticked → localStorage, unticked → sessionStorage (survives a reload,
// cleared when the tab closes). Never log a key or put it in an error message.
import { readJson, removeKey, writeJson } from './local';

export type KeyProvider = 'elevenlabs' | 'claude' | 'gemini';

export const KEY_PROVIDERS: readonly KeyProvider[] = ['elevenlabs', 'claude', 'gemini'];

const storageKey = (p: KeyProvider) => `key.${p}`;
const isString = (v: unknown): v is string => typeof v === 'string';

/** The stored key, from localStorage first, then sessionStorage. `''` if none. */
export function loadKey(p: KeyProvider): string {
  return (
    readJson('local', storageKey(p), '', isString) ||
    readJson('session', storageKey(p), '', isString)
  );
}

/** Stores the trimmed key in exactly one place. An empty value deletes it from both. */
export function saveKey(p: KeyProvider, value: string, remember: boolean): void {
  const key = value.trim();
  if (key === '') {
    forgetKey(p);
    return;
  }
  writeJson(remember ? 'local' : 'session', storageKey(p), key);
  removeKey(remember ? 'session' : 'local', storageKey(p));
}

/** Whether a key is stored "on this computer" (localStorage). */
export function isRemembered(p: KeyProvider): boolean {
  return readJson('local', storageKey(p), '', isString) !== '';
}

export function forgetKey(p: KeyProvider): void {
  removeKey('local', storageKey(p));
  removeKey('session', storageKey(p));
}
