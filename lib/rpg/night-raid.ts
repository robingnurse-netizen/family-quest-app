// Rogue's Night Raid (supabase/migrations/20260930000016_night_raid.sql): a
// perfect day earns a raid on the active boss at the nightly reset. THE RULE
// LIVES IN THE DATABASE (run_daily_reset / tonight_stakes); this mirrors it
// for on-screen wording only, and tests/night-raid.test.mjs checks they
// agree. Pure (no React / Supabase).

/** A raid deals this % of the boss's max HP, rounded up. */
export const RAID_PCT = 5;

/**
 * What one raid deals a boss: RAID_PCT of its max HP, rounded up (so at
 * least 1), but never taking it below 1 HP (0 for a boss already at 1).
 */
export function raidDamage(maxHp: number, currentHp: number): number {
  return Math.max(0, Math.min(Math.ceil((maxHp * RAID_PCT) / 100), currentHp - 1));
}
