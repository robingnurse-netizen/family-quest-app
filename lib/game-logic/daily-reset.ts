import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DailyResetResult } from "@/lib/supabase/types";

// The daily game tick lives in Postgres (run_daily_reset, last redefined in
// supabase/migrations/20260923000008_instant_damage.sql) so each family's run
// is one atomic, idempotent transaction. Boss damage is NOT part of it: that
// happens instantly when a slot is completed (task_slots_strike_boss). It's executable only by the service
// role: game-engine writes (missed slots, applied_to_boss, gold) must never
// run under a user session, where the child slot guard would apply.

/** Every family — used by the Vercel Cron route. */
export async function runDailyResetForAllFamilies() {
  const { data, error } = await createAdminClient().rpc("run_daily_reset_all");
  if (error) throw new Error(`run_daily_reset_all failed: ${error.message}`);
  return data;
}

/** One family — used by the parent's "Run daily reset now" button. */
export async function runDailyResetForFamily(familyId: string): Promise<DailyResetResult> {
  const { data, error } = await createAdminClient().rpc("run_daily_reset", {
    p_family_id: familyId,
  });
  if (error) throw new Error(`run_daily_reset failed: ${error.message}`);
  return data;
}
