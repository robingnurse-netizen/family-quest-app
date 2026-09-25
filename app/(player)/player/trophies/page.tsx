import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadTrophyCase } from "@/lib/rpg/queries";
import { TrophyCase } from "@/components/rpg/trophy-case";
import { ChevronLeft, FlameIcon } from "@/components/ui/icons";
import { GameHeading } from "@/components/ui/game-heading";
import { pixelButtonClass } from "@/components/ui/pixel-button";

// The Trophy Case (bestiary): every boss, beaten ones lit up, and his
// best-ever streak. Read-only. Reached from the gear menu for now — a
// temporary spot until the Camp hub screen exists (backlog, Tier 3), where
// it will live.
export default async function PlayerTrophiesPage() {
  const profile = await requireRole("child");
  const { trophies, bestStreak, timeZone } = await loadTrophyCase(profile.family_id, profile.id);
  const beaten = trophies.filter((t) => t.state === "defeated").length;

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
              Trophy Case
            </GameHeading>
            <p className="text-world-text">
              Every boss you beat lights up here. {beaten} of {trophies.length} defeated so far.
            </p>
          </div>
        </header>

        <div className="space-y-6">
          {/* His best-ever streak. */}
          <div className="panel panel-stone flex items-center gap-4 p-4 sm:p-5">
            <FlameIcon className="h-12 w-12 shrink-0" />
            <div>
              <p className="font-display text-base font-semibold uppercase tracking-wide text-stone-text">
                Best-ever streak
              </p>
              {/* Numbers in the body font (the digit rule). */}
              <p className="text-4xl font-black leading-none tabular-nums text-gold text-shadow-pixel">
                {bestStreak}
                <span className="ml-2 font-display text-2xl font-semibold">{bestStreak === 1 ? "day" : "days"}</span>
              </p>
            </div>
          </div>

          <TrophyCase trophies={trophies} timeZone={timeZone} />
        </div>
      </div>
    </main>
  );
}
