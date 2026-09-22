import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/layout/sign-out-button";

export default async function PlayerDashboard() {
  const profile = await requireRole("child");
  const supabase = await createClient();

  const { data: stats } = await supabase
    .from("player_stats")
    .select("gold, xp, level, current_streak")
    .eq("child_id", profile.id)
    .maybeSingle();

  const tiles = [
    { label: "Level", value: stats?.level ?? 1 },
    { label: "XP", value: stats?.xp ?? 0 },
    { label: "Gold", value: stats?.gold ?? 0 },
    { label: "Streak", value: stats?.current_streak ?? 0 },
  ];

  return (
    <main className="flex-1 bg-gradient-to-b from-indigo-950 via-purple-900 to-indigo-950 px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-300">
              Hero
            </p>
            <h1 className="text-3xl font-black">
              Welcome back, {profile.display_name}!
            </h1>
          </div>
          <SignOutButton className="bg-white/10 text-white hover:bg-white/20" />
        </header>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl bg-white/10 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">
                {t.label}
              </p>
              <p className="text-3xl font-black text-amber-300">{t.value}</p>
            </div>
          ))}
        </section>

        <p className="mt-8 rounded-2xl border border-dashed border-white/30 p-6 text-center text-indigo-200">
          Your quest board, boss battles and companion are on their way.
        </p>
      </div>
    </main>
  );
}
