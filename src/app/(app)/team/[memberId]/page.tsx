import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMemberProfile } from "@/lib/team-queries";
import { parseTaskStatusFilter, taskListSummary } from "@/lib/task";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskStatusFilter } from "@/components/tasks/task-status-filter";

export default async function MemberProfilePage(props: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { memberId } = await props.params;
  const raw = await props.searchParams;
  const status = parseTaskStatusFilter(raw.status);

  const profile = await getMemberProfile(prisma, memberId, { status });
  if (!profile) notFound();

  return (
    <div className="space-y-6 p-8">
      <nav className="text-xs text-[var(--text-3)]">
        <Link href="/team" className="hover:text-[var(--text-2)]">
          Team
        </Link>
        <span> / </span>
        <span className="text-[var(--text-2)]">{profile.name}</span>
      </nav>

      <div className="flex items-center gap-3">
        <InitialsAvatar initials={profile.initials} shape="circle" size={48} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-[var(--text)]">{profile.name}</h1>
            {profile.active ? null : <Badge kind="neutral">Deactivated</Badge>}
          </div>
          {profile.title ? <p className="text-sm text-[var(--text-3)]">{profile.title}</p> : null}
        </div>
      </div>

      {profile.projects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {profile.projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--surface-2)]"
            >
              {p.clientName} · {p.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-medium text-[var(--text)]">Tasks</h2>
        <span className="text-xs text-[var(--text-3)]">
          {taskListSummary(profile.tasks, { filtered: status !== "ALL" })}
        </span>
      </div>

      <TaskStatusFilter status={status} />

      {profile.tasks.length === 0 ? (
        <EmptyState message="Nothing assigned." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {profile.tasks.map((row) => (
            <TaskRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
