import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadRewardStore } from "@/lib/rewards/queries";
import { RewardStore } from "@/components/rewards/reward-store";
import { redeemReward } from "./actions";
import { ChevronLeft } from "@/components/ui/icons";
import { GameHeading } from "@/components/ui/game-heading";
import { pixelButtonClass } from "@/components/ui/pixel-button";

export default async function PlayerStorePage() {
  const profile = await requireRole("child");
  const store = await loadRewardStore(profile);

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
              Rewards store
            </GameHeading>
            <p className="text-world-text">Spend the gold you win from bosses.</p>
          </div>
        </header>

        <RewardStore
          familyId={store.familyId}
          childId={profile.id}
          timeZone={store.timeZone}
          initial={store}
          redeem={redeemReward}
        />
      </div>
    </main>
  );
}
