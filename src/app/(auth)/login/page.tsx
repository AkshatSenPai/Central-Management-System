import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn, googleEnabled } from "@/auth";

const ERRORS: Record<string, string> = {
  invalid: "Invalid email or password.",
  config:
    "Sign-in failed because of a server problem, not your credentials. Try again, and tell an admin if it keeps happening.",
  AccessDenied:
    "That Google account isn't a member of this workspace. Ask an admin for an invite.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; welcome?: string }>;
}) {
  if (await auth()) redirect("/my-tasks");
  const params = await searchParams;
  const error = params.error ? (ERRORS[params.error] ?? "Sign-in failed.") : null;

  async function loginAction(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/my-tasks",
      });
    } catch (e) {
      if (e instanceof AuthError) {
        // Only a genuine credentials mismatch is the user's fault; everything
        // else (CallbackRouteError from a down DB, misconfigured secrets, …)
        // used to masquerade as "Invalid email or password".
        if (e.type === "CredentialsSignin") redirect("/login?error=invalid");
        console.error("Auth error during credentials sign-in:", e.type, e.cause ?? e);
        redirect("/login?error=config");
      }
      throw e; // NEXT_REDIRECT must propagate
    }
  }

  async function googleAction() {
    "use server";
    await signIn("google", { redirectTo: "/my-tasks" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Sign in</h1>
        {params.welcome && (
          <p className="rounded-md bg-[var(--ok-bg)] p-3 text-sm text-[var(--ok)]">
            Account created — sign in to get started.
          </p>
        )}
        {error && (
          <p className="rounded-md bg-[var(--bad-bg)] p-3 text-sm text-[var(--bad)]">
            {error}
          </p>
        )}
        <form action={loginAction} className="space-y-4">
          <label className="block text-sm text-[var(--text)]">
            Email
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]"
            />
          </label>
          <label className="block text-sm text-[var(--text)]">
            Password
            <input
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-[var(--btn)] px-4 py-2 text-[var(--on-btn)] hover:bg-[var(--btn-h)]"
          >
            Sign in
          </button>
        </form>
        {googleEnabled && (
          <form action={googleAction}>
            <button
              type="submit"
              className="w-full rounded-md border border-[var(--border)] px-4 py-2 text-[var(--text)] hover:bg-[var(--surface-2)]"
            >
              Continue with Google
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
