import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTaskDetail } from "@/lib/task-queries";
import { listTaskComments } from "@/lib/comment-queries";
import { listAttachments } from "@/lib/attachment-queries";
import { CommentThread } from "@/components/comments/comment-thread";
import { Attachments } from "@/components/attachments/attachments";
import {
  TASK_PRIORITY_BADGE,
  TASK_PRIORITY_LABEL,
  mergeAssigneeMembers,
  taskReference,
} from "@/lib/task";
import { shortDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
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
  const session = await auth();
  // The layout already redirects; repeated because this page reads
  // session.user directly and TypeScript cannot see a guard in another file.
  if (!session?.user) redirect("/login");

  const task = await getTaskDetail(prisma, taskId);
  if (!task) notFound();

  const [projects, activeMembers, comments, attachments] = await Promise.all([
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
    listTaskComments(prisma, taskId),
    listAttachments(prisma, { parentType: "TASK", parentId: taskId }),
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
    <div className="space-y-6 p-4 sm:p-8">
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

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
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
            {/* First, and in mono, because it is the handle someone reads out
                on a call — "can you look at MER-24". */}
            <span className={`${CHIP} mono`}>{taskReference(task.reference)}</span>
            <span className={CHIP}>Created by {task.creator.name}</span>
            {task.milestoneTitle ? <span className={CHIP}>Milestone {task.milestoneTitle}</span> : null}
          </div>
        </div>
        <div className="flex flex-none items-start gap-2">
          <TaskForm
            task={{
              id: task.id,
              reference: task.reference,
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
            <SectionCard title="Description">
              <p className="whitespace-pre-wrap text-sm text-[var(--text-2)]">{task.description}</p>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Checklist"
            meta={task.checklistTotal > 0 ? `${task.checklistDone}/${task.checklistTotal} done` : null}
          >
            <Checklist
              taskId={task.id}
              projectId={task.projectId}
              clientId={task.clientId}
              items={task.checklist}
            />
          </SectionCard>

          <SectionCard title="Files" meta={attachments.length > 0 ? attachments.length : null}>
            {/* projectId and clientId are carried for the *activity*
                timeline, not this list: every attachment write records a
                client-scoped ActivityLog row, and the client detail page is
                the only thing that reads those. Both are null on a personal
                task, which is what the action's own `if` skips. */}
            <Attachments
              attachments={attachments}
              scope={{
                parentType: "TASK",
                parentId: task.id,
                projectId: task.projectId,
                clientId: task.clientId,
              }}
              viewerId={session.user.id}
              viewerIsAdmin={session.user.role === "ADMIN"}
            />
          </SectionCard>

          <SectionCard title="Comments" meta={comments.length > 0 ? comments.length : null}>
            <CommentThread
              comments={comments}
              scope={{ taskId: task.id, projectId: task.projectId, clientId: task.clientId }}
              members={activeMembers}
              viewerId={session.user.id}
              viewerIsAdmin={session.user.role === "ADMIN"}
            />
          </SectionCard>
        </div>

        <SectionCard title="Assignees" className="h-fit">
          <div className="space-y-3">
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
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
