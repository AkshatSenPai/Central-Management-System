"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                                                     | revalidatePath calls                                                                                              |
 * |----------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
 * | createTaskAction                                                | `/my-tasks`, `/team`; when projectId: `/projects`, `/projects/{projectId}`; when clientId: `/clients/{clientId}`      |
 * | updateTaskAction                                                | the same set for both the submitted projectId/clientId and the hidden prevProjectId/prevClientId when present and different, plus `/tasks/{taskId}` |
 * | setTaskStatusAction, setTaskAssigneesAction, removeTaskAction   | `/my-tasks`, `/team`, `/tasks/{taskId}`; when projectId: `/projects`, `/projects/{projectId}`; when clientId: `/clients/{clientId}` |
 * | addChecklistItemAction, setChecklistItemDoneAction, removeChecklistItemAction | `/tasks/{taskId}`; when projectId: `/projects/{projectId}`; when clientId: `/clients/{clientId}`      |
 *
 * Checklist mutations reach the client path because every one of them writes
 * a client-scoped ActivityLog row, and the only reader of those rows is the
 * client-detail timeline.
 *
 * Every action here is requireUser — there is no requireAdmin anywhere in
 * this file.
 *
 * Every scalar FormData read is `String(formData.get("x") ?? "")`. The one
 * documented exception is the assignee list, read as
 * `formData.getAll("userId").map(String)` in createTaskAction and
 * setTaskAssigneesAction, because a checkbox list is inherently multi-valued
 * and `formData.get` would silently return only the first.
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { pushForNotifications } from "@/lib/push-fanout";
import { err, type ActionResult } from "@/lib/action-result";
import { AuthError, requireUser } from "@/server/guards";
import { taskSchema, checklistItemSchema, TASK_STATUSES } from "@/lib/task";
import {
  createTask,
  updateTask,
  setTaskStatus,
  addTaskDependency,
  removeTaskDependency,
  setTaskAssignees,
  removeTask,
} from "@/lib/task-service";
import { addChecklistItem, setChecklistItemDone, removeChecklistItem } from "@/lib/checklist-service";
import { parseDateInput } from "@/lib/dates";

/** Hands the notification ids to the push fan-out once the response is sent.
 *
 * `after()` is the seam, and it is load-bearing rather than an optimisation:
 * the transaction that wrote those rows has committed by the time this runs,
 * so a push can never describe a write that was rolled back. It also keeps the
 * user's request off the push services' latency. Shared by the two actions
 * here that produce pushable notifications. */
function pushAfterCommit(notificationIds: string[]): void {
  if (notificationIds.length === 0) return;
  after(() => pushForNotifications(prisma, notificationIds));
}

export async function createTaskAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string; notificationIds: string[] }>> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = taskSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      projectId: formData.get("projectId"),
      milestoneId: formData.get("milestoneId"),
      priority: formData.get("priority"),
      dueDate: formData.get("dueDate"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { title, description, projectId, milestoneId, priority, dueDate } = parsed.data;
    // Rejected rather than defaulted, so this reads identically to
    // setTaskStatusAction below. A silent fallback would let a tampered or
    // stale request create a task under a status the sender did not choose,
    // and report success.
    const statusParsed = z.enum(TASK_STATUSES).safeParse(formData.get("status"));
    if (!statusParsed.success) return err("Invalid input");
    const status = statusParsed.data;
    const assigneeIds = formData.getAll("userId").map(String);
    const result = await createTask(prisma, {
      title,
      description: description || null,
      projectId: projectId || null,
      milestoneId: milestoneId || null,
      status,
      priority,
      dueDate: parseDateInput(dueDate || ""),
      assigneeIds,
      actorId: user.id,
    });
    revalidatePath("/my-tasks");
    revalidatePath("/team");
    if (projectId) {
      revalidatePath("/projects");
      revalidatePath(`/projects/${projectId}`);
    }
    if (clientId) revalidatePath(`/clients/${clientId}`);
    // On the ok branch only. Scheduling before checking the result would push
    // about a task that was never created — the exact inversion of the rule
    // notify() exists to protect.
    if (result.ok) pushAfterCommit(result.data.notificationIds);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateTaskAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const taskId = String(formData.get("taskId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const prevProjectId = String(formData.get("prevProjectId") ?? "");
    const prevClientId = String(formData.get("prevClientId") ?? "");
    const parsed = taskSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      projectId: formData.get("projectId"),
      milestoneId: formData.get("milestoneId"),
      priority: formData.get("priority"),
      dueDate: formData.get("dueDate"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { title, description, projectId, milestoneId, priority, dueDate } = parsed.data;
    const result = await updateTask(prisma, {
      taskId,
      title,
      description: description || null,
      projectId: projectId || null,
      milestoneId: milestoneId || null,
      priority,
      dueDate: parseDateInput(dueDate || ""),
      actorId: user.id,
    });
    revalidatePath("/my-tasks");
    revalidatePath("/team");
    revalidatePath(`/tasks/${taskId}`);
    if (projectId) {
      revalidatePath("/projects");
      revalidatePath(`/projects/${projectId}`);
    }
    if (clientId) revalidatePath(`/clients/${clientId}`);
    if (prevProjectId && prevProjectId !== projectId) {
      revalidatePath("/projects");
      revalidatePath(`/projects/${prevProjectId}`);
    }
    if (prevClientId && prevClientId !== clientId) {
      revalidatePath(`/clients/${prevClientId}`);
    }
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setTaskStatusAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const taskId = String(formData.get("taskId") ?? "");
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const status = z.enum(TASK_STATUSES).safeParse(formData.get("status"));
    if (!status.success) return err("Invalid input");
    const result = await setTaskStatus(prisma, {
      taskId,
      status: status.data,
      actorId: user.id,
    });
    revalidatePath("/my-tasks");
    revalidatePath("/team");
    revalidatePath(`/tasks/${taskId}`);
    if (projectId) {
      revalidatePath("/projects");
      revalidatePath(`/projects/${projectId}`);
    }
    if (clientId) revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

/** The six paths a task appears on, revalidated together. A dependency
 * changes what renders on every one of them — the chip is on the board, the
 * lists and both detail pages — so this is the same set setTaskStatusAction
 * revalidates, extracted rather than written a third and fourth time. */
function revalidateTaskSurfaces(taskId: string, projectId: string, clientId: string) {
  revalidatePath("/my-tasks");
  revalidatePath("/team");
  revalidatePath(`/tasks/${taskId}`);
  if (projectId) {
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
  }
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

export async function addTaskDependencyAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const blockedTaskId = String(formData.get("taskId") ?? "");
    const blockerTaskId = String(formData.get("blockerTaskId") ?? "");
    if (!blockedTaskId || !blockerTaskId) return err("Invalid input");

    const result = await addTaskDependency(prisma, {
      blockedTaskId,
      blockerTaskId,
      actorId: user.id,
    });
    revalidateTaskSurfaces(
      blockedTaskId,
      String(formData.get("projectId") ?? ""),
      String(formData.get("clientId") ?? "")
    );
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeTaskDependencyAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const blockedTaskId = String(formData.get("taskId") ?? "");
    const blockerTaskId = String(formData.get("blockerTaskId") ?? "");
    if (!blockedTaskId || !blockerTaskId) return err("Invalid input");

    const result = await removeTaskDependency(prisma, {
      blockedTaskId,
      blockerTaskId,
      actorId: user.id,
    });
    revalidateTaskSurfaces(
      blockedTaskId,
      String(formData.get("projectId") ?? ""),
      String(formData.get("clientId") ?? "")
    );
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setTaskAssigneesAction(
  _prev: ActionResult<{ notificationIds: string[] }> | null,
  formData: FormData
): Promise<ActionResult<{ notificationIds: string[] }>> {
  try {
    const user = await requireUser();
    const taskId = String(formData.get("taskId") ?? "");
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const userIds = formData.getAll("userId").map(String);
    const result = await setTaskAssignees(prisma, {
      taskId,
      userIds,
      actorId: user.id,
    });
    revalidatePath("/my-tasks");
    revalidatePath("/team");
    revalidatePath(`/tasks/${taskId}`);
    if (projectId) {
      revalidatePath("/projects");
      revalidatePath(`/projects/${projectId}`);
    }
    if (clientId) revalidatePath(`/clients/${clientId}`);
    if (result.ok) pushAfterCommit(result.data.notificationIds);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeTaskAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const taskId = String(formData.get("taskId") ?? "");
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const result = await removeTask(prisma, {
      taskId,
      actorId: user.id,
    });
    revalidatePath("/my-tasks");
    revalidatePath("/team");
    revalidatePath(`/tasks/${taskId}`);
    if (projectId) {
      revalidatePath("/projects");
      revalidatePath(`/projects/${projectId}`);
    }
    if (clientId) revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function addChecklistItemAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const taskId = String(formData.get("taskId") ?? "");
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = checklistItemSchema.safeParse({
      title: formData.get("title"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const result = await addChecklistItem(prisma, {
      taskId,
      title: parsed.data.title,
      actorId: user.id,
    });
    revalidatePath(`/tasks/${taskId}`);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    if (clientId) revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setChecklistItemDoneAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const itemId = String(formData.get("itemId") ?? "");
    const taskId = String(formData.get("taskId") ?? "");
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const result = await setChecklistItemDone(prisma, {
      itemId,
      done: formData.get("done") === "true",
      actorId: user.id,
    });
    revalidatePath(`/tasks/${taskId}`);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    if (clientId) revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeChecklistItemAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const itemId = String(formData.get("itemId") ?? "");
    const taskId = String(formData.get("taskId") ?? "");
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const result = await removeChecklistItem(prisma, {
      itemId,
      actorId: user.id,
    });
    revalidatePath(`/tasks/${taskId}`);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    if (clientId) revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
