"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchWeek } from "@/lib/backlog/fetch-week";
import type { TaskSlot, WeeklyPool } from "@/lib/supabase/types";

type BoardState = {
  week: string;
  pools: Record<string, WeeklyPool>;
  slots: Record<string, TaskSlot>;
};

const byId = <T extends { id: string }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r])) as Record<string, T>;

function omit<T>(map: Record<string, T>, id: string) {
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

/**
 * One week of weekly_pools + task_slots, kept live with Supabase Realtime.
 * Used by both Parent HQ (all children, `childId` null) and the player board
 * (`childId` = the player). Refetches on week change and whenever the
 * Realtime channel (re)connects, so missed changes are picked up.
 *
 * Exposes local upsert/remove helpers for optimistic updates; Realtime then
 * confirms (or a failed server action reverts).
 */
export function useWeekBoard({
  familyId,
  childId,
  week,
  initialPools,
  initialSlots,
}: {
  familyId: string;
  childId: string | null;
  week: string;
  initialPools: WeeklyPool[];
  initialSlots: TaskSlot[];
}) {
  const [supabase] = useState(createClient);
  const [state, setState] = useState<BoardState>(() => ({
    week,
    pools: byId(initialPools),
    slots: byId(initialSlots),
  }));
  const [loading, setLoading] = useState(false);
  const weekRef = useRef(week);
  useEffect(() => {
    weekRef.current = week;
  }, [week]);

  const belongs = useCallback(
    (pool: WeeklyPool, targetWeek: string) =>
      pool.family_id === familyId &&
      pool.week_start_date === targetWeek &&
      (childId === null || pool.child_id === childId),
    [familyId, childId],
  );

  const refetch = useCallback(
    async (target: string) => {
      const result = await fetchWeek(supabase, familyId, target, childId);
      if (!result || weekRef.current !== target) return;
      setState({ week: target, pools: byId(result.pools), slots: byId(result.slots) });
    },
    [supabase, familyId, childId],
  );

  // Refetch when navigating weeks (the first render already has its data).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    refetch(week).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [week, refetch]);

  useEffect(() => {
    const upsertPool = (pool: WeeklyPool) =>
      setState((s) => {
        if (belongs(pool, s.week)) return { ...s, pools: { ...s.pools, [pool.id]: pool } };
        // Moved out of view (e.g. week or child changed): drop it and its slots.
        return dropPool(s, pool.id);
      });

    const upsertSlot = (slot: TaskSlot) =>
      setState((s) =>
        slot.pool_id in s.pools ? { ...s, slots: { ...s.slots, [slot.id]: slot } } : s,
      );

    // RLS applies to Realtime, so task_slots needs no filter (it has no
    // family_id column anyway). DELETE payloads only carry the id.
    const channel = supabase
      .channel(`week_board:${familyId}:${childId ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "weekly_pools", filter: `family_id=eq.${familyId}` },
        (p) => upsertPool(p.new as WeeklyPool),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "weekly_pools", filter: `family_id=eq.${familyId}` },
        (p) => upsertPool(p.new as WeeklyPool),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "weekly_pools" }, (p) => {
        const id = (p.old as Partial<WeeklyPool>).id;
        if (id) setState((s) => dropPool(s, id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_slots" }, (p) =>
        upsertSlot(p.new as TaskSlot),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "task_slots" }, (p) =>
        upsertSlot(p.new as TaskSlot),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "task_slots" }, (p) => {
        const id = (p.old as Partial<TaskSlot>).id;
        if (id) setState((s) => ({ ...s, slots: omit(s.slots, id) }));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refetch(weekRef.current);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, familyId, childId, belongs, refetch]);

  const upsertPoolLocal = useCallback(
    (pool: WeeklyPool) =>
      setState((s) =>
        belongs(pool, s.week) ? { ...s, pools: { ...s.pools, [pool.id]: pool } } : dropPool(s, pool.id),
      ),
    [belongs],
  );
  const removePoolLocal = useCallback((id: string) => setState((s) => dropPool(s, id)), []);
  const upsertSlotLocal = useCallback(
    (slot: TaskSlot) => setState((s) => ({ ...s, slots: { ...s.slots, [slot.id]: slot } })),
    [],
  );
  const removeSlotLocal = useCallback(
    (id: string) => setState((s) => ({ ...s, slots: omit(s.slots, id) })),
    [],
  );

  return {
    pools: Object.values(state.pools).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    slots: Object.values(state.slots).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    loading,
    upsertPoolLocal,
    removePoolLocal,
    upsertSlotLocal,
    removeSlotLocal,
  };
}

function dropPool(s: BoardState, poolId: string): BoardState {
  if (!(poolId in s.pools)) return s;
  const slots = Object.fromEntries(
    Object.entries(s.slots).filter(([, slot]) => slot.pool_id !== poolId),
  );
  return { ...s, pools: omit(s.pools, poolId), slots };
}
