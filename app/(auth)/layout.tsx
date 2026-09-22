import { redirect } from "next/navigation";
import { getCurrentProfile, homePathFor } from "@/lib/supabase/profile";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Already signed in? Skip the forms.
  const profile = await getCurrentProfile();
  if (profile) redirect(homePathFor(profile.role));

  return (
    <main className="flex flex-1 items-center justify-center bg-gradient-to-b from-indigo-950 via-purple-900 to-indigo-950 px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-4xl font-black tracking-tight text-amber-300 drop-shadow">
          Family Quest
        </h1>
        <div className="rounded-2xl bg-white/95 p-6 shadow-2xl">{children}</div>
      </div>
    </main>
  );
}
