// The level curve, mirrored from the database: total XP needed to reach
// level L is 50 × L × (L − 1) (level 2 at 100, 5 at 1,000, 10 at 4,500).
// The source of truth is public.xp_for_level() in
// supabase/migrations/20260925000011_xp_level_streak.sql — change both
// together; tests/xp-level-streak.test.mjs fails if they disagree.

/** Total XP needed to reach `level`. */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return 50 * l * (l - 1);
}

/** The level reached with `xp` total XP (at least 1). */
export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level += 1;
  return level;
}

/** Progress within the current level, for the HUD's XP bar. */
export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { level, from, to, fraction: to > from ? (xp - from) / (to - from) : 0 };
}
