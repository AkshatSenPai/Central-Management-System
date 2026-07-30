import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { InviteForm } from "@/components/members/invite-form";

export default async function MembersPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [members, pendingInvites] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]">Members</h1>
        <p className="mt-1 text-sm text-[var(--text-3)]">Invite and manage your team.</p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-medium text-[var(--text)]">Invite someone</h2>
        <InviteForm />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-[var(--text)]">
          Team ({members.length})
        </h2>
        <table className="w-full max-w-3xl text-left text-sm text-[var(--text)]">
          <thead className="border-b border-[var(--border)] text-[var(--text-3)]">
            <tr>
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-[var(--border)]">
                <td className="py-2">{m.name}</td>
                <td>{m.email}</td>
                <td>{m.role}</td>
                <td>{m.active ? "Active" : "Deactivated"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {pendingInvites.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-[var(--text)]">
            Pending invites ({pendingInvites.length})
          </h2>
          <ul className="max-w-3xl space-y-1 text-sm text-[var(--text-2)]">
            {pendingInvites.map((i) => (
              <li key={i.id}>
                {i.email} — {i.role} — expires {i.expiresAt.toLocaleDateString()}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
