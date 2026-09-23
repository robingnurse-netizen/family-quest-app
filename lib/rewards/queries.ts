import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import type { BoardMember } from "@/lib/backlog/types";
import { fetchStore, type StoreData } from "./fetch-store";

export type RewardStoreData = StoreData & {
  familyId: string;
  /** For request times (rendered the same on server and client). */
  timeZone: string;
  /** The player whose store this is; null = the whole family (parents). */
  childId: string | null;
  members: BoardMember[];
};

/**
 * First-render data for the rewards store (player) or catalog and request
 * queue (parents).
 */
export async function loadRewardStore(profile: Profile): Promise<RewardStoreData> {
  const supabase = await createClient();
  const childId = profile.role === "child" ? profile.id : null;
  const [store, { data: members }, { data: family }] = await Promise.all([
    fetchStore(supabase, profile.family_id, childId),
    supabase
      .from("profiles")
      .select("id, display_name, role")
      .eq("family_id", profile.family_id)
      .order("created_at"),
    supabase.from("families").select("timezone").eq("id", profile.family_id).single(),
  ]);
  return {
    familyId: profile.family_id,
    timeZone: family?.timezone ?? "Europe/London",
    childId,
    members: members ?? [],
    ...(store ?? { rewards: [], redemptions: [], usedRewardIds: [], gold: childId ? 0 : null }),
  };
}
