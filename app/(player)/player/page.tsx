import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { loadCalendar } from "@/lib/calendar/queries";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { loadWeekBoard } from "@/lib/backlog/queries";
import { WeekBoard } from "@/components/kanban/week-board";
import { createSlot, moveSlot, removeSlot, setSlotStatus } from "./actions";

export default async function PlayerDashboard(props: PageProps<"/player">) {
  const profile = await requireRole("child");
  const supabase = await createClient();
  const { month, week } = await props.searchParams;

  const [{ data: stats }, calendar, board] = await Promise.all([
    supabase
      .from("player_stats")
      .select("gold, xp, level, current_streak")
      .eq("child_id", profile.id)
      .maybeSingle(),
    loadCalendar(profile.family_id, month),
    loadWeekBoard(profile, week),
  ]);

  const tiles = [
    { label: "Level", value: stats?.level ?? 1 },
    { label: "XP", value: stats?.xp ?? 0 },
    { label: "Gold", value: stats?.gold ?? 0 },
    { label: "Streak", value: stats?.current_streak ?? 0 },
  ];

  return (
    <main className="flex-1 bg-gradient-to-b from-indigo-950 via-purple-900 to-indigo-950 px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-300">
              Hero
            </p>
            <h1 className="text-3xl font-black">
              Welcome back, {profile.display_name}!
            </h1>
          </div>
          <SignOutButton className="bg-white/10 text-white hover:bg-white/20" />
        </header>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl bg-white/10 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">
                {t.label}
              </p>
              <p className="text-3xl font-black text-amber-300">{t.value}</p>
            </div>
          ))}
        </section>

        <div className="mt-8">
          <WeekBoard
            familyId={board.familyId}
            childId={profile.id}
            initialWeek={board.week}
            today={board.today}
            initialPools={board.pools}
            initialSlots={board.slots}
            actions={{ createSlot, moveSlot, removeSlot, setSlotStatus }}
          />
        </div>

        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-300">
            Quest log
          </h2>
          {/* Read-only: no `actions`, so no edit controls. */}
          <MonthCalendar
            variant="player"
            familyId={calendar.familyId}
            timeZone={calendar.timeZone}
            initialMonth={calendar.month}
            today={calendar.today}
            initialEvents={calendar.events}
            members={calendar.members}
          />
        </div>

        <p className="mt-8 rounded-2xl border border-dashed border-white/30 p-6 text-center text-indigo-200">
          Boss battles and your companion are on their way.
        </p>
      </div>
    </main>
  );
}
