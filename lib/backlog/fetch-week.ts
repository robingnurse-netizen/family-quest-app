import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TaskSlot } from "@/lib/supabase/types";

/**
 * Pools for one week plus their slots. Used by the server loader and the
 * client hook (RLS scopes both to the caller's family).
 * `childId` narrows to one child's pools; null = all children.
 */
export async function fetchWeek(
  supabase: SupabaseClient<Database>,
  familyId: string,
  week: string,
  childId: string | null,
) {
  let poolQuery = supabase
    .from("weekly_pools")
    .select("*")
    .eq("family_id", familyId)
    .eq("week_start_date", week)
    .order("created_at");
  if (childId) poolQuery = poolQuery.eq("child_id", childId);

  const { data: pools, error } = await poolQuery;
  if (error) return null;

  const ids = pools.map((p) => p.id);
  if (!ids.length) return { pools, slots: [] as TaskSlot[] };

  const { data: slots, error: slotError } = await supabase
    .from("task_slots")
    .select("*")
    .in("pool_id", ids)
    .order("created_at");
  if (slotError) return null;

  return { pools, slots };
}
