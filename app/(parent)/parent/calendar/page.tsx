import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadCalendar } from "@/lib/calendar/queries";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { deleteCalendarEvent, saveCalendarEvent } from "./actions";

export default async function ParentCalendarPage(props: PageProps<"/parent/calendar">) {
  const profile = await requireRole("parent");
  const { month } = await props.searchParams;
  const calendar = await loadCalendar(profile.family_id, month);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <header className="mb-6">
        <Link
          href="/parent"
          className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
        >
          ← Parent HQ
        </Link>
        <h1 className="text-3xl font-black text-slate-900">Family calendar</h1>
        <p className="text-sm text-slate-600">
          Click a day to add an event. Times are shown in {calendar.timeZone}.
        </p>
      </header>

      <MonthCalendar
        variant="parent"
        familyId={calendar.familyId}
        timeZone={calendar.timeZone}
        initialMonth={calendar.month}
        today={calendar.today}
        initialEvents={calendar.events}
        members={calendar.members}
        actions={{ save: saveCalendarEvent, remove: deleteCalendarEvent }}
      />
    </main>
  );
}
