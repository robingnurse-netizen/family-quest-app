import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { loadCalendar } from "@/lib/calendar/queries";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { loadWeekBoard } from "@/lib/backlog/queries";
import { WeekBoard } from "@/components/kanban/week-board";
import { createSlot, moveSlot, removeSlot, setSlotStatus } from "./actions";
import { loadBattle } from "@/lib/rpg/queries";
import { BossStatus } from "@/components/rpg/boss/boss-status";
import { BossHud } from "@/components/rpg/boss/boss-hud";
import { HeroParty } from "@/components/rpg/hero/hero-party";
import { ArrowRight } from "@/components/ui/icons";

export default async function PlayerDashboard(props: PageProps<"/player">) {
  const profile = await requireRole("child");
  const supabase = await createClient();
  const { month, week } = await props.searchParams;

  const [{ data: stats }, calendar, board, battle] = await Promise.all([
    supabase
      .from("player_stats")
      .select("gold, xp, level, current_streak")
      .eq("child_id", profile.id)
      .maybeSingle(),
    loadCalendar(profile.family_id, month),
    loadWeekBoard(profile, week),
    loadBattle(profile.family_id),
  ]);

  const tiles = [
    { label: "Level", value: stats?.level ?? 1 },
    { label: "XP", value: stats?.xp ?? 0 },
    { label: "Gold", value: stats?.gold ?? 0 },
    { label: "Streak", value: stats?.current_streak ?? 0 },
  ];

  return (
    <main className="flex-1 bg-gradient-to-b from-indigo-950 via-purple-900 to-indigo-950 px-4 pb-40 pt-8 text-white">
      {/* One spacing scale: gap-6 between sections, space-y-3 within a group. */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-black">
            Welcome back, {profile.display_name}!
          </h1>
          <SignOutButton className="bg-white/10 text-white hover:bg-white/20" />
        </header>

        <div className="space-y-3">
          <HeroParty heroName={profile.display_name} />

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

          <Link
            href="/player/store"
            className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300/40 bg-amber-400/10 p-4 transition hover:bg-amber-400/20"
          >
            <div>
              <h2 className="font-black text-amber-300">Rewards store</h2>
              <p className="text-sm text-indigo-200">Spend your gold on real-life rewards.</p>
            </div>
            <ArrowRight className="h-6 w-6 shrink-0 text-amber-300" />
          </Link>
        </div>

        {/* Pins to the bottom of the screen once scrolled away, so the
            boss's reactions stay in view while Reuben ticks off quests. */}
        <BossHud>
          <BossStatus
            variant="player"
            familyId={battle.familyId}
            initialBoss={battle.boss}
            initialParty={battle.party}
          />
        </BossHud>

        <WeekBoard
          familyId={board.familyId}
          childId={profile.id}
          initialWeek={board.week}
          today={board.today}
          initialPools={board.pools}
          initialSlots={board.slots}
          actions={{ createSlot, moveSlot, removeSlot, setSlotStatus }}
        />

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-300">
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
        </section>
      </div>
    </main>
  );
}
