import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadCalendar } from "@/lib/calendar/queries";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { ChevronLeft } from "@/components/ui/icons";
import { GameHeading } from "@/components/ui/game-heading";
import { pixelButtonClass } from "@/components/ui/pixel-button";

// The whole month's family calendar for Reuben, as an unrolled scroll
// (read-only). The quest board links here with ?month= for its week.
export default async function QuestLogPage(props: PageProps<"/player/quest-log">) {
  const profile = await requireRole("child");
  const { month } = await props.searchParams;
  const calendar = await loadCalendar(profile.family_id, month);

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
            <p className="text-world-text">Everything happening this month.</p>
          </div>
        </header>

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
    </main>
  );
}
