import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadCalendar } from "@/lib/calendar/queries";
import { QuestLog } from "@/components/calendar/quest-log";
import { fetchQuestLog } from "@/lib/backlog/quest-log";
import { monthGrid } from "@/lib/calendar/dates";
import { createClient } from "@/lib/supabase/server";
import { ChevronLeft } from "@/components/ui/icons";
import { GameHeading } from "@/components/ui/game-heading";
import { pixelButtonClass } from "@/components/ui/pixel-button";

// The whole month for Reuben, as an unrolled scroll (read-only): the family
// calendar's fixed events plus his own quests. The quest board links here
// with ?month= for its week.
export default async function QuestLogPage(props: PageProps<"/player/quest-log">) {
  const profile = await requireRole("child");
  const { month } = await props.searchParams;
  const calendar = await loadCalendar(profile.family_id, month);
  const grid = monthGrid(calendar.month);
  const quests = await fetchQuestLog(await createClient(), profile.id, grid[0], grid[grid.length - 1]);

  return (
    // World background, fonts and base text come from app/(player)/layout.tsx.
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 space-y-3">
          <Link href="/player" className={pixelButtonClass("stone", "sm")}>
            <ChevronLeft />
            Back to quests
          </Link>
          <div>
            <GameHeading as="h1" size="lg">
              Quest Log
            </GameHeading>
            <p className="text-world-text">Everything happening this month, and every quest you&apos;ve taken on.</p>
          </div>
        </header>

        {/* Read-only: no calendar edit controls. */}
        <QuestLog
          familyId={calendar.familyId}
          childId={profile.id}
          timeZone={calendar.timeZone}
          initialMonth={calendar.month}
          today={calendar.today}
          initialEvents={calendar.events}
          members={calendar.members}
          initialQuests={quests ?? []}
        />
      </div>
    </main>
  );
}
