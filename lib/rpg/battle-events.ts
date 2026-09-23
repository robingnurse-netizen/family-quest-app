// Battle events: the one typed stream every battle reaction listens to.
//
// Realtime rows (bosses, boss_log) are translated into these in
// lib/hooks/use-battle.ts; the BattleProvider fans them out. The battle
// scene, the stage machine, the centre-screen hit overlay and anything added
// later (sound effects) subscribe with useBattleEvents — nothing needs
// rewiring to add a listener. The overlay also emits named "moment" events
// (impact, combo, ko, victory, coin), and the item shop a "purchase" one,
// into the same stream for sounds to hook onto.

import type { Boss, BossLog } from "@/lib/supabase/types";

export type BattleEvent =
  /** A completed quest struck the active boss (1 minute = 1 damage). */
  | { type: "damage"; bossId: string; amount: number; childId: string | null; slotId: string | null; at: string }
  /** A missed quest hurt the party (nightly reset). */
  | { type: "miss"; bossId: string; amount: number; childId: string | null; slotId: string | null; at: string }
  /** A child's share of a defeated boss's gold (one per child who hit it). */
  | { type: "gold"; bossId: string; childId: string | null; amount: number }
  | { type: "defeated"; boss: Boss }
  | { type: "escaped"; boss: Boss }
  /** A (new) boss became the active one. */
  | { type: "activated"; boss: Boss }
  /** A beat in the hit overlay's show, for sound effects. */
  | { type: "moment"; name: OverlayMoment; combo: number; damage: number }
  /** The item shop: a reward was bought (sent to a grown-up), for sounds. */
  | { type: "moment"; name: "purchase"; rewardId: string; cost: number };

/** Named beats of the hit overlay (components/rpg/battle/hit-overlay.tsx). */
export type OverlayMoment = "impact" | "combo" | "ko" | "victory" | "coin";

export type BattleEventType = BattleEvent["type"];
export type BattleListener = (event: BattleEvent) => void;

/** boss_log insert → event. Defeat/escape come from the boss row instead. */
export function eventFromLog(row: BossLog): BattleEvent | null {
  if (row.event_type === "gold_awarded") {
    return { type: "gold", bossId: row.boss_id, childId: row.child_id, amount: row.amount };
  }
  if (row.event_type !== "damage" && row.event_type !== "miss_penalty") return null;
  return {
    type: row.event_type === "damage" ? "damage" : "miss",
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
