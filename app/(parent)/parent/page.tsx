import Link from "next/link";
import { requireRole } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/layout/sign-out-button";

export default async function ParentDashboard() {
  const profile = await requireRole("parent");
  const supabase = await createClient();

  const [{ data: family }, { data: members }] = await Promise.all([
    supabase.from("families").select("*").eq("id", profile.family_id).single(),
    supabase
      .from("profiles")
      .select("id, display_name, role")
      .eq("family_id", profile.family_id)
      .order("created_at"),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
            Parent HQ
          </p>
          <h1 className="text-3xl font-black text-slate-900">
            {family?.name ?? "Your family"}
          </h1>
        </div>
        <SignOutButton className="bg-slate-200 text-slate-700 hover:bg-slate-300" />
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold text-slate-900">Party members</h2>
          <ul className="space-y-2">
            {members?.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span className="text-slate-800">{m.display_name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  {m.role === "parent" ? "Parent" : "Player"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-bold text-slate-900">Invite code</h2>
          <p className="mb-3 text-sm text-slate-600">
            Share this so another parent or your player can join the family at
            sign-up.
          </p>
          <p className="font-mono text-2xl font-bold tracking-widest text-indigo-700">
            {family?.invite_code}
          </p>
        </div>
      </section>

      <Link
        href="/parent/calendar"
        className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
      >
        <div>
          <h2 className="font-bold text-slate-900">Family calendar</h2>
          <p className="text-sm text-slate-600">
            Add and edit events. {members?.find((m) => m.role === "child")?.display_name ?? "Your player"} sees them live.
          </p>
        </div>
        <span aria-hidden className="text-2xl text-indigo-600">
          →
        </span>
      </Link>

      <p className="mt-8 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
        Weekly task pools and boss management arrive in later phases.
      </p>
    </main>
  );
}
