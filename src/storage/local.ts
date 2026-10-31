// Namespaced JSON access to localStorage/sessionStorage (AGENTS.md rule 7).
// Storage can be unavailable (blocked site data, private mode, quota), and even reading the
// `localStorage` property can throw, so every access is wrapped and failures degrade quietly.

export type StorageArea = 'local' | 'session';

export const STORAGE_PREFIX = 'describe.v1.';

function getStorage(area: StorageArea): Storage | null {
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(
  area: StorageArea,
  key: string,
  fallback: T,
  guard?: (v: unknown) => v is T,
): T {
  try {
    const raw = getStorage(area)?.getItem(STORAGE_PREFIX + key);
    if (raw == null) return fallback;
    const value: unknown = JSON.parse(raw);
    if (guard && !guard(value)) return fallback;
    return value as T;
  } catch {
    return fallback;
  }
}

export function writeJson(area: StorageArea, key: string, value: unknown): boolean {
  try {
    const storage = getStorage(area);
    if (!storage) return false;
    storage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(area: StorageArea, key: string): void {
  try {
    getStorage(area)?.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}
