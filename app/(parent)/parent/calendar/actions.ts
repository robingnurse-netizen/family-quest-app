"use server";

import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { isDayKey, isTimeString, zonedToUtc } from "@/lib/calendar/dates";
import { buildWeeklyRule, isWeekdayCode } from "@/lib/calendar/recurrence";
import type { DeleteActionResult, EventActionResult } from "@/lib/calendar/types";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

/**
 * Create (no `id`) or update (with `id`) a calendar event. Any parent in the
 * family may edit any family event — RLS enforces the family + parent check,
 * this just validates input and converts wall-clock times using the family's
 * timezone (read from the DB, never trusted from the client).
 */
export async function saveCalendarEvent(formData: FormData): Promise<EventActionResult> {
  const profile = await requireRole("parent");
  const supabase = await createClient();

  const id = field(formData, "id");
  const title = field(formData, "title");
  const description = field(formData, "description") || null;
  const location = field(formData, "location") || null;
  const allDay = formData.get("all_day") === "on";
  const startDate = field(formData, "start_date");
  const endDate = field(formData, "end_date") || startDate;
  const startTime = field(formData, "start_time");
  const endTime = field(formData, "end_time");
  const repeats = formData.get("repeats") === "on";
  const repeatDays = formData.getAll("byday").map(String).filter(isWeekdayCode);
  const repeatUntil = field(formData, "repeat_until") || null;

  if (!title) return { ok: false, error: "Give the event a title." };
  if (title.length > 200) return { ok: false, error: "That title is a bit long." };
  if (!isDayKey(startDate) || !isDayKey(endDate)) {
    return { ok: false, error: "Pick a valid start and end date." };
  }
  if (!allDay && (!isTimeString(startTime) || !isTimeString(endTime))) {
    return { ok: false, error: "Pick a start and end time, or mark it all-day." };
  }
  if (repeats) {
    if (repeatDays.length === 0) {
      return { ok: false, error: "Pick at least one day for it to repeat on." };
    }
    if (repeatUntil && (!isDayKey(repeatUntil) || repeatUntil < startDate)) {
      return { ok: false, error: "The repeat end date must be on or after the start date." };
    }
  }

  const { data: family } = await supabase
    .from("families")
    .select("timezone")
    .eq("id", profile.family_id)
    .single();
  const tz = family?.timezone ?? "Europe/London";

  const start = zonedToUtc(startDate, allDay ? "00:00" : startTime, tz);
  const end = zonedToUtc(endDate, allDay ? "00:00" : endTime, tz);
  if (end < start) return { ok: false, error: "The event ends before it starts." };

  const values = {
    title,
    description,
    location,
    all_day: allDay,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    // Unchecking "Repeats" clears the rule, turning a series back into one event.
    recurrence_rule: repeats ? buildWeeklyRule(repeatDays, repeatUntil, tz) : null,
  };

  const query = id
    ? supabase
        .from("calendar_events")
        .update(values)
        .eq("id", id)
        .eq("family_id", profile.family_id)
    : supabase
        .from("calendar_events")
        .insert({ ...values, family_id: profile.family_id, created_by: profile.id });

  const { data, error } = await query.select().single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Couldn't save that event." };
  }
  return { ok: true, event: data };
}

export async function deleteCalendarEvent(id: string): Promise<DeleteActionResult> {
  const profile = await requireRole("parent");
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("calendar_events")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("family_id", profile.family_id);

  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "That event no longer exists." };
  return { ok: true, id };
}
