import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <LoginForm
      initialError={
        error === "confirm"
          ? "That confirmation link is invalid or has expired."
          : undefined
      }
    />
  );
}
