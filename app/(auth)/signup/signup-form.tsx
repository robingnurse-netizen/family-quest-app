"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signup, type AuthFormState } from "../actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";

type Mode = "create" | "join";

export function SignupForm() {
  const [mode, setMode] = useState<Mode>("create");
  const [state, action] = useActionState<AuthFormState, FormData>(signup, {});

  return (
    <form action={action} className="space-y-4">
      <h2 className="text-xl font-bold text-slate-900">Create an account</h2>

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-semibold">
        {(
          [
            ["create", "New family"],
            ["join", "Join a family"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`rounded-md px-3 py-1.5 transition ${
              mode === value ? "bg-white text-indigo-700 shadow" : "text-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <input type="hidden" name="mode" value={mode} />

      <FormMessage {...state} />

      {mode === "create" ? (
        <Field label="Family name" name="family_name" placeholder="The Smiths" required />
      ) : (
        <>
          <Field
            label="Invite code"
            name="invite_code"
            placeholder="A1B2C3D4"
            autoCapitalize="characters"
            required
          />
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-slate-700">I am a…</legend>
            <div className="flex gap-4 text-slate-800">
              <label className="flex items-center gap-2">
                <input type="radio" name="role" value="child" defaultChecked /> Player
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="role" value="parent" /> Parent
              </label>
            </div>
          </fieldset>
        </>
      )}

      <Field label="Your name" name="display_name" autoComplete="given-name" required />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <SubmitButton>{mode === "create" ? "Found the family" : "Join the party"}</SubmitButton>

      <p className="text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
