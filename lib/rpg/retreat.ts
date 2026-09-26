// Boss retreat (20260929000015_boss_retreat.sql): an escaped boss comes back
// after the party's next win, stronger, and pays a comeback bonus when it's
// beaten. THE RULES LIVE IN THE DATABASE (activate_boss / finish_boss); these
// mirror its constants for on-screen wording only, and
// tests/boss-engine.test.mjs checks they agree. Pure (no React / Supabase).

/** Max HP added per retreat, as a % of the boss's original max HP. */
export const RETREAT_HP_PCT = 10;
/** Retreats that count toward the HP bump (+30% at most). */
export const RETREAT_CAP = 3;
/** Extra gold and defeat XP for beating a boss that has retreated (flat). */
export const COMEBACK_BONUS_PCT = 50;

/** How much stronger a boss that has retreated `retreats` times is (%). */
export function retreatHpBonusPct(retreats: number): number {
  return RETREAT_HP_PCT * Math.min(Math.max(retreats, 0), RETREAT_CAP);
}

/** Has this boss retreated before (so it's a rematch, with a comeback bonus)? */
export function isComeback(boss: { retreats?: number | null }): boolean {
  return (boss.retreats ?? 0) > 0;
}

/**
 * The victory sequence's "next foe" teaser: a boss back from a retreat gets a
 * callback, a first-time boss the generic line. `withName` for screen readers
 * (the teaser on screen is a silhouette, so it doesn't name the boss).
 */
export function nextFoeLine(boss: { name: string; retreats?: number | null }, withName = false): string {
  if (isComeback(boss)) return withName ? `Look who's baaack! ${boss.name} returns!` : "Look who's baaack!";
  return withName ? `A new foe approaches: ${boss.name}!` : "A new foe approaches…";
}
