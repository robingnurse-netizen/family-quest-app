"use server";

import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { friendlyRewardError } from "@/lib/rewards/errors";
import { friendlyPotionError } from "@/lib/potions/errors";
import type { ActionResult } from "@/lib/backlog/types";
import type { PotionPurchase, RewardRedemption } from "@/lib/supabase/types";

/**
 * Request a reward. The database checks and deducts the gold in the same
 * insert (20260923000009_rewards_store.sql), so double taps or two tabs
 * can't overspend. `expectedCost` is the price the player saw: if a parent
 * has changed it since, nothing is spent and they're told.
 */
export async function redeemReward(
  rewardId: string,
  expectedCost: number,
): Promise<ActionResult<{ redemption: RewardRedemption; gold: number }>> {
  const profile = await requireRole("child");
  const supabase = await createClient();

  const { data: reward } = await supabase
    .from("rewards")
    .select("id, gold_cost, active")
    .eq("id", rewardId)
    .eq("family_id", profile.family_id)
    .maybeSingle();
  if (!reward || !reward.active) return { ok: false, error: "That reward isn't available any more." };
  if (reward.gold_cost !== expectedCost) {
    return { ok: false, error: `The price just changed to ${reward.gold_cost} gold — take another look.` };
  }

  const { data: redemption, error } = await supabase
    .from("reward_redemptions")
    .insert({
      family_id: profile.family_id,
      child_id: profile.id,
      reward_id: reward.id,
      // RLS compares this to the price; the trigger sets it regardless.
      gold_spent: reward.gold_cost,
    })
    .select()
    .single();
  if (error || !redemption) {
    return { ok: false, error: friendlyRewardError(error?.message, "Couldn't send that request.") };
  }

  const { data: stats } = await supabase
    .from("player_stats")
    .select("gold")
    .eq("child_id", profile.id)
    .maybeSingle();
  return { ok: true, data: { redemption, gold: stats?.gold ?? 0 } };
}

/**
 * Buy a potion and drink it at once (no inventory, no grown-up). The
 * database prices it from the potions table, takes his own gold and heals
 * the party in one step (buy_potion()), so double taps can't overspend.
 * `expectedCost` is the price he saw: if it's changed, nothing is spent.
 */
export async function buyPotion(potionId: string, expectedCost: number): Promise<ActionResult<PotionPurchase>> {
  await requireRole("child");
  const supabase = await createClient();

  const { data: potion } = await supabase.from("potions").select("gold_cost, active").eq("id", potionId).maybeSingle();
  if (!potion || !potion.active) return { ok: false, error: "That potion isn't on sale any more." };
  if (potion.gold_cost !== expectedCost) {
    return { ok: false, error: `The price just changed to ${potion.gold_cost} gold — take another look.` };
  }

  const { data, error } = await supabase.rpc("buy_potion", { p_potion_id: potionId });
  if (error || !data) return { ok: false, error: friendlyPotionError(error?.message, "Couldn't buy that potion.") };
  return { ok: true, data };
}
