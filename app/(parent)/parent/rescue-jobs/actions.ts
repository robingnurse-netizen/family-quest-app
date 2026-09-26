"use server";

import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/backlog/types";
import type { RescueJob } from "@/lib/supabase/types";

// The rescue-quest pool (streak recovery, 20260928000014_streak_recovery.sql):
// when his streak cracks he's offered up to 5 of the active jobs to choose
// from. RLS limits writes to the family's parents. Jobs are hidden, not
// deleted (open rescues keep a snapshot of what they offered anyway).

/** Add a rescue job. */
export async function addRescueJob(title: string, minutes: number): Promise<ActionResult<RescueJob>> {
  const profile = await requireRole("parent");
  const name = title.trim();
  if (!name) return { ok: false, error: "Give the job a name." };
  if (name.length > 80) return { ok: false, error: "That name is a bit long." };
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 60) {
    return { ok: false, error: "Rescue jobs take 5–60 minutes." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rescue_jobs")
    .insert({ family_id: profile.family_id, title: name, minutes, created_by: profile.id })
    .select()
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add that job." };
  return { ok: true, data };
}

/** Hide (not offered any more) or show a rescue job. */
export async function setRescueJobActive(id: string, active: boolean): Promise<ActionResult<RescueJob>> {
  const profile = await requireRole("parent");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rescue_jobs")
    .update({ active })
    .eq("id", id)
    .eq("family_id", profile.family_id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't update that job." };
  if (!data) return { ok: false, error: "That job no longer exists." };
  return { ok: true, data };
}
