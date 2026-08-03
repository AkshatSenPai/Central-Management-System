import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { announcementSummary, isPinned, pinLabel, sortAnnouncements } from "@/lib/announcement";
import { relativeTime } from "@/lib/dates";
import { clientInitials } from "@/lib/client";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { PlainText } from "@/components/ui/plain-text";
import { AnnouncementForm } from "@/components/announcements/announcement-form";
import { AnnouncementDeleteButton } from "@/components/announcements/announcement-delete-button";

/** Spec 6.3. Any member may post; pinning puts it on the dashboard until a
 * date it chooses for itself. */
export default async function AnnouncementsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const now = new Date();
  const [rows, members] = await Promise.all([
    prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        body: true,
        pinnedUntil: true,
        createdAt: true,
        authorId: true,
        author: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const sorted = sortAnnouncements(rows, now);
  const pinnedCount = rows.filter((r) => isPinned(r.pinnedUntil, now)).length;
  const isAdmin = session.user.role === "ADMIN";

  return (
    <div className="mx-auto max-w-[840px] space-y-5 px-6 pb-10 pt-5">
      <PageHeader
        title="Announcements"
        subtitle={announcementSummary(rows.length, pinnedCount)}
        action={<AnnouncementForm />}
      />

      {sorted.length === 0 ? (
        <EmptyState message="Nothing posted yet. Announcements reach everyone, and can be pinned to the dashboard." />
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((a) => {
            const pinned = pinLabel(a.pinnedUntil, now);
            const canManage = a.authorId === session.user.id || isAdmin;
            return (
              <article
                key={a.id}
                // A pinned notice carries the accent border, so the board's
                // priority is visible before a word of it is read.
                className={`rounded-[10px] border bg-[var(--surface)] p-4 shadow-[var(--shadow)] ${
                  pinned ? "border-[var(--accent-line)]" : "border-[var(--border)]"
                }`}
              >
                <div className="mb-2 flex items-center gap-2.5">
                  {pinned ? (
                    <span className="flex flex-none items-center gap-1 rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10.5px] font-bold text-[var(--accent)]">
                      <Icon name="campaign" size="sm" />
                      {pinned}
                    </span>
                  ) : null}
                  <h2 className="min-w-0 flex-1 text-[14.5px] font-bold tracking-[-0.01em] text-[var(--text)]">
                    {a.title}
                  </h2>
                  <span className="flex-none text-[11.5px] text-[var(--text-3)]">
                    {relativeTime(a.createdAt, now)}
                  </span>
                </div>

                {/* Same renderer as comments and client notes — links and
                    @mentions live, and no HTML anywhere in the path. */}
                <PlainText
                  body={a.body}
                  members={members}
                  className="text-[13.5px] leading-[1.6] text-[var(--text-2)]"
                />

                <div className="mt-3 flex items-center gap-2.5 border-t border-[var(--border)] pt-3">
                  <InitialsAvatar
                    initials={clientInitials(a.author.name)}
                    shape="circle"
                    size={24}
                  />
                  <span className="text-[12.5px] text-[var(--text-2)]">{a.author.name}</span>
                  <span className="flex-1" />
                  {canManage ? (
                    <>
                      <AnnouncementForm
                        announcement={{
                          id: a.id,
                          title: a.title,
                          body: a.body,
                          pinnedUntil: a.pinnedUntil,
                        }}
                      />
                      <AnnouncementDeleteButton announcementId={a.id} />
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
