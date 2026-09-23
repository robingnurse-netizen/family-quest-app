import type { ActionResult } from "@/lib/backlog/types";
import type { RedemptionStatus, Reward, RewardRedemption } from "@/lib/supabase/types";

/** What a parent can set a request to (the database checks the transition). */
export type Resolution = Exclude<RedemptionStatus, "pending">;

/** Parent catalog mutations. */
export type CatalogActions = {
  save: (formData: FormData) => Promise<ActionResult<Reward>>;
  remove: (id: string) => Promise<ActionResult<string>>;
  setActive: (id: string, active: boolean) => Promise<ActionResult<Reward>>;
};

export type ResolveAction = (
  id: string,
  status: Resolution,
) => Promise<ActionResult<RewardRedemption>>;

/** A player's request, plus the balance it left (read back from the DB). */
export type RedeemAction = (
  rewardId: string,
  expectedCost: number,
) => Promise<ActionResult<{ redemption: RewardRedemption; gold: number }>>;

export const MAX_REWARD_COST = 100_000;
