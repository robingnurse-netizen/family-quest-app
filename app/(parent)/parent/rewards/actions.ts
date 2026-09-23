"use server";

import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { isRewardIcon } from "@/lib/rewards/icons";
import { friendlyRewardError } from "@/lib/rewards/errors";
import { MAX_REWARD_COST, type Resolution } from "@/lib/rewards/types";
import type { ActionResult } from "@/lib/backlog/types";
import type { RedemptionStatus, Reward, RewardRedemption } from "@/lib/supabase/types";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

/**
 * Create (no `id`) or update (with `id`) a reward. Either parent may edit
 * any family reward — RLS enforces family + parent. A price change only
 * affects new requests: pending ones keep the gold they already spent.
 */
export async function saveReward(formData: FormData): Promise<ActionResult<Reward>> {
  const profile = await requireRole("parent");
  const supabase = await createClient();

  const id = field(formData, "id");
  const title = field(formData, "title");
  const description = field(formData, "description") || null;
  const icon = field(formData, "icon");
  const goldCost = Number(field(formData, "gold_cost"));

  if (!title) return { ok: false, error: "Give the reward a title." };
  if (title.length > 80) return { ok: false, error: "That title is a bit long." };
  if (description && description.length > 300) {
    return { ok: false, error: "Keep the description under 300 characters." };
  }
  if (!Number.isInteger(goldCost) || goldCost < 0 || goldCost > MAX_REWARD_COST) {
    return { ok: false, error: "The cost must be a whole number of gold, 0 or more." };
  }
  if (!isRewardIcon(icon)) return { ok: false, error: "Pick an icon." };

  const values = { title, description, icon, gold_cost: goldCost };
  const query = id
    ? supabase.from("rewards").update(values).eq("id", id).eq("family_id", profile.family_id)
    : supabase
        .from("rewards")
        .insert({ ...values, family_id: profile.family_id, created_by: profile.id });

  const { data, error } = await query.select().single();
  if (error || !data) {
    return { ok: false, error: friendlyRewardError(error?.message, "Couldn't save that reward.") };
  }
  return { ok: true, data };
}

/** Hide (inactive) or show a reward in the store. */
export async function setRewardActive(id: string, active: boolean): Promise<ActionResult<Reward>> {
  const profile = await requireRole("parent");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rewards")
    .update({ active })
    .eq("id", id)
    .eq("family_id", profile.family_id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't update that reward." };
  if (!data) return { ok: false, error: "That reward no longer exists." };
  return { ok: true, data };
}

/**
 * Delete a reward that's never been requested. One with past requests is
 * refused by the database (no cascade) — the UI offers hiding instead.
 */
export async function deleteReward(id: string): Promise<ActionResult<string>> {
  const profile = await requireRole("parent");
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("rewards")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("family_id", profile.family_id);
  if (error) {
    return { ok: false, error: friendlyRewardError(error.message, "Couldn't delete that reward.") };
  }
  if (!count) return { ok: false, error: "That reward no longer exists." };
  return { ok: true, data: id };
}

// Where each resolution may come from (mirrors the database's rules).
const FROM: Record<Resolution, RedemptionStatus[]> = {
  approved: ["pending"],
  fulfilled: ["pending", "approved"],
  denied: ["pending", "approved"],
};

/**
 * Approve, fulfil or deny a request. Denying refunds the gold (database
 * trigger, same transaction); approving or fulfilling keeps it spent.
 */
export async function resolveRedemption(
  id: string,
  status: Resolution,
): Promise<ActionResult<RewardRedemption>> {
  const profile = await requireRole("parent");
  if (!(status in FROM)) return { ok: false, error: "Unknown status." };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("reward_redemptions")
    .update({ status })
    .eq("id", id)
    .eq("family_id", profile.family_id)
    // The other parent may have just resolved it: then nothing matches.
    .in("status", FROM[status])
    .select()
    .maybeSingle();
  if (error) {
    return { ok: false, error: friendlyRewardError(error.message, "Couldn't update that request.") };
  }
  if (!data) return { ok: false, error: "That request has already been sorted out." };
  return { ok: true, data };
}
