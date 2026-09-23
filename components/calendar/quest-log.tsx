"use client";

import { useMemo, useState } from "react";
import type { CalendarEvent } from "@/lib/supabase/types";
import type { CalendarMember } from "@/lib/calendar/types";
import { monthGrid } from "@/lib/calendar/dates";
import { createClient } from "@/lib/supabase/client";
import { fetchQuestLog, type LogQuest } from "@/lib/backlog/quest-log";
import { poolColor } from "@/lib/backlog/colors";
import { MonthCalendar } from "./month-calendar";

const MAX_QUEST_CHIPS = 2;

/**
 * Reuben's Quest Log: the family calendar's month view (read-only, the
 * parchment scroll skin) with his placed quests as small chips under each
 * day's fixed events — completed ones marked HIT!, missed ones faded — so
 * it's a real log of what he did. Quests reload when the month changes.
 */
export function QuestLog({
  familyId,
  childId,
  timeZone,
  initialMonth,
  today,
  initialEvents,
  members,
  initialQuests,
}: {
  familyId: string;
  childId: string;
  timeZone: string;
  initialMonth: string;
  today: string;
  initialEvents: CalendarEvent[];
  members: CalendarMember[];
  initialQuests: LogQuest[];
}) {
  const [supabase] = useState(createClient);
  const [quests, setQuests] = useState(initialQuests);

  async function loadMonth(month: string) {
    const grid = monthGrid(month);
    const data = await fetchQuestLog(supabase, childId, grid[0], grid[grid.length - 1]);
    if (data) setQuests(data);
  }

  const byDay = useMemo(() => {
    const map = new Map<string, LogQuest[]>();
    for (const q of quests) {
      const list = map.get(q.day);
      if (list) list.push(q);
      else map.set(q.day, [q]);
    }
    return map;
  }, [quests]);

  return (
    <MonthCalendar
      variant="player"
      familyId={familyId}
      timeZone={timeZone}
      initialMonth={initialMonth}
      today={today}
      initialEvents={initialEvents}
      members={members}
      onMonthChange={(month) => void loadMonth(month)}
      renderDayExtras={(day) => <QuestChips quests={byDay.get(day) ?? []} />}
    />
  );
}

function QuestChips({ quests }: { quests: LogQuest[] }) {
  if (quests.length === 0) return null;
  const shown = quests.slice(0, MAX_QUEST_CHIPS);
  const more = quests.length - shown.length;
  return (
    <ul className="mt-0.5 space-y-0.5" aria-label="Quests">
      {shown.map((q) => (
        <li
          key={q.id}
          title={`${q.title}${q.hit ? " — hit!" : q.status === "missed" ? " — missed" : ""}`}
          className={`flex min-w-0 items-center gap-0.5 overflow-hidden rounded-[2px] border border-parchment-edge bg-parchment-dark text-ink ${
            q.status === "missed" ? "opacity-60" : ""
          }`}
        >
          <span aria-hidden className="w-1 shrink-0 self-stretch" style={{ backgroundColor: poolColor(q.color) }} />
          <span className={`min-w-0 flex-1 truncate px-0.5 text-[10px] font-bold leading-tight sm:text-xs ${q.status === "missed" ? "line-through" : ""}`}>
            {q.title}
          </span>
          {q.hit && (
            <span className="shrink-0 pr-0.5 font-display text-[10px] font-semibold uppercase leading-none text-[#a61e1e]">
              Hit!
            </span>
          )}
        </li>
      ))}
      {more > 0 && <li className="text-[10px] font-bold text-ink-soft sm:text-xs">+{more} quests</li>}
    </ul>
  );
}
