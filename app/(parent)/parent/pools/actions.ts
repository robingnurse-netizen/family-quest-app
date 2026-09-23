"use server";

import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { isDayKey, weekStartOf } from "@/lib/calendar/dates";
import { isPoolColor } from "@/lib/backlog/colors";
import { friendlyBacklogError } from "@/lib/backlog/errors";
import type { ActionResult } from "@/lib/backlog/types";
import type { WeeklyPool } from "@/lib/supabase/types";

const MAX_POOL_MINUTES = 7 * 24 * 60;

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

/**
 * Create (no `id`) or update (with `id`) a weekly pool. Either parent may
 * edit any family pool — RLS enforces family + parent; the integrity
 * triggers stop a pool shrinking below what's already scheduled.
 */
export async function savePool(formData: FormData): Promise<ActionResult<WeeklyPool>> {
  const profile = await requireRole("parent");
  const supabase = await createClient();

  const id = field(formData, "id");
  const childId = field(formData, "child_id");
  const week = field(formData, "week_start_date");
  const title = field(formData, "title");
  const category = field(formData, "category") || null;
  const color = field(formData, "color");
  const totalMinutes = Number(field(formData, "total_minutes"));

  if (!title) return { ok: false, error: "Give the weekly quest a title." };
  if (title.length > 120) return { ok: false, error: "That title is a bit long." };
  if (!isDayKey(week)) return { ok: false, error: "Pick a week." };
  if (!Number.isInteger(totalMinutes) || totalMinutes <= 0 || totalMinutes > MAX_POOL_MINUTES) {
    return { ok: false, error: "Total minutes must be a whole number above zero." };
  }
  if (!isPoolColor(color)) return { ok: false, error: "Pick a colour." };

  // The child must be a player in this family.
  const { data: child } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", childId)
    .eq("family_id", profile.family_id)
    .eq("role", "child")
    .maybeSingle();
  if (!child) return { ok: false, error: "Pick who this weekly quest is for." };

  const values = {
    child_id: child.id,
    week_start_date: weekStartOf(week),
    title,
    category,
    color,
    total_minutes: totalMinutes,
  };

  const query = id
    ? supabase
        .from("weekly_pools")
        .update(values)
        .eq("id", id)
        .eq("family_id", profile.family_id)
    : supabase
        .from("weekly_pools")
        .insert({ ...values, family_id: profile.family_id, created_by: profile.id });

  const { data, error } = await query.select().single();
  if (error || !data) {
    return { ok: false, error: friendlyBacklogError(error?.message, "Couldn't save that weekly quest.") };
  }
  return { ok: true, data };
}

/** Delete a pool; its task slots go with it (on delete cascade). */
export async function deletePool(id: string): Promise<ActionResult<string>> {
  const profile = await requireRole("parent");
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("weekly_pools")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("family_id", profile.family_id);

  if (error) return { ok: false, error: "Couldn't delete that weekly quest." };
  if (!count) return { ok: false, error: "That weekly quest no longer exists." };
  return { ok: true, data: id };
}
