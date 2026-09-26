import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { ParentRescueJobs } from "@/components/rescue/parent-rescue-jobs";
import { addRescueJob, setRescueJobActive } from "./actions";

// Parent HQ: the rescue-quest pool (streak recovery). A missed day puts
// the player's streak on hold instead of resetting it; he picks one of up to 5 of
// these to fix it within two days. Also lists any rescue open right now.
export default async function ParentRescueJobsPage() {
  const profile = await requireRole("parent");
  const supabase = await createClient();
  const [{ data: jobs }, { data: open }, { data: members }] = await Promise.all([
    supabase.from("rescue_jobs").select("*").eq("family_id", profile.family_id).order("created_at"),
    supabase.from("streak_rescues").select("*").eq("family_id", profile.family_id).eq("status", "open"),
    supabase.from("profiles").select("id, display_name").eq("family_id", profile.family_id),
  ]);
  const names = Object.fromEntries((members ?? []).map((m) => [m.id, m.display_name]));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <header className="mb-6">
        <Link href="/parent" className="text-sm font-semibold text-indigo-600 hover:text-indigo-500">
          ← Parent HQ
        </Link>
        <h1 className="text-3xl font-black text-slate-900">Rescue quests</h1>
        <p className="text-sm text-slate-600">
          A missed day puts the streak on hold instead of resetting it. To win it back, the player picks one of up
          to 5 of these jobs and does it within two days; otherwise the streak halves. With none here,
          finishing any quest the next day wins it back.
        </p>
      </header>

      {(open ?? []).length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 font-black text-slate-900">Open right now</h2>
          <ul className="space-y-1 text-sm text-slate-700">
            {(open ?? []).map((r) => (
              <li key={r.id}>
                <span className="font-bold">{names[r.child_id] ?? "Player"}</span>: {r.streak_at_crack}-day streak
                on hold — rescue due by the end of {r.due_on}
                {r.fallback ? " (any quest)" : r.completed_at ? ", done ✓" : r.job_title ? `, picked “${r.job_title}”` : ", not picked yet"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ParentRescueJobs initial={jobs ?? []} actions={{ add: addRescueJob, setActive: setRescueJobActive }} />
    </main>
  );
}
