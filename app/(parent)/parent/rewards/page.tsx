import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadRewardStore } from "@/lib/rewards/queries";
import { ParentRewards } from "@/components/rewards/parent-rewards";
import { PartyHealLog } from "@/components/rewards/party-heal-log";
import { createClient } from "@/lib/supabase/server";
import { deleteReward, resolveRedemption, saveReward, setRewardActive } from "./actions";

export default async function ParentRewardsPage() {
  const profile = await requireRole("parent");
  const supabase = await createClient();
  const [store, { data: heals }, { data: potions }] = await Promise.all([
    loadRewardStore(profile),
    supabase
      .from("party_log")
      .select("*")
      .eq("family_id", profile.family_id)
      .order("created_at", { ascending: false })
      .limit(15),
    supabase.from("potions").select("*").order("sort_order"),
  ]);

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

      <PartyHealLog
        entries={heals ?? []}
        potions={potions ?? []}
        names={Object.fromEntries(store.members.map((m) => [m.id, m.display_name]))}
        timeZone={store.timeZone}
      />
    </main>
  );
}
