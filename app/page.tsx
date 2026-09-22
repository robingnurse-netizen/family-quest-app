import { redirect } from "next/navigation";
import { getCurrentProfile, homePathFor } from "@/lib/supabase/profile";

export default async function Home() {
  const profile = await getCurrentProfile();
  redirect(profile ? homePathFor(profile.role) : "/login");
}
