"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type AuthFormState } from "../actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action] = useActionState<AuthFormState, FormData>(login, {
    error: initialError,
  });

  return (
    <form action={action} className="space-y-4">
      <h2 className="text-xl font-bold text-slate-900">Log in</h2>
      <FormMessage {...state} />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <SubmitButton>Start quest</SubmitButton>
      <p className="text-center text-sm text-slate-600">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-indigo-600 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
