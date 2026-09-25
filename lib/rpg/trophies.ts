// The Trophy Case (bestiary): every boss in the family's roster, in the
// order they're fought (low → mid → epic, queue order within a tier), with
// what the player may see of each. Pure (no React / Supabase), so it's
// tested directly (tests/trophies.test.mjs); the page loads the rows.
//
// Read-only: built from existing data — bosses (status) and boss_log
// (a "damage" row per hit, a "defeated" row when it falls).

import type { Boss, BossTier } from "@/lib/supabase/types";

/**
 * - defeated: beaten — real art and name, trophy glow, date and damage.
 * - fighting: the active boss — a nameless silhouette, "Now fighting".
 * - escaped:  got away — a nameless silhouette, "Escaped".
 * - locked:   not reached yet — a nameless silhouette.
 * Only a defeat reveals the name; the rest stay a mystery.
 */
export type TrophyState = "defeated" | "fighting" | "escaped" | "locked";

export type Trophy = {
  id: string;
  /** null until defeated: the name is only revealed by beating it (and not sent before). */
  name: string | null;
  tier: BossTier;
  spriteKey: string;
  state: TrophyState;
  /** When it was defeated (the "defeated" boss_log row), else null. */
  defeatedAt: string | null;
  /** Total damage the family dealt it (every "damage" row), once defeated; else null. */
  damage: number | null;
};

/** The boss_log columns the case needs. */
export type TrophyLogRow = {
  boss_id: string;
  event_type: string;
  amount: number;
  created_at: string;
};

type TrophyBoss = Pick<Boss, "id" | "name" | "tier" | "sprite_key" | "status" | "queue_position" | "created_at">;

const TIER_ORDER: Record<BossTier, number> = { low: 1, mid: 2, epic: 3 };

export function buildTrophyCase(bosses: TrophyBoss[], logs: TrophyLogRow[]): Trophy[] {
  const damage = new Map<string, number>();
  const defeatedAt = new Map<string, string>();
  for (const row of logs) {
    if (row.event_type === "damage") damage.set(row.boss_id, (damage.get(row.boss_id) ?? 0) + row.amount);
    if (row.event_type === "defeated") defeatedAt.set(row.boss_id, row.created_at);
  }

  return [...bosses]
    .sort(
      (a, b) =>
        TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
        a.queue_position - b.queue_position ||
        a.created_at.localeCompare(b.created_at),
    )
    .map((b) => {
      const state: TrophyState =
        b.status === "defeated" ? "defeated" : b.status === "active" ? "fighting" : b.status === "escaped" ? "escaped" : "locked";
      return {
        id: b.id,
        name: state === "defeated" ? b.name : null,
        tier: b.tier,
        spriteKey: b.sprite_key,
        state,
        defeatedAt: state === "defeated" ? (defeatedAt.get(b.id) ?? null) : null,
        damage: state === "defeated" ? (damage.get(b.id) ?? 0) : null,
      };
    });
}

/**
 * Empty rows under the lowest pixel of each boss's statue frame (its
 * "front" still, else its battle idle's first frame): art that floats above
 * the frame's bottom is set down onto the plinth by this much. The front
 * stills are all grounded by the slicer (hovering bosses included), so it's
 * empty now; tests/trophies.test.mjs re-measures every statue frame against
 * it, so a new frame with a gap fails there instead of floating.
 */
export const STATUE_EMPTY_ROWS_BELOW: Record<string, number> = {};

/**
 * A look-by-eye set-down, on top of the measured one: art rows of a statue
 * tucked behind its plinth's top face (the plinth is drawn over the statue),
 * for a pose whose lowest pixel is one small tip with the rest standing
 * higher. The Cable Spider's front still touches down on one plug (row 58)
 * while its other plugs end 3+ rows up, so it looked like it was floating;
 * 3 rows puts the next plug on the stone.
 */
export const STATUE_SINK_ROWS: Record<string, number> = {
  cable_spider: 3,
};
