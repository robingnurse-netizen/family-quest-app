import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { weekStartOf } from "@/lib/calendar/dates";

/**
 * One child's quests still to do on `day`: his slots scheduled that day and
 * not yet ticked. The one count behind the streak nudge and the evening
 * Night Raid banner (a perfect day is judged on that day's slots only).
 * Used by the server loader and the client hook; null on error.
 *
 * A slot always falls inside its pool's week (pool integrity, …04), so only
 * the pools for `day`'s week are looked at.
 */
export async function countQuestsLeft(
  supabase: SupabaseClient<Database>,
  familyId: string,
  childId: string,
  day: string,
): Promise<number | null> {
  const { data: pools, error } = await supabase
    .from("weekly_pools")
    .select("id")
    .eq("family_id", familyId)
    .eq("child_id", childId)
    .eq("week_start_date", weekStartOf(day));
  if (error) return null;
  if (!pools.length) return 0;

  const { count, error: slotError } = await supabase
    .from("task_slots")
    .select("id", { count: "exact", head: true })
    .in("pool_id", pools.map((p) => p.id))
    .eq("scheduled_date", day)
    .eq("status", "scheduled");
  if (slotError) return null;
  return count ?? 0;
}
