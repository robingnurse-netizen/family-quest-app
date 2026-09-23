"use client";

import { addDays, formatWeekLabel, weekStartOf } from "@/lib/calendar/dates";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";

/** Prev / Today / Next for a Mon–Sun week, matching the calendar's nav. */
export function WeekNav({
  week,
  today,
  onChange,
  titleClassName,
  buttonClassName,
}: {
  week: string;
  today: string;
  onChange: (week: string) => void;
  titleClassName: string;
  /** The nav buttons' full styling (each board has its own look). */
  buttonClassName: string;
}) {
  const button = buttonClassName;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className={titleClassName}>{formatWeekLabel(week)}</h2>
      <nav className="flex items-center gap-1" aria-label="Change week">
        <button
          type="button"
          onClick={() => onChange(addDays(week, -7))}
          className={button}
          aria-label="Previous week"
        >
          <ChevronLeft />
        </button>
        <button type="button" onClick={() => onChange(weekStartOf(today))} className={button}>
          Today
        </button>
        <button
          type="button"
          onClick={() => onChange(addDays(week, 7))}
          className={button}
          aria-label="Next week"
        >
          <ChevronRight />
        </button>
      </nav>
    </div>
  );
}

/** Keep the visible week in the URL so a refresh (or PWA relaunch) stays put. */
export function syncWeekParam(week: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("week", week);
  window.history.replaceState(null, "", url);
}
