import type { Profile, TaskSlot, TaskSlotStatus, WeeklyPool } from "@/lib/supabase/types";

export type BoardMember = Pick<Profile, "id" | "display_name" | "role">;

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Pool-level numbers derived from its slots. */
export type PoolTotals = {
  allocated: number;
  completed: number;
  remaining: number;
};

export function poolTotals(pool: WeeklyPool, slots: TaskSlot[]): PoolTotals {
  let allocated = 0;
  let completed = 0;
  for (const s of slots) {
    if (s.pool_id !== pool.id) continue;
    allocated += s.duration_minutes;
    if (s.status === "completed") completed += s.duration_minutes;
  }
  return { allocated, completed, remaining: Math.max(0, pool.total_minutes - allocated) };
}

/** Mutations the player's board can call. */
export type BoardActions = {
  createSlot: (poolId: string, day: string, minutes: number) => Promise<ActionResult<TaskSlot>>;
  moveSlot: (slotId: string, day: string) => Promise<ActionResult<TaskSlot>>;
  removeSlot: (slotId: string) => Promise<ActionResult<string>>;
  setSlotStatus: (
    slotId: string,
    status: Exclude<TaskSlotStatus, "missed">,
  ) => Promise<ActionResult<TaskSlot>>;
};

/** "1h 30m", "45m", "2h" */
export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
