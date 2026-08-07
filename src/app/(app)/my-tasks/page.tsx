import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listAssignedTasks } from "@/lib/task-queries";
import { parseMyTaskSort, parseTaskStatusFilter, taskListSummary } from "@/lib/task";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskStatusFilter } from "@/components/tasks/task-status-filter";
import { MyTaskSort } from "@/components/tasks/my-task-sort";

export default async function MyTasksPage(props: {
  searchParams: Promise<{ status?: string | string[]; sort?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;

  const raw = await props.searchParams;
  const status = parseTaskStatusFilter(raw.status);
  const sort = parseMyTaskSort(raw.sort);

  const [rows, projects, members] = await Promise.all([
    listAssignedTasks(prisma, { userId, status, sort }),
    prisma.project.findMany({
      where: { status: { not: "DONE" } },
      select: { id: true, name: true, clientId: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // The default view is open-only — listAssignedTasks applies status: { not: "DONE" }
  // exactly when there is no filter — so a "done" fraction of its rows is
  // structurally always zero there; only the ALL view's rows can actually
  // contain DONE work, so only ALL gets the "N tasks · M done" phrasing.
  // Every other view (the default, and any single-status filter) is a bare
  // count.
  const subtitle = taskListSummary(rows, { filtered: status !== "ALL" });

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        title="My Tasks"
        subtitle={subtitle}
        action={
          <TaskForm
            projects={projects}
            milestones={null}
            members={members}
            selectedAssigneeIds={[userId]}
          />
        }
      />

      <TaskStatusFilter status={status}>
        <MyTaskSort sort={sort} />
      </TaskStatusFilter>

      {rows.length === 0 ? (
        <EmptyState message="Nothing assigned to you." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {rows.map((row) => (
            <TaskRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
