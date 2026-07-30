import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity, fieldDiff } from "@/lib/activity";
import { isValidManualProgress, type ProgressMode } from "@/lib/progress";
import type { ProjectStatus, ProjectHealth } from "@/lib/project";

export type ProjectWriteInput = {
  name: string;
  description: string | null;
  status: ProjectStatus;
  health: ProjectHealth;
  startDate: Date | null;
  dueDate: Date | null;
};

const DIFFED_FIELDS = ["name", "description", "status", "health", "startDate", "dueDate"] as const;

const DUPLICATE_NAME = "A project with this name already exists for this client";
const INVALID_PROGRESS = "Progress must be a whole number between 0 and 100";

function writeData(input: ProjectWriteInput) {
  return {
    name: input.name.trim(),
    description: input.description ? input.description : null,
    status: input.status,
    health: input.health,
    startDate: input.startDate,
    dueDate: input.dueDate,
  };
}

export async function createProject(
  db: PrismaClient,
  input: ProjectWriteInput & { clientId: string; actorId: string }
): Promise<ActionResult<{ id: string }>> {
  const data = writeData(input);
  if (!data.name) return err("Project name is required");

  const client = await db.client.findUnique({ where: { id: input.clientId } });
  if (!client) return err("Client not found");

  // Names are unique per client, not globally — two clients may both have a
  // "Website Refresh".
  const duplicate = await db.project.findFirst({
    where: { clientId: input.clientId, name: { equals: data.name, mode: "insensitive" } },
  });
  if (duplicate) return err(DUPLICATE_NAME);

  try {
    const created = await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { ...data, clientId: input.clientId, progressMode: "AUTO", manualProgress: null },
      });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "PROJECT",
        entityId: project.id,
        action: "project.created",
        clientId: input.clientId,
        meta: { name: project.name },
      });
      return project;
    });
    return ok({ id: created.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err(DUPLICATE_NAME);
    }
    throw e;
  }
}

export async function updateProject(
  db: PrismaClient,
  input: ProjectWriteInput & { projectId: string; actorId: string }
): Promise<ActionResult> {
  const data = writeData(input);
  if (!data.name) return err("Project name is required");

  const before = await db.project.findUnique({ where: { id: input.projectId } });
  if (!before) return err("Project not found");

  const changes = fieldDiff(before, data, [...DIFFED_FIELDS]);
  if (!changes) return ok(undefined);

  // One mutation writes exactly one activity row; the most meaningful verb wins.
  const action =
    "health" in changes
      ? "project.health_changed"
      : "status" in changes
        ? "project.status_changed"
        : "project.updated";
  const transition = changes.health ?? changes.status;
  const meta =
    action === "project.updated"
      ? { name: data.name, changes }
      : { name: data.name, from: transition.from, to: transition.to };

  try {
    await db.$transaction(async (tx) => {
      await tx.project.update({ where: { id: input.projectId }, data });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "PROJECT",
        entityId: input.projectId,
        action,
        clientId: before.clientId,
        meta,
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err(DUPLICATE_NAME);
    }
    throw e;
  }
  return ok(undefined);
}

export async function setProjectStatus(
  db: PrismaClient,
  input: { projectId: string; status: ProjectStatus; actorId: string }
): Promise<ActionResult> {
  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project) return err("Project not found");
  if (project.status === input.status) return ok(undefined);

  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: input.projectId }, data: { status: input.status } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "PROJECT",
      entityId: input.projectId,
      action: "project.status_changed",
      clientId: project.clientId,
      meta: { name: project.name, from: project.status, to: input.status },
    });
  });
  return ok(undefined);
}

/** Health is stored and manual — nothing derives or suggests it. Overdue-ness
 * is a separate styling cue that never mutates this value. */
export async function setProjectHealth(
  db: PrismaClient,
  input: { projectId: string; health: ProjectHealth; actorId: string }
): Promise<ActionResult> {
  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project) return err("Project not found");
  if (project.health === input.health) return ok(undefined);

  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: input.projectId }, data: { health: input.health } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "PROJECT",
      entityId: input.projectId,
      action: "project.health_changed",
      clientId: project.clientId,
      meta: { name: project.name, from: project.health, to: input.health },
    });
  });
  return ok(undefined);
}

export async function setProjectProgress(
  db: PrismaClient,
  input: {
    projectId: string;
    progressMode: ProgressMode;
    manualProgress: number | null;
    actorId: string;
  }
): Promise<ActionResult> {
  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project) return err("Project not found");

  let data: { progressMode: ProgressMode; manualProgress?: number };
  let fields: ("progressMode" | "manualProgress")[];
  if (input.progressMode === "MANUAL") {
    const value = input.manualProgress ?? 0;
    if (!isValidManualProgress(value)) return err(INVALID_PROGRESS);
    data = { progressMode: "MANUAL", manualProgress: value };
    fields = ["progressMode", "manualProgress"];
  } else {
    // manualProgress is deliberately left untouched so MANUAL -> AUTO -> MANUAL
    // is lossless.
    data = { progressMode: "AUTO" };
    fields = ["progressMode"];
  }

  const changes = fieldDiff(project, data, fields);
  if (!changes) return ok(undefined);

  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: input.projectId }, data });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "PROJECT",
      entityId: input.projectId,
      action: "project.progress_changed",
      clientId: project.clientId,
      meta: { name: project.name, mode: data.progressMode },
    });
  });
  return ok(undefined);
}
