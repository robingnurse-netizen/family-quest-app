"use server";

import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { isDayKey } from "@/lib/calendar/dates";
import { friendlyBacklogError } from "@/lib/backlog/errors";
import type { ActionResult } from "@/lib/backlog/types";
import type { StreakRescue, TaskSlot, TaskSlotStatus } from "@/lib/supabase/types";
import { friendlyRescueError } from "@/lib/rpg/rescue";

// RLS limits all of these to slots in pools assigned to the signed-in child;
// the pool integrity triggers enforce the minutes cap and the pool's week.

export async function createSlot(
  poolId: string,
  day: string,
  minutes: number,
): Promise<ActionResult<TaskSlot>> {
  await requireRole("child");
  if (!isDayKey(day)) return { ok: false, error: "Pick a day." };
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) {
    return { ok: false, error: "Pick how many minutes." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_slots")
    .insert({ pool_id: poolId, scheduled_date: day, duration_minutes: minutes })
    .select()
    .single();
  if (error || !data) {
    return { ok: false, error: friendlyBacklogError(error?.message, "Couldn't add that slot.") };
  }
  return { ok: true, data };
}

/** Move a slot to another day. Completed slots stay put. */
export async function moveSlot(slotId: string, day: string): Promise<ActionResult<TaskSlot>> {
  await requireRole("child");
  if (!isDayKey(day)) return { ok: false, error: "Pick a day." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_slots")
    .update({ scheduled_date: day })
    .eq("id", slotId)
    .eq("status", "scheduled")
    .select()
    .maybeSingle();
  if (error) {
    return { ok: false, error: friendlyBacklogError(error.message, "Couldn't move that slot.") };
  }
  if (!data) return { ok: false, error: "Only slots that aren't done yet can be moved." };
  return { ok: true, data };
}

/**
 * Remove a slot, returning its minutes to the pool. Only open slots — the
 * child-guard trigger blocks deleting completed, missed or counted ones.
 */
export async function removeSlot(slotId: string): Promise<ActionResult<string>> {
  await requireRole("child");
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("task_slots")
    .delete({ count: "exact" })
    .eq("id", slotId)
    .eq("status", "scheduled")
    .eq("applied_to_boss", false);
  if (error) {
    return { ok: false, error: friendlyBacklogError(error.message, "Couldn't remove that slot.") };
  }
  if (!count) return { ok: false, error: "Only slots that aren't done yet can be removed." };
  return { ok: true, data: slotId };
}

/**
 * Tap-to-toggle between scheduled and completed. Completing a slot damages
 * the boss instantly (database trigger) and locks it; missed slots are
 * locked too.
 */
export async function setSlotStatus(
  slotId: string,
  status: Exclude<TaskSlotStatus, "missed">,
): Promise<ActionResult<TaskSlot>> {
  await requireRole("child");
  if (status !== "scheduled" && status !== "completed") {
    return { ok: false, error: "Unknown status." };
  }
  const supabase = await createClient();
  // completed_at is set by a trigger from status.
  const { data, error } = await supabase
    .from("task_slots")
    .update({ status })
    .eq("id", slotId)
    .in("status", ["scheduled", "completed"])
    .eq("applied_to_boss", false)
    .select()
    .maybeSingle();
  if (error) {
    return { ok: false, error: friendlyBacklogError(error.message, "Couldn't update that slot.") };
  }
  if (!data) return { ok: false, error: "That quest is locked in and can't be changed." };
  return { ok: true, data };
}

/**
 * He's seen (or skipped) his "while you were away" recap, up to `through`
 * (the newest reset shown). The database function only marks his own
 * recaps seen — it can't change anything else.
 */
export async function acknowledgeRecaps(through: string): Promise<void> {
  await requireRole("child");
  const supabase = await createClient();
  await supabase.rpc("acknowledge_recaps", { p_through: through });
}

// --- Streak recovery: his rescue quest ------------------------------------------
// The rules live in the database (pick_rescue_job / complete_rescue,
// 20260928000014_streak_recovery.sql): his own open rescue, one of the
// offered jobs, not past due. Completing deals boss damage and XP now; the
// streak repairs in tonight's reset.

/** Pick (or change) which offered job he'll do. */
export async function pickRescueJob(rescueId: string, jobId: string): Promise<ActionResult<StreakRescue>> {
  await requireRole("child");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pick_rescue_job", { p_rescue_id: rescueId, p_job_id: jobId });
  if (error || !data) return { ok: false, error: friendlyRescueError(error?.message, "Hmm, that didn't work — try picking again.") };
  return { ok: true, data };
}

/** He's done his picked rescue job. */
export async function completeRescue(rescueId: string): Promise<ActionResult<StreakRescue>> {
  await requireRole("child");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_rescue", { p_rescue_id: rescueId });
  if (error || !data) return { ok: false, error: friendlyRescueError(error?.message, "Hmm, that didn't save — give it another tap.") };
  return { ok: true, data: data.rescue };
}
