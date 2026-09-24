import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadRewardStore } from "@/lib/rewards/queries";
import { RewardStore } from "@/components/rewards/reward-store";
import { buyPotion, redeemReward } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { loadBattle } from "@/lib/rpg/queries";
import { BattleProvider } from "@/components/rpg/battle/battle-provider";
import { BattleSounds } from "@/components/rpg/battle/battle-sounds";
import { ChevronLeft } from "@/components/ui/icons";
import { GameHeading } from "@/components/ui/game-heading";
import { pixelButtonClass } from "@/components/ui/pixel-button";

export default async function PlayerStorePage() {
  const profile = await requireRole("child");
  const supabase = await createClient();
  const [store, battle, { data: potions }] = await Promise.all([
    loadRewardStore(profile),
    loadBattle(profile.family_id),
    supabase.from("potions").select("*").eq("active", true).order("sort_order"),
  ]);

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
              Spend the gold you win from bosses: potions heal the party now, rewards are real-life treats.
            </p>
          </div>
        </header>

        {/* The battle event stream (and the live party HP, for potions): the
            shop emits "purchase" / "potion" moments into it, and
            BattleSounds plays them. */}
        <BattleProvider familyId={battle.familyId} initialBoss={battle.boss} initialParty={battle.party}>
          <RewardStore
            familyId={store.familyId}
            childId={profile.id}
            timeZone={store.timeZone}
            initial={store}
            redeem={redeemReward}
            potions={potions ?? []}
            buyPotion={buyPotion}
          />
          <BattleSounds childId={profile.id} />
        </BattleProvider>
      </div>
    </main>
  );
}
