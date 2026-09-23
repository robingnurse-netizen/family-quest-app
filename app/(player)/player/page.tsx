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
import { ArrowRight, CoinIcon, FlameIcon, ShieldIcon, StarIcon } from "@/components/ui/icons";
import { Panel, panelClass } from "@/components/ui/panel";
import { pixelButtonClass } from "@/components/ui/pixel-button";
import { GameHeading } from "@/components/ui/game-heading";

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
    { label: "Level", value: stats?.level ?? 1, Icon: ShieldIcon, valueClass: "text-white" },
    { label: "XP", value: stats?.xp ?? 0, Icon: StarIcon, valueClass: "text-white" },
    { label: "Gold", value: stats?.gold ?? 0, Icon: CoinIcon, valueClass: "text-gold" },
    { label: "Streak", value: stats?.current_streak ?? 0, Icon: FlameIcon, valueClass: "text-white" },
  ];

  return (
    // World background, fonts and base text come from app/(player)/layout.tsx.
    <main className="flex-1 px-4 pb-40 pt-8">
      {/* One spacing scale: gap-6 between sections, space-y-3 within a group. */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <GameHeading as="h1" size="lg">
            Welcome back, {profile.display_name}!
          </GameHeading>
          <SignOutButton className={`${pixelButtonClass("stone", "sm")} shrink-0`} />
        </header>

        <div className="space-y-3">
          <HeroParty heroName={profile.display_name} />

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map(({ label, value, Icon, valueClass }) => (
              <Panel key={label} variant="stone" className="flex items-center gap-3 px-3 py-2.5">
                <Icon className="h-8 w-8 shrink-0" />
                <div className="min-w-0">
                  <p className="font-display text-sm font-semibold uppercase tracking-wide text-stone-text">
                    {label}
                  </p>
                  <p className={`font-display text-2xl font-semibold leading-none tabular-nums text-shadow-pixel ${valueClass}`}>
                    {value}
                  </p>
                </div>
              </Panel>
            ))}
          </section>

          <Link
            href="/player/store"
            className={`${panelClass("wood")} flex items-center gap-3 p-4 transition-[filter] hover:brightness-110 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none`}
          >
            <CoinIcon className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <GameHeading as="h2" size="md">
                Rewards store
              </GameHeading>
              <p>Spend your gold on real-life rewards.</p>
            </div>
            <ArrowRight className="h-7 w-7 shrink-0 text-gold" />
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
          <GameHeading size="sm" className="mb-2 uppercase tracking-wide">
            Quest log
          </GameHeading>
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
