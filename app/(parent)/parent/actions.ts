"use server";

import { requireRole } from "@/lib/supabase/profile";
import { runDailyResetForFamily } from "@/lib/game-logic/daily-reset";
import type { DailyResetResult } from "@/lib/supabase/types";

export type ResetActionResult =
  | { ok: true; data: DailyResetResult }
  | { ok: false; error: string };

/**
 * "Run daily reset now" (testing aid). Runs the same service-role engine as
 * the cron route, but only for the signed-in parent's family — the cron
 * endpoint resets every family, and CRON_SECRET never leaves the server.
 * Safe to press repeatedly: the reset is idempotent within a day.
 */
export async function runDailyResetNow(): Promise<ResetActionResult> {
  const profile = await requireRole("parent");
  try {
    return { ok: true, data: await runDailyResetForFamily(profile.family_id) };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "The reset failed — check the server logs." };
  }
}
