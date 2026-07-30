import { prisma } from "@/lib/prisma";
import { inviteStatus } from "@/lib/invites";
import { acceptInviteAction } from "@/server/actions/accept-invite";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const invite = await prisma.invite.findUnique({ where: { token } });
  const status = invite ? inviteStatus(invite) : null;

  if (!invite || status !== "valid") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold text-[var(--text)]">Invite not valid</h1>
          <p className="mt-2 text-sm text-[var(--text-3)]">
            {status === "used"
              ? "This invite has already been used."
              : status === "expired"
                ? "This invite has expired. Ask an admin to send a new one."
                : "This invite link is not valid."}
          </p>
        </div>
      </main>
    );
  }

  const action = acceptInviteAction.bind(null, token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Join the workspace</h1>
          <p className="mt-1 text-sm text-[var(--text-3)]">
            Creating an account for <strong>{invite.email}</strong>
          </p>
        </div>
        {error && (
          <p className="rounded-md bg-[var(--bad-bg)] p-3 text-sm text-[var(--bad)]">
            {error}
          </p>
        )}
        <form action={action} className="space-y-4">
          <label className="block text-sm text-[var(--text)]">
            Your name
            <input
              name="name"
              required
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]"
            />
          </label>
          <label className="block text-sm text-[var(--text)]">
            Password (min 8 characters)
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-[var(--btn)] px-4 py-2 text-[var(--on-btn)] hover:bg-[var(--btn-h)]"
          >
            Create account
          </button>
        </form>
      </div>
    </main>
  );
}
