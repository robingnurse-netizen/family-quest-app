import type { Reward } from "@/lib/supabase/types";

/**
 * Where the player stands in the shop: how many active rewards they can
 * afford now, and the cheapest one they can't yet (the next goal).
 */
export function shopProgress(rewards: Reward[], gold: number) {
  const active = rewards.filter((r) => r.active).sort((a, b) => a.gold_cost - b.gold_cost);
  const affordable = active.filter((r) => r.gold_cost <= gold).length;
  const next = active.find((r) => r.gold_cost > gold) ?? null;
  return {
    total: active.length,
    affordable,
    next,
    /** Gold still needed for `next`. */
    needed: next ? next.gold_cost - gold : 0,
    /** 0–1 progress toward `next`. */
    progress: next ? Math.max(0, Math.min(1, gold / next.gold_cost)) : 1,
  };
}

/** "Need N more" progress toward one reward, 0–1. */
export const progressTo = (reward: Reward, gold: number) =>
  Math.max(0, Math.min(1, gold / Math.max(1, reward.gold_cost)));
