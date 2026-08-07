import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listAllTasks } from "@/lib/task-queries";
import { groupTasksByAssignee, parseMyTaskSort, parseTaskStatusFilter } from "@/lib/task";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { MemberTaskGroup } from "@/components/tasks/member-task-group";
import { TaskStatusFilter } from "@/components/tasks/task-status-filter";
import { MyTaskSort } from "@/components/tasks/my-task-sort";

/** Every member's work on one page — who is assigned what, and what state it
 * is in. The first admin-only *page* in the app: admin has so far meant four
 * capabilities (delete a client, invite, manage members, see Settings →
 * Members) and no route of its own.
 *
 * The guard is the first thing here and `listAllTasks` applies none of its
 * own, deliberately: one place to read, one place to get right. It redirects
 * rather than 404s so a non-admin who follows a shared link lands somewhere
 * useful instead of on an error — and to /my-tasks, which is the same page
 * scoped to them, so the redirect reads as an answer rather than a refusal. */
export default async function AllTasksPage(props: {
  searchParams: Promise<{ status?: string | string[]; sort?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/my-tasks");

  const raw = await props.searchParams;
  const status = parseTaskStatusFilter(raw.status);
  const sort = parseMyTaskSort(raw.sort);

  const [rows, members] = await Promise.all([
    listAllTasks(prisma, { status, sort }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const groups = groupTasksByAssignee(rows, members);
  const loaded = groups.filter((g) => g.tasks.length > 0);
  const idle = groups.filter((g) => g.tasks.length === 0);
  const unassignedCount = groups.find((g) => g.id === null)?.tasks.length ?? 0;

  // Counted off `rows`, not by summing the groups: a task with two assignees
  // is filed under both, so the group totals deliberately sum to more than
  // the number of tasks and would overstate the studio's load here.
  const subtitle =
    `${rows.length} ${rows.length === 1 ? "task" : "tasks"} across ${members.length} ` +
    `${members.length === 1 ? "member" : "members"}` +
    (unassignedCount > 0 ? ` · ${unassignedCount} unassigned` : "");

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <PageHeader title="All Tasks" subtitle={subtitle} />

      <TaskStatusFilter status={status}>
        <MyTaskSort sort={sort} />
      </TaskStatusFilter>

      {rows.length === 0 ? (
        <EmptyState message="No tasks match this filter." />
      ) : (
        <div className="space-y-8">
          {loaded.map((group) => (
            <MemberTaskGroup
              key={group.id ?? "unassigned"}
              id={group.id}
              name={group.name}
              initials={group.initials}
              tasks={group.tasks}
            />
          ))}
        </div>
      )}

      {/* Members with nothing assigned are named on one line rather than
          given a block each. Dropping them entirely would lose the fact —
          "nobody has anything for Dana" is worth stating — but seven empty
          headers between the blocks that do have work is exactly the
          "too continuous to scan" problem this page was reported for. */}
      {idle.length > 0 ? (
        <p className="text-xs text-[var(--text-3)]">
          Nothing assigned: {idle.map((g) => g.name).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
