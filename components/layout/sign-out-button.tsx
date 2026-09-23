import { logout } from "@/app/(auth)/actions";

/** `className` is the button's full styling: each dashboard has its own look. */
export function SignOutButton({ className }: { className: string }) {
  return (
    <form action={logout}>
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
