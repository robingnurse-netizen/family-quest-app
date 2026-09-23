import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { PlayerMenu } from "@/components/layout/player-menu";
import { loadCalendar } from "@/lib/calendar/queries";
import { monthKeyOf } from "@/lib/calendar/dates";
import { loadWeekBoard } from "@/lib/backlog/queries";
import { WeekBoard } from "@/components/kanban/week-board";
import { createSlot, moveSlot, removeSlot, setSlotStatus } from "./actions";
import { loadBattle } from "@/lib/rpg/queries";
import { BattleProvider } from "@/components/rpg/battle/battle-provider";
import { BattleScene } from "@/components/rpg/battle/battle-scene";
import { HitOverlay } from "@/components/rpg/battle/hit-overlay";
import { ShopBanner } from "@/components/rewards/shop-banner";
import { loadRewardStore } from "@/lib/rewards/queries";
import { GameHeading } from "@/components/ui/game-heading";

export default async function PlayerDashboard(props: PageProps<"/player">) {
  const profile = await requireRole("child");
  const supabase = await createClient();
  const { week } = await props.searchParams;

  const [{ data: stats }, [board, calendar], battle, store] = await Promise.all([
    supabase
      .from("player_stats")
      .select("gold, xp, level, current_streak")
      .eq("child_id", profile.id)
      .maybeSingle(),
    // The board's day notices come from the calendar for its week's month
    // (that month's grid always covers the whole week).
    loadWeekBoard(profile, week).then(
      async (b) => [b, await loadCalendar(profile.family_id, monthKeyOf(b.week))] as const,
    ),
    loadBattle(profile.family_id),
    loadRewardStore(profile),
  ]);

  const playerStats = {
    level: stats?.level ?? 1,
    xp: stats?.xp ?? 0,
    gold: stats?.gold ?? 0,
    streak: stats?.current_streak ?? 0,
  };

  return (
    // World background, fonts and base text come from app/(player)/layout.tsx.
    <main className="flex-1 px-4 pb-12 pt-8">
      {/* Live battle state + event stream for everything on the page (the
          scene now; the hit overlay and sounds later). One spacing scale:
          gap-6 between sections. */}
      <BattleProvider familyId={battle.familyId} initialBoss={battle.boss} initialParty={battle.party}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <header className="flex items-center justify-between gap-4">
            <GameHeading as="h1" size="lg">
              Welcome back, {profile.display_name}!
            </GameHeading>
            {/* Settings (sign out) tucked into a small gear menu. */}
          <PlayerMenu />
          </header>

          {/* The battle scene: hero and Rogue facing the boss, HUD bars and
              stats. Fixed at the top in normal flow; it never moves. */}
          <BattleScene
            heroName={profile.display_name}
            childId={profile.id}
            stats={playerStats}
            rewards={store.rewards}
          />
          {/* Centre-screen replay of Reuben's own hits, wherever he's scrolled. */}
          <HitOverlay childId={profile.id} />


          <WeekBoard
            familyId={board.familyId}
            childId={profile.id}
            initialWeek={board.week}
            today={board.today}
            initialPools={board.pools}
            initialSlots={board.slots}
            timeZone={calendar.timeZone}
            initialEvents={calendar.events}
            actions={{ createSlot, moveSlot, removeSlot, setSlotStatus }}
          />

          {/* The merchant's stall, after the quests: live gold and the next
              reward in reach (the HUD's Gold stat links to the shop too). */}
          <ShopBanner familyId={profile.family_id} childId={profile.id} initial={store} />
        </div>
      </BattleProvider>
    </main>
  );
}
