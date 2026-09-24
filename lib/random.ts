// Small randomness helpers shared by sounds and battle choreography.

/**
 * Picks an index in [0, count) at random, never the one it picked last
 * (when there's more than one). `random` is injectable for tests.
 */
export function createNoRepeatPicker(count: number, random: () => number = Math.random) {
  let last = -1;
  // random() is in [0, 1); clamp anyway so a stray 1 can't overflow.
  const below = (n: number) => Math.min(n - 1, Math.floor(random() * n));
  return () => {
    if (count <= 1) return (last = 0);
    if (last < 0) return (last = below(count));
    // One of the other count − 1 indices: pick, then skip over the last one.
    const i = below(count - 1);
    return (last = i >= last ? i + 1 : i);
  };
}

/**
 * A random UUID v4. crypto.randomUUID() only exists in secure contexts
 * (HTTPS / localhost), so it throws in the dev server over a LAN IP;
 * crypto.getRandomValues() works everywhere (Math.random as a last resort).
 */
export function uuidV4(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
