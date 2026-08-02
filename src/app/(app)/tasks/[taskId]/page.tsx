import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getTaskDetail } from "@/lib/task-queries";
import { TASK_PRIORITY_BADGE, TASK_PRIORITY_LABEL, mergeAssigneeMembers } from "@/lib/task";
import { shortDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { cardClass } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { TaskStatusControl } from "@/components/tasks/task-status-control";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskAssigneesForm } from "@/components/tasks/task-assignees-form";
import { Checklist } from "@/components/tasks/checklist";
import { TaskRemoveControl } from "@/components/tasks/task-remove-control";

const CHIP = "text-xs text-[var(--text-3)]";

export default async function TaskDetailPage(props: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await props.params;
  const task = await getTaskDetail(prisma, taskId);
  if (!task) notFound();

  const [projects, activeMembers] = await Promise.all([
    // The options list must still include the task's own project even when
    // that project is DONE — otherwise React's <select> reconciliation
    // (updateOptions) falls back to selecting the first non-disabled option
    // ("No project (personal task)") when the current projectId matches
    // nothing rendered, and the next save silently makes the task personal.
    prisma.project.findMany({
      where: task.projectId
        ? { OR: [{ status: { not: "DONE" } }, { id: task.projectId }] }
        : { status: { not: "DONE" } },
      select: { id: true, name: true, clientId: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Only a project task has milestones to offer, and only that project's own.
  const milestoneRows = task.projectId
    ? await prisma.milestone.findMany({
        where: { projectId: task.projectId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, title: true },
      })
    : null;
  const milestones = task.projectId ? { projectId: task.projectId, options: milestoneRows ?? [] } : null;

  const members = mergeAssigneeMembers(activeMembers, task.assignees);
  const selectedAssigneeIds = task.assignees.map((a) => a.id);

  return (
    <div className="space-y-6 p-8">
      <nav className="text-xs text-[var(--text-3)]">
        {task.projectId ? (
          <>
            <Link href="/clients" transitionTypes={["nav-back"]}
          className="hover:text-[var(--text-2)]">
              Clients
            </Link>
            <span> / </span>
            <Link href={`/clients/${task.clientId}`} transitionTypes={["nav-back"]}
          className="hover:text-[var(--text-2)]">
              {task.clientName}
            </Link>
            <span> / </span>
            <Link href={`/projects/${task.projectId}`} transitionTypes={["nav-back"]}
          className="hover:text-[var(--text-2)]">
              {task.projectName}
            </Link>
            <span> / </span>
            <span className="text-[var(--text-2)]">Task</span>
          </>
        ) : (
          <>
            <Link href="/my-tasks" transitionTypes={["nav-back"]}
          className="hover:text-[var(--text-2)]">
              My Tasks
            </Link>
            <span> / </span>
            <span className="text-[var(--text-2)]">Task</span>
          </>
        )}
      </nav>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1
              style={{ viewTransitionName: `task-${task.id}` }}
              className="text-2xl font-semibold text-[var(--text)]"
            >
              {task.title}
            </h1>
            <TaskStatusControl
              taskId={task.id}
              projectId={task.projectId}
              clientId={task.clientId}
              status={task.status}
            />
            <Badge kind={TASK_PRIORITY_BADGE[task.priority]}>{TASK_PRIORITY_LABEL[task.priority]}</Badge>
          </div>
          {/* Same rule as <TaskRow>: `overdue` is carried on the detail
              model, so the one line that states the due date is where it
              has to show. */}
          <p
            className={`mt-1 flex items-center gap-1.5 text-sm ${
              task.overdue ? "text-[var(--bad)]" : "text-[var(--text-3)]"
            }`}
          >
            <Icon name="event" size="sm" />
            {task.dueDate ? `Due ${shortDate(task.dueDate)}` : "No due date"}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={CHIP}>Created by {task.creator.name}</span>
            {task.milestoneTitle ? <span className={CHIP}>Milestone {task.milestoneTitle}</span> : null}
          </div>
        </div>
        <div className="flex flex-none items-start gap-2">
          <TaskForm
            task={{
              id: task.id,
              title: task.title,
              description: task.description,
              projectId: task.projectId,
              milestoneId: task.milestoneId,
              priority: task.priority,
              dueDate: task.dueDate,
            }}
            projects={projects}
            milestones={milestones}
          />
          <TaskRemoveControl taskId={task.id} projectId={task.projectId} clientId={task.clientId} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          {task.description ? (
            <p className="max-w-2xl whitespace-pre-wrap text-sm text-[var(--text-2)]">{task.description}</p>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-medium text-[var(--text)]">Checklist</h2>
              {task.checklistTotal > 0 ? (
                <span className="text-xs text-[var(--text-3)]">
                  {task.checklistDone}/{task.checklistTotal} done
                </span>
              ) : null}
            </div>
            <Checklist
              taskId={task.id}
              projectId={task.projectId}
              clientId={task.clientId}
              items={task.checklist}
            />
          </section>
        </div>

        <aside className={cardClass({ className: "h-fit space-y-3 p-4" })}>
          <h2 className="text-sm font-semibold text-[var(--text)]">Assignees</h2>
          {task.assignees.length === 0 ? (
            <p className="text-xs text-[var(--text-3)]">Unassigned</p>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {task.assignees.map((a) => (
                <span key={a.id} className="flex items-center gap-1.5">
                  <InitialsAvatar initials={a.initials} shape="circle" size={22} />
                  <span className="text-xs text-[var(--text-2)]">{a.name}</span>
                </span>
              ))}
            </div>
          )}
          <TaskAssigneesForm
            taskId={task.id}
            projectId={task.projectId}
            clientId={task.clientId}
            members={members}
            selectedIds={selectedAssigneeIds}
          />
        </aside>
      </div>
    </div>
  );
}
