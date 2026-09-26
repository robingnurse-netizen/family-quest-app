// Battle events: the one typed stream every battle reaction listens to.
//
// Realtime rows (bosses, boss_log) are translated into these in
// lib/hooks/use-battle.ts; the BattleProvider fans them out. The battle
// scene, the stage machine, the centre-screen hit overlay and anything added
// later (sound effects) subscribe with useBattleEvents — nothing needs
// rewiring to add a listener. The overlay also emits named "moment" events
// (impact, combo, ko, victory, coin), the item shop a "purchase" one, the
// stats HUD "level_up" / "streak_milestone", the celebration cards a
// "celebration" as each card appears, the quest board "quest_complete" /
// "quest_dropped" and the recap "night_raid" (Rogue's raid landing), into
// the same stream. Sound effects map these in
// components/rpg/battle/battle-sounds.tsx.
//
// PROGRESS NEVER GOES BACKWARDS (…16): nothing emits "miss" or "party" any
// more — the boss's attack on the party and the hero's knock-out are
// DORMANT code paths (kept, with their art, for later seasons). A boss
// never escapes.

import type { Boss, BossLog } from "@/lib/supabase/types";

export type BattleEvent =
  /** A completed quest struck the active boss (1 minute = 1 damage). */
  | { type: "damage"; bossId: string; amount: number; childId: string | null; slotId: string | null; at: string }
  /** Rogue's Night Raid on the boss (nightly reset, a perfect day's reward). */
  | { type: "raid"; bossId: string; amount: number; childId: string | null; at: string }
  /** DORMANT (…16): the boss attacks the party. Only the dev hurt() preview emits it. */
  | { type: "miss"; bossId: string; amount: number; childId: string | null; slotId: string | null; at: string }
  /** A child's share of a defeated boss's gold (one per child who hit it). */
  | { type: "gold"; bossId: string; childId: string | null; amount: number }
  | { type: "defeated"; boss: Boss }
  /** A (new) boss became the active one. */
  | { type: "activated"; boss: Boss }
  /**
   * DORMANT (…16: party HP is gone): party HP changed — drives the hero's
   * knock-out / rise in lib/rpg/hero-stage.ts. Nothing emits it.
   */
  | { type: "party"; hp: number; max: number }
  /** A beat in the hit overlay's show, for sound effects. */
  | { type: "moment"; name: OverlayMoment; combo: number; damage: number }
  /** The item shop: a reward was bought (sent to a grown-up), for sounds. */
  | { type: "moment"; name: "purchase"; rewardId: string; cost: number }
  /** The player reached a new level (shown after any hit sequence). */
  | { type: "moment"; name: "level_up"; level: number }
  /** The player's streak reached a milestone (3, 7, 14, 30 days). */
  | { type: "moment"; name: "streak_milestone"; days: number }
  /** A level-up / streak card is now on screen (after any hit sequence). */
  | { type: "moment"; name: "celebration"; kind: "level_up" | "streak_milestone" }
  /** The quest board: the player ticked a quest done (before the server says so). */
  | { type: "moment"; name: "quest_complete"; slotId: string }
  /** The quest board: a quest or weekly quest was dropped somewhere that takes it. */
  | { type: "moment"; name: "quest_dropped" }
  /** The "while you were away" recap: Rogue's Night Raid lands on the boss. */
  | { type: "moment"; name: "night_raid" };

/** Named beats of the hit overlay (components/rpg/battle/hit-overlay.tsx). */
export type OverlayMoment = "impact" | "combo" | "ko" | "victory" | "coin";

export type BattleEventType = BattleEvent["type"];
export type BattleListener = (event: BattleEvent) => void;

/** boss_log insert → event. A defeat comes from the boss row instead. */
export function eventFromLog(row: BossLog): BattleEvent | null {
  if (row.event_type === "gold_awarded") {
    return { type: "gold", bossId: row.boss_id, childId: row.child_id, amount: row.amount };
  }
  // A raid isn't his tap: no hit overlay, just the boss taking it.
  if (row.event_type === "night_raid") {
    return { type: "raid", bossId: row.boss_id, amount: row.amount, childId: row.child_id, at: row.created_at };
  }
  if (row.event_type !== "damage") return null;
  return {
    type: "damage",
    bossId: row.boss_id,
    amount: row.amount,
    childId: row.child_id,
    slotId: row.source_task_slot_id,
    at: row.created_at,
  };
}

/** A tiny synchronous emitter; listeners added during an emit wait for the next one. */
export function createBattleEmitter() {
  const listeners = new Set<BattleListener>();
  return {
    emit(event: BattleEvent) {
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener: BattleListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type BattleEmitter = ReturnType<typeof createBattleEmitter>;
