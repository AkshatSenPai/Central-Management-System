import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listAssignedTasks, listMySequences } from "@/lib/task-queries";
import {
  parseMyTaskScope,
  parseMyTaskSort,
  parseTaskStatusFilter,
  taskListSummary,
} from "@/lib/task";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskStatusFilter } from "@/components/tasks/task-status-filter";
import { MyTaskSort } from "@/components/tasks/my-task-sort";
import { MyTaskScope } from "@/components/tasks/my-task-scope";
import { MyTasksViewSwitch } from "@/components/tasks/my-tasks-view-switch";
import { TaskSequences } from "@/components/tasks/task-sequences";

function first(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

export default async function MyTasksPage(props: {
  searchParams: Promise<{
    status?: string | string[];
    sort?: string | string[];
    scope?: string | string[];
    view?: string | string[];
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;

  const raw = await props.searchParams;
  const status = parseTaskStatusFilter(raw.status);
  const sort = parseMyTaskSort(raw.sort);
  const scope = parseMyTaskScope(raw.scope);
  // Anything that is not "sequences" is the list, so a mistyped parameter
  // lands on the view that has always been there rather than a blank page.
  const view = first(raw.view) === "sequences" ? "sequences" : "list";

  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: { status: { not: "DONE" } },
      // The client's name comes along for the scope picker's option labels;
      // TaskForm ignores it.
      select: { id: true, name: true, clientId: true, client: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const listRows =
    view === "list" ? await listAssignedTasks(prisma, { userId, status, sort, scope }) : [];
  const sequenceData = view === "sequences" ? await listMySequences(prisma, { userId }) : null;

  // The default view is open-only — listAssignedTasks applies status: { not: "DONE" }
  // exactly when there is no filter — so a "done" fraction of its rows is
  // structurally always zero there; only the ALL view's rows can actually
  // contain DONE work, so only ALL gets the "N tasks · M done" phrasing.
  // Every other view (the default, and any single-status filter) is a bare
  // count.
  const subtitle =
    view === "sequences"
      ? `${sequenceData?.sequences.length ?? 0} sequences`
      : taskListSummary(listRows, { filtered: status !== "ALL" });

  return (
    <div className="space-y-6 p-4 sm:p-8">
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

      <MyTasksViewSwitch
        view={view}
        status={first(raw.status)}
        sort={first(raw.sort)}
        scope={first(raw.scope)}
      />

      {view === "sequences" && sequenceData ? (
        /* No filter controls here on purpose: listMySequences ignores the
           status filter, because a sequence with its completed links hidden is
           unreadable. Rendering a filter that is being ignored is worse than
           not offering one — the parameters still ride along in the URL so the
           List view finds them again. Spec §8. */
        <TaskSequences sequences={sequenceData.sequences} unsequenced={sequenceData.unsequenced} />
      ) : (
        <>
          <TaskStatusFilter status={status}>
            <MyTaskSort sort={sort} />
            <MyTaskScope
              scope={scope}
              projects={projects.map((p) => ({
                id: p.id,
                name: p.name,
                clientName: p.client.name,
              }))}
            />
          </TaskStatusFilter>

          {listRows.length === 0 ? (
            <EmptyState message="Nothing assigned to you." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              {listRows.map((row) => (
                <TaskRow key={row.id} row={row} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
