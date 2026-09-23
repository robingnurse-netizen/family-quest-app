"use client";

import { useCallback, useMemo, useState } from "react";
import type { CalendarEvent } from "@/lib/supabase/types";
import type { CalendarActions, CalendarMember } from "@/lib/calendar/types";
import {
  addMonths,
  eventDaySpan,
  formatDayLabel,
  formatMonthLabel,
  monthGrid,
  monthKeyOf,
  parseDayKey,
  timeOf,
} from "@/lib/calendar/dates";
import type { CalendarOccurrence } from "@/lib/calendar/recurrence";
import { occurrencesByDay } from "@/lib/calendar/by-day";
import { useCalendarEvents } from "@/lib/hooks/use-calendar-events";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { WaxSeal } from "@/components/ui/wax-seal";
import { EventDialog, type DialogState } from "./event-dialog";
import { calendarThemes, type CalendarVariant } from "./theme";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

type Props = {
  familyId: string;
  timeZone: string;
  initialMonth: string;
  today: string;
  initialEvents: CalendarEvent[];
  members: CalendarMember[];
  variant: CalendarVariant;
  /** Provide to make the calendar editable (parents). Omit for read-only. */
  actions?: CalendarActions;
  /** Extra content under a day's events (the Quest Log's quest chips). */
  renderDayExtras?: (day: string) => React.ReactNode;
  /** Told when the visible month changes (to load month-specific extras). */
  onMonthChange?: (month: string) => void;
};

/**
 * Month-view family calendar shared by Parent HQ (editable) and the player
 * dashboard (read-only). Same data, same layout; `variant` picks the skin and
 * `actions` switches the edit controls on.
 */
export function MonthCalendar({
  familyId,
  timeZone,
  initialMonth,
  today,
  initialEvents,
  members,
  variant,
  actions,
  renderDayExtras,
  onMonthChange,
}: Props) {
  const theme = calendarThemes[variant];
  const editable = Boolean(actions);

  const [month, setMonth] = useState(initialMonth);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const { events, loading, upsertLocal, removeLocal } = useCalendarEvents({
    familyId,
    timeZone,
    month,
    initialEvents,
  });

  const grid = useMemo(() => monthGrid(month), [month]);

  // Expand recurring series, then bucket each occurrence onto every day it
  // covers within the visible grid.
  const byDay = useMemo(
    () => occurrencesByDay(events, grid[0], grid[grid.length - 1], timeZone, today),
    [events, grid, timeZone, today],
  );

  const seriesById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  const eventsForDay = useCallback((day: string) => byDay.get(day) ?? [], [byDay]);

  const memberNames = useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, m.display_name])),
    [members],
  );

  function goTo(target: string) {
    setMonth(target);
    onMonthChange?.(target);
    // Keep the month in the URL so a refresh (or PWA relaunch) stays put.
    const url = new URL(window.location.href);
    url.searchParams.set("month", target);
    window.history.replaceState(null, "", url);
  }

  // Parents edit the underlying row (for a series, that's every repeat);
  // the read-only view shows the specific occurrence that was tapped.
  const openOccurrence = useCallback(
    (occ: CalendarOccurrence) => {
      const series = seriesById.get(occ.id);
      if (editable && series) setDialog({ kind: "edit", event: series });
      else setDialog({ kind: "view", event: occ });
    },
    [editable, seriesById],
  );

  return (
    <section className={theme.shell} aria-label="Family calendar">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className={theme.title}>
          {formatMonthLabel(month)}
          {loading && <span className="sr-only"> (loading)</span>}
        </h2>
        <nav className="flex items-center gap-1" aria-label="Change month">
          <button
            type="button"
            onClick={() => goTo(addMonths(month, -1))}
            className={theme.navButton}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            onClick={() => goTo(monthKeyOf(today))}
            className={theme.navButton}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => goTo(addMonths(month, 1))}
            className={theme.navButton}
            aria-label="Next month"
          >
            <ChevronRight />
          </button>
        </nav>
      </header>

      <div
        className={`grid grid-cols-7 gap-px overflow-hidden transition-opacity ${theme.grid} ${loading ? "opacity-60" : ""}`}
      >
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className={`pb-1 text-center uppercase tracking-wide ${theme.weekday}`}
          >
            {d}
          </div>
        ))}

        {grid.map((day) => {
          const inMonth = monthKeyOf(day) === month;
          const dayEvents = eventsForDay(day);
          const shown = dayEvents.slice(0, MAX_CHIPS);
          const hidden = dayEvents.length - shown.length;
          const isToday = day === today;

          return (
            <div
              key={day}
              onClick={editable ? () => setDialog({ kind: "create", day }) : undefined}
              className={`flex min-h-[4.75rem] min-w-0 flex-col gap-0.5 p-1 sm:min-h-24 sm:p-1.5 ${
                inMonth ? theme.cell : theme.cellOutside
              } ${editable ? `cursor-pointer ${theme.cellHover}` : ""}`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDialog(editable ? { kind: "create", day } : { kind: "day", day });
                }}
                aria-label={
                  editable
                    ? `Add event on ${formatDayLabel(day)}`
                    : `${formatDayLabel(day)}: ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`
                }
                className={
                  isToday && theme.todaySeal
                    ? "-ml-0.5 -mt-0.5 shrink-0 self-start"
                    : `flex h-6 w-6 shrink-0 items-center justify-center self-start ${theme.dayShape} ${
                        isToday ? theme.today : inMonth ? theme.dayNumber : ""
                      }`
                }
              >
                {isToday && theme.todaySeal ? (
                  <WaxSeal size="sm">{parseDayKey(day).day}</WaxSeal>
                ) : (
                  parseDayKey(day).day
                )}
              </button>

              {shown.map((event) => {
                const startsToday = eventDaySpan(event, timeZone).first === day;
                return (
                  <button
                    key={event.occurrenceKey}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openOccurrence(event);
                    }}
                    title={event.title}
                    className={`w-full truncate px-1 py-0.5 text-left leading-tight ${theme.chipShape} ${
                      event.all_day ? theme.chipAllDay : theme.chip
                    }`}
                  >
                    {!event.all_day && startsToday && (
                      <span className={`mr-1 hidden sm:inline ${theme.chipTime}`}>
                        {timeOf(event.start_time, timeZone)}
                      </span>
                    )}
                    {event.title}
                  </button>
                );
              })}

              {hidden > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDialog({ kind: "day", day });
                  }}
                  className={`text-left ${theme.chipText} ${theme.more}`}
                >
                  +{hidden} more
                </button>
              )}
              {renderDayExtras?.(day)}
            </div>
          );
        })}
      </div>

      <EventDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onOpen={setDialog}
        onOpenOccurrence={openOccurrence}
        theme={theme}
        timeZone={timeZone}
        actions={actions}
        memberNames={memberNames}
        eventsForDay={eventsForDay}
        onSaved={upsertLocal}
        onDeleted={removeLocal}
      />
    </section>
  );
}
