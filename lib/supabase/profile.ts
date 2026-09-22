import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./server";
import type { Profile, Role } from "./types";

/** The signed-in user's profile, or null. Deduped per request. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return data;
});

export function homePathFor(role: Role) {
  return role === "parent" ? "/parent" : "/player";
}

/**
 * Guard for role-specific pages: signed-out users go to /login, and users
 * with the other role are sent to their own dashboard.
 */
export async function requireRole(role: Role): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== role) redirect(homePathFor(profile.role));
  return profile;
}
