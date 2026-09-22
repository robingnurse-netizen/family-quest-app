"use server";

import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { isDayKey } from "@/lib/calendar/dates";
import { friendlyBacklogError } from "@/lib/backlog/errors";
import type { ActionResult } from "@/lib/backlog/types";
import type { TaskSlot, TaskSlotStatus } from "@/lib/supabase/types";

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

/** Remove a slot, returning its minutes to the pool. Completed slots stay. */
export async function removeSlot(slotId: string): Promise<ActionResult<string>> {
  await requireRole("child");
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("task_slots")
    .delete({ count: "exact" })
    .eq("id", slotId)
    .eq("status", "scheduled");
  if (error) return { ok: false, error: "Couldn't remove that slot." };
  if (!count) return { ok: false, error: "Only slots that aren't done yet can be removed." };
  return { ok: true, data: slotId };
}

/** Tap-to-toggle between scheduled and completed. Missed slots are locked. */
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
    .select()
    .maybeSingle();
  if (error) {
    return { ok: false, error: friendlyBacklogError(error.message, "Couldn't update that slot.") };
  }
  if (!data) return { ok: false, error: "That slot can't be changed." };
  return { ok: true, data };
}
