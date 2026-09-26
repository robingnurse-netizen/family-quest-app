import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadRewardStore } from "@/lib/rewards/queries";
import { RewardStore } from "@/components/rewards/reward-store";
import { redeemReward } from "./actions";
import { loadBattle } from "@/lib/rpg/queries";
import { BattleProvider } from "@/components/rpg/battle/battle-provider";
import { BattleSounds } from "@/components/rpg/battle/battle-sounds";
import { ChevronLeft } from "@/components/ui/icons";
import { GameHeading } from "@/components/ui/game-heading";
import { pixelButtonClass } from "@/components/ui/pixel-button";

export default async function PlayerStorePage() {
  const profile = await requireRole("child");
  const [store, battle] = await Promise.all([loadRewardStore(profile), loadBattle(profile.family_id)]);

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
              Item Shop
            </GameHeading>
            <p className="text-world-text">
              Spend the gold you win from bosses on real-life treats.
            </p>
          </div>
        </header>

        {/* The battle event stream: the shop emits "purchase" moments into
            it, and BattleSounds plays them. */}
        <BattleProvider familyId={battle.familyId} initialBoss={battle.boss}>
          <RewardStore
            familyId={store.familyId}
            childId={profile.id}
            timeZone={store.timeZone}
            initial={store}
            redeem={redeemReward}
          />
          <BattleSounds childId={profile.id} />
        </BattleProvider>
      </div>
    </main>
  );
}
