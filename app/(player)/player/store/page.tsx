import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadRewardStore } from "@/lib/rewards/queries";
import { RewardStore } from "@/components/rewards/reward-store";
import { redeemReward } from "./actions";

export default async function PlayerStorePage() {
  const profile = await requireRole("child");
  const store = await loadRewardStore(profile);

  return (
    <main className="flex-1 bg-gradient-to-b from-indigo-950 via-purple-900 to-indigo-950 px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6">
          <Link href="/player" className="text-sm font-semibold text-amber-300 hover:text-amber-200">
            ← Back to quests
          </Link>
          <h1 className="text-3xl font-black">Rewards store</h1>
          <p className="text-sm text-indigo-200">Spend the gold you win from bosses.</p>
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
