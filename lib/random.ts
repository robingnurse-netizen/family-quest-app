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
