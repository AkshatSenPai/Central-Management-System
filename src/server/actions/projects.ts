"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                                          | revalidatePath calls                                       |
 * |---------------------------------------------------|------------------------------------------------------------|
 * | project create / update / status / health / progress | `/projects`, `/projects/{projectId}`, `/clients/{clientId}` |
 * | milestone add / update / toggle / remove           | `/projects/{projectId}`, `/clients/{clientId}`              |
 *
 * Milestones revalidate the client page too: they move AUTO progress, which
 * the client page renders.
 *
 * Every action here is requireUser — deleteClientAction is the only
 * admin-gated mutation in Phase 2.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { AuthError, requireUser } from "@/server/guards";
import { projectSchema, milestoneSchema, PROJECT_STATUSES, PROJECT_HEALTHS } from "@/lib/project";
import {
  createProject,
  updateProject,
  setProjectStatus,
  setProjectHealth,
  setProjectProgress,
} from "@/lib/project-service";
import {
  addMilestone,
  updateMilestone,
  setMilestoneComplete,
  removeMilestone,
} from "@/lib/milestone-service";
import { parseDateInput } from "@/lib/dates";

const PROGRESS_MODES = ["AUTO", "MANUAL"] as const;

export async function createProjectAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = projectSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description"),
      status: formData.get("status"),
      health: formData.get("health"),
      startDate: formData.get("startDate"),
      dueDate: formData.get("dueDate"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { name, description, status, health, startDate, dueDate } = parsed.data;
    const result = await createProject(prisma, {
      clientId,
      name,
      description: description || null,
      status,
      health,
      startDate: parseDateInput(startDate || ""),
      dueDate: parseDateInput(dueDate || ""),
      actorId: user.id,
    });
    revalidatePath("/projects");
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateProjectAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = projectSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description"),
      status: formData.get("status"),
      health: formData.get("health"),
      startDate: formData.get("startDate"),
      dueDate: formData.get("dueDate"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { name, description, status, health, startDate, dueDate } = parsed.data;
    const result = await updateProject(prisma, {
      projectId,
      name,
      description: description || null,
      status,
      health,
      startDate: parseDateInput(startDate || ""),
      dueDate: parseDateInput(dueDate || ""),
      actorId: user.id,
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setProjectStatusAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const status = z.enum(PROJECT_STATUSES).safeParse(formData.get("status"));
    if (!status.success) return err("Invalid input");
    const result = await setProjectStatus(prisma, {
      projectId,
      status: status.data,
      actorId: user.id,
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setProjectHealthAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const health = z.enum(PROJECT_HEALTHS).safeParse(formData.get("health"));
    if (!health.success) return err("Invalid input");
    const result = await setProjectHealth(prisma, {
      projectId,
      health: health.data,
      actorId: user.id,
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setProjectProgressAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const mode = z.enum(PROGRESS_MODES).safeParse(formData.get("progressMode"));
    if (!mode.success) return err("Invalid input");
    const raw = String(formData.get("manualProgress") ?? "");
    const result = await setProjectProgress(prisma, {
      projectId,
      progressMode: mode.data,
      manualProgress: raw === "" ? null : Number(raw),
      actorId: user.id,
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function addMilestoneAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = milestoneSchema.safeParse({
      title: formData.get("title"),
      dueDate: formData.get("dueDate"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const result = await addMilestone(prisma, {
      projectId,
      title: parsed.data.title,
      dueDate: parseDateInput(parsed.data.dueDate || ""),
      actorId: user.id,
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateMilestoneAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = milestoneSchema.safeParse({
      title: formData.get("title"),
      dueDate: formData.get("dueDate"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const result = await updateMilestone(prisma, {
      milestoneId: String(formData.get("milestoneId") ?? ""),
      title: parsed.data.title,
      dueDate: parseDateInput(parsed.data.dueDate || ""),
      actorId: user.id,
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function toggleMilestoneAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const result = await setMilestoneComplete(prisma, {
      milestoneId: String(formData.get("milestoneId") ?? ""),
      complete: formData.get("complete") === "true",
      actorId: user.id,
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeMilestoneAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(formData.get("projectId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const result = await removeMilestone(prisma, {
      milestoneId: String(formData.get("milestoneId") ?? ""),
      actorId: user.id,
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
