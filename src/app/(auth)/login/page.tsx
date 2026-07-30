import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn, googleEnabled } from "@/auth";

const ERRORS: Record<string, string> = {
  invalid: "Invalid email or password.",
  AccessDenied:
    "That Google account isn't a member of this workspace. Ask an admin for an invite.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; welcome?: string }>;
}) {
  if (await auth()) redirect("/dashboard");
  const params = await searchParams;
  const error = params.error ? (ERRORS[params.error] ?? "Sign-in failed.") : null;

  async function loginAction(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/dashboard",
      });
    } catch (e) {
      if (e instanceof AuthError) redirect("/login?error=invalid");
      throw e; // NEXT_REDIRECT must propagate
    }
  }

  async function googleAction() {
    "use server";
    await signIn("google", { redirectTo: "/dashboard" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        {params.welcome && (
          <p className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
            Account created — sign in to get started.
          </p>
        )}
        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}
        <form action={loginAction} className="space-y-4">
          <label className="block text-sm">
            Email
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            Password
            <input
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            Sign in
          </button>
        </form>
        {googleEnabled && (
          <form action={googleAction}>
            <button
              type="submit"
              className="w-full rounded-md border px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              Continue with Google
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
