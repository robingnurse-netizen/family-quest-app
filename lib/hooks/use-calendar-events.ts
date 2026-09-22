"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { monthGridRange } from "@/lib/calendar/dates";
import { mayAppearIn, overlapFilter } from "@/lib/calendar/overlap";
import type { CalendarEvent } from "@/lib/supabase/types";

type EventMap = Record<string, CalendarEvent>;

const toMap = (events: CalendarEvent[]) =>
  Object.fromEntries(events.map((e) => [e.id, e])) as EventMap;

function without(map: EventMap, id: string) {
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

/**
 * Family calendar events for the visible month, kept live via Supabase
 * Realtime. Seeded with the server-rendered events; fetches again whenever
 * the month changes or the Realtime channel (re)connects, so nothing is
 * missed between the server render and the subscription going live.
 *
 * Events are cached by id across months as raw rows (a recurring series is
 * one row); callers expand and filter by day.
 */
export function useCalendarEvents({
  familyId,
  timeZone,
  month,
  initialEvents,
}: {
  familyId: string;
  timeZone: string;
  month: string;
  initialEvents: CalendarEvent[];
}) {
  const [supabase] = useState(createClient);
  const [events, setEvents] = useState<EventMap>(() => toMap(initialEvents));
  const [loading, setLoading] = useState(false);
  const monthRef = useRef(month);
  useEffect(() => {
    monthRef.current = month;
  }, [month]);

  const fetchMonth = useCallback(
    async (target: string) => {
      const { start, end } = monthGridRange(target, timeZone);
      const { data, error } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("family_id", familyId)
        .lt("start_time", end)
        .or(overlapFilter(start));
      if (error || !data) return;

      setEvents((prev) => {
        // Replace everything that overlaps this range with the fresh result,
        // so deletions missed while offline disappear too.
        const startMs = Date.parse(start);
        const endMs = Date.parse(end);
        const next: EventMap = {};
        for (const e of Object.values(prev)) {
          if (!mayAppearIn(e, startMs, endMs)) next[e.id] = e;
        }
        for (const e of data) next[e.id] = e;
        return next;
      });
    },
    [supabase, familyId, timeZone],
  );

  // Refetch when the user navigates to another month.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchMonth(month).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [month, fetchMonth]);

  // Live updates. RLS applies to Realtime too, so only this family's rows
  // arrive; the filter just saves bandwidth. Supabase can't filter DELETEs,
  // and under RLS their payload only carries the primary key — which is all
  // we need, and ids from other families simply won't be in our map.
  useEffect(() => {
    const upsert = (row: CalendarEvent) =>
      setEvents((prev) => ({ ...prev, [row.id]: row }));
    const familyFilter = {
      schema: "public",
      table: "calendar_events",
      filter: `family_id=eq.${familyId}`,
    } as const;

    const channel = supabase
      .channel(`calendar_events:${familyId}`)
      .on("postgres_changes", { event: "INSERT", ...familyFilter }, (p) =>
        upsert(p.new as CalendarEvent),
      )
      .on("postgres_changes", { event: "UPDATE", ...familyFilter }, (p) =>
        upsert(p.new as CalendarEvent),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "calendar_events" },
        (p) => {
          const id = (p.old as Partial<CalendarEvent>).id;
          if (id) setEvents((prev) => without(prev, id));
        },
      )
      .subscribe((status) => {
        // Covers the gap between SSR and subscribing, and any reconnect.
        if (status === "SUBSCRIBED") void fetchMonth(monthRef.current);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, familyId, fetchMonth]);

  /** Apply a local change immediately (e.g. after a successful save). */
  const upsertLocal = useCallback((event: CalendarEvent) => {
    setEvents((prev) => ({ ...prev, [event.id]: event }));
  }, []);

  const removeLocal = useCallback((id: string) => {
    setEvents((prev) => without(prev, id));
  }, []);

  return { events: Object.values(events), loading, upsertLocal, removeLocal };
}
