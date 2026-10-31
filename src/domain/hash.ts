// A small, fast, non-cryptographic string hash (cyrb53, public domain), used only to notice changes:
// a transcript or a brief that differs from the one a summary was made from. Never use it for security.

function cyrb53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The 53-bit hash of `text`, as 14 hex digits. */
export function hashText(text: string): string {
  return cyrb53(text).toString(16).padStart(14, '0');
}

/** The hash of several strings. They are joined with U+0000, so `['ab', 'c']` and `['a', 'bc']` differ. */
export function hashParts(parts: readonly string[]): string {
  return hashText(parts.join('\u0000'));
}
