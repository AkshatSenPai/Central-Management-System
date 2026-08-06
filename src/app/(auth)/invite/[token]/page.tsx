import { prisma } from "@/lib/prisma";
import { inviteStatus } from "@/lib/invites";
import { knownRedeemError } from "@/lib/invite-errors";
import { acceptInviteAction } from "@/server/actions/accept-invite";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordField } from "@/components/ui/password-field";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  // Allowlist: ?error= is attacker-writable on this public page — only render
  // messages our own redeem flow produces, with a generic fallback otherwise.
  const errorMessage =
    knownRedeemError(error) ?? (error ? "Something went wrong. Please try again." : null);

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
        {errorMessage && (
          <p className="rounded-md bg-[var(--bad-bg)] p-3 text-sm text-[var(--bad)]">
            {errorMessage}
          </p>
        )}
        <form action={action} className="space-y-4">
          <Field label="Your name" className="w-full" name="name" required />
          {/* The one password field in the app where a typo is unrecoverable:
              this is where an account's password is set for the first time,
              and until the admin reset shipped, getting it wrong here meant
              permanently locked out. The toggle is prevention, not
              convenience. */}
          <PasswordField
            label="Password (min 8 characters)"
            className="w-full"
            name="password"
            required
            minLength={8}
          />
          <Button type="submit" variant="primary" size="md" className="w-full">
            Create account
          </Button>
        </form>
      </div>
    </main>
  );
}
