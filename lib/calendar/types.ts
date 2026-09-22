import type { CalendarEvent, Profile } from "@/lib/supabase/types";

export type CalendarMember = Pick<Profile, "id" | "display_name" | "role">;

export type EventActionResult =
  | { ok: true; event: CalendarEvent }
  | { ok: false; error: string };

export type DeleteActionResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Mutations the calendar can call. Passed in by the parent page only — the
 * player's calendar gets none, which is what makes it read-only.
 */
export type CalendarActions = {
  save: (formData: FormData) => Promise<EventActionResult>;
  remove: (id: string) => Promise<DeleteActionResult>;
};
