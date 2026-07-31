import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listMyTasks } from "@/lib/task-queries";
import { parseTaskStatusFilter, taskListSummary } from "@/lib/task";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskStatusFilter } from "@/components/tasks/task-status-filter";

export default async function MyTasksPage(props: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;

  const raw = await props.searchParams;
  const status = parseTaskStatusFilter(raw.status);

  const [rows, projects, members] = await Promise.all([
    listMyTasks(prisma, { userId, status }),
    prisma.project.findMany({
      where: { status: { not: "DONE" } },
      select: { id: true, name: true, clientId: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Same rule as ProjectsPage: the default view is open-only, so the
  // "N tasks · M done" summary describes it exactly. Once a status filter is
  // on, that phrasing would lie, so it drops to a plain count.
  const subtitle =
    status === null ? taskListSummary(rows) : `${rows.length} ${rows.length === 1 ? "task" : "tasks"}`;

  // The query already filters to active users, so `active` is always true
  // here — it is still part of AssigneePicker's contract because a future
  // caller (editing a task) unions in the task's current assignees, who may
  // not be.
  const pickerMembers = members.map((m) => ({ id: m.id, name: m.name, active: true }));

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        title="My Tasks"
        subtitle={subtitle}
        action={
          <TaskForm
            projects={projects}
            milestones={null}
            members={pickerMembers}
            selectedAssigneeIds={[userId]}
          />
        }
      />

      <TaskStatusFilter status={status} />

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
