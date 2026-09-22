"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homePathFor } from "@/lib/supabase/profile";
import type { Role } from "@/lib/supabase/types";

export type AuthFormState = {
  error?: string;
  message?: string;
};

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function login(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return { error: error.message };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return { error: "This account has no Family Quest profile." };
  }

  redirect(homePathFor(profile.role));
}

export async function signup(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const mode = field(formData, "mode"); // 'create' | 'join'
  const displayName = field(formData, "display_name");
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  const familyName = field(formData, "family_name");
  const inviteCode = field(formData, "invite_code").toUpperCase();

  if (!displayName || !email || !password) {
    return { error: "Name, email and password are all required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  let role: Role;
  let metadata: Record<string, string>;

  if (mode === "create") {
    if (!familyName) return { error: "Give your family a name." };
    role = "parent";
    metadata = { display_name: displayName, role, family_name: familyName };
  } else {
    if (!inviteCode) return { error: "Enter your family's invite code." };
    role = field(formData, "role") === "parent" ? "parent" : "child";
    const { data: found } = await supabase.rpc("lookup_invite_code", {
      code: inviteCode,
    });
    if (!found) return { error: "That invite code doesn't match a family." };
    metadata = { display_name: displayName, role, invite_code: inviteCode };
  }

  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });
  if (error) return { error: error.message };

  // Email confirmation disabled → we already have a session.
  if (data.session) redirect(homePathFor(role));

  return {
    message: `Check ${email} for a confirmation link, then log in.`,
  };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
