import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadRewardStore } from "@/lib/rewards/queries";
import { ParentRewards } from "@/components/rewards/parent-rewards";
import { deleteReward, resolveRedemption, saveReward, setRewardActive } from "./actions";

export default async function ParentRewardsPage() {
  const profile = await requireRole("parent");
  const store = await loadRewardStore(profile);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <header className="mb-6">
        <Link href="/parent" className="text-sm font-semibold text-indigo-600 hover:text-indigo-500">
          ← Parent HQ
        </Link>
        <h1 className="text-3xl font-black text-slate-900">Rewards</h1>
        <p className="text-sm text-slate-600">
          Things worth saving gold for. Gold is taken when a request is made and given back if you
          deny it.
        </p>
      </header>

      <ParentRewards
        familyId={store.familyId}
        timeZone={store.timeZone}
        members={store.members}
        initial={store}
        resolve={resolveRedemption}
        catalog={{ save: saveReward, remove: deleteReward, setActive: setRewardActive }}
      />
    </main>
  );
}
