import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Reward, RewardRedemption } from "@/lib/supabase/types";

// Enough history for the queue and "recent" lists; open requests are few.
const REDEMPTION_LIMIT = 100;

export type StoreData = {
  rewards: Reward[];
  redemptions: RewardRedemption[];
  /** Rewards with any redemption ever (they can be hidden, not deleted). */
  usedRewardIds: string[];
  /** The child's spendable gold; null for parents. */
  gold: number | null;
};

/**
 * The family's rewards plus redemption requests — all of them for parents
 * (`childId` null), only the child's own for a player. Used by the server
 * loader and the client hook; RLS scopes both to the caller's family.
 */
export async function fetchStore(
  supabase: SupabaseClient<Database>,
  familyId: string,
  childId: string | null,
): Promise<StoreData | null> {
  let redemptionQuery = supabase
    .from("reward_redemptions")
    .select("*")
    .eq("family_id", familyId)
    .order("redeemed_at", { ascending: false })
    .limit(REDEMPTION_LIMIT);
  let usedQuery = supabase.from("reward_redemptions").select("reward_id").eq("family_id", familyId);
  if (childId) {
    redemptionQuery = redemptionQuery.eq("child_id", childId);
    usedQuery = usedQuery.eq("child_id", childId);
  }

  const [rewards, redemptions, used, stats] = await Promise.all([
    supabase.from("rewards").select("*").eq("family_id", familyId).order("gold_cost").order("title"),
    redemptionQuery,
    usedQuery,
    childId
      ? supabase.from("player_stats").select("gold").eq("child_id", childId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (rewards.error || redemptions.error || used.error || stats.error) return null;

  return {
    rewards: rewards.data,
    redemptions: redemptions.data,
    usedRewardIds: [...new Set(used.data.map((r) => r.reward_id))],
    gold: childId ? (stats.data?.gold ?? 0) : null,
  };
}
