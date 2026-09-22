import { logout } from "@/app/(auth)/actions";

export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action={logout}>
      <button
        type="submit"
        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${className}`}
      >
        Sign out
      </button>
    </form>
  );
}
