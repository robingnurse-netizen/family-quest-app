import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { loadWeekBoard } from "@/lib/backlog/queries";
import { PoolManager } from "@/components/kanban/pool-manager";
import { deletePool, savePool } from "./actions";

export default async function ParentPoolsPage(props: PageProps<"/parent/pools">) {
  const profile = await requireRole("parent");
  const { week } = await props.searchParams;
  const board = await loadWeekBoard(profile, week);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <header className="mb-6">
        <Link href="/parent" className="text-sm font-semibold text-indigo-600 hover:text-indigo-500">
          ← Parent HQ
        </Link>
        <h1 className="text-3xl font-black text-slate-900">Weekly quests</h1>
        <p className="text-sm text-slate-600">
          Give each player weekly quests: minutes to spend during the week. They drag them onto days to plan them.
        </p>
      </header>

      <PoolManager
        familyId={board.familyId}
        initialWeek={board.week}
        today={board.today}
        initialPools={board.pools}
        initialSlots={board.slots}
        members={board.members}
        actions={{ save: savePool, remove: deletePool }}
      />
    </main>
  );
}
