import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { shortDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Badge } from "@/components/ui/badge";
import { InviteForm } from "@/components/members/invite-form";
import { MemberRowActions } from "@/components/members/member-row-actions";

export default async function MembersPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");
  const currentUserId = session.user.id;

  const [members, pendingInvites] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-5 p-4 sm:p-8">
      <PageHeader title="Members" subtitle="Invite and manage your team." />

      <SectionCard title="Invite someone">
        <InviteForm />
      </SectionCard>

      {/* `flush` because the table draws its own row separators and should
          reach the card's edge, like every other row list in the app. */}
      <SectionCard title="Team" meta={members.length} flush>
        {/* min-w so the five columns stay readable on a phone — the flush
            SectionCard body is a horizontal scroll container, so the table
            pans instead of wrapping every cell. */}
        <table className="w-full min-w-[560px] text-left text-sm text-[var(--text)]">
          <thead className="border-b border-[var(--border)] text-xs text-[var(--text-3)]">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-4 py-2.5">{m.name}</td>
                <td className="px-4 py-2.5 text-[var(--text-2)]">{m.email}</td>
                <td className="px-4 py-2.5">
                  <Badge kind={m.role === "ADMIN" ? "strong" : "neutral"}>{m.role}</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <Badge kind={m.active ? "ok" : "neutral"}>
                    {m.active ? "Active" : "Deactivated"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5">
                  <MemberRowActions
                    userId={m.id}
                    role={m.role}
                    active={m.active}
                    isSelf={m.id === currentUserId}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {pendingInvites.length > 0 && (
        <SectionCard title="Pending invites" meta={pendingInvites.length} flush>
          <ul className="text-sm text-[var(--text-2)]">
            {pendingInvites.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5 last:border-b-0"
              >
                <span className="min-w-0 truncate text-[var(--text)]">{i.email}</span>
                <span className="flex flex-none items-center gap-3">
                  <Badge kind="neutral">{i.role}</Badge>
                  {/* shortDate, not toLocaleDateString: every other date in
                      the app renders through the app-timezone helpers, and a
                      raw locale call here would drift by a day near midnight
                      IST. */}
                  <span className="text-xs text-[var(--text-3)]">
                    expires {shortDate(i.expiresAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
