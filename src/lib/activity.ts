import { Prisma, type PrismaClient } from "@prisma/client";

export type ActivityEntityType =
  | "CLIENT"
  | "CLIENT_CONTACT"
  | "PROJECT"
  | "MILESTONE"
  | "TASK"
  | "CHECKLIST_ITEM";

/** Stored as a plain String column, never a Prisma enum, so later phases add
 * verbs without a migration. describeActivity must stay total. */
export type ActivityAction =
  | "client.created"
  | "client.updated"
  | "client.status_changed"
  | "client.deleted"
  | "contact.added"
  | "contact.updated"
  | "contact.primary_set"
  | "contact.removed"
  | "project.created"
  | "project.updated"
  | "project.status_changed"
  | "project.health_changed"
  | "project.progress_changed"
  | "milestone.added"
  | "milestone.updated"
  | "milestone.completed"
  | "milestone.reopened"
  | "milestone.removed"
  | "task.created"
  | "task.updated"
  | "task.status_changed"
  | "task.assigned"
  | "task.unassigned"
  | "task.removed"
  | "checklist.added"
  | "checklist.completed"
  | "checklist.reopened"
  | "checklist.removed";

export type ActivityMeta = Record<string, unknown> | null;

/** Narrow on purpose: a `$transaction` tx satisfies this, so every service can
 * log inside the same transaction as its mutation. Widening this to
 * PrismaClient would force every caller to log outside its transaction. */
export type ActivityDb = Pick<PrismaClient, "activityLog">;

export type ActivityEntry = {
  id: string;
  actorName: string;
  action: string;
  meta: ActivityMeta;
  at: Date;
};

export async function recordActivity(
  db: ActivityDb,
  input: {
    actorId: string;
    entityType: ActivityEntityType;
    entityId: string;
    action: ActivityAction;
    /** Null for events that outlive their client, e.g. client.deleted. */
    clientId: string | null;
    meta?: ActivityMeta;
  }
): Promise<void> {
  await db.activityLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      clientId: input.clientId,
      meta: (input.meta ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    },
  });
}

/** A form-empty "" and a db null are the same absence — comparing them raw
 * would log a phantom change on every save. Dates compare by value. */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.getTime();
  return value;
}

export function fieldDiff<T extends object>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[]
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = before[field];
    const to = after[field];
    if (normalize(from) !== normalize(to)) {
      diff[String(field)] = { from, to };
    }
  }
  return Object.keys(diff).length === 0 ? null : diff;
}

/** Reads come back as Prisma.JsonValue, so every lookup is defensive. */
function metaString(meta: ActivityMeta, key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" ? value : null;
}

/** Reads come back as Prisma.JsonValue, so an assignment's `people` list must
 * be checked, not trusted: null unless it really is an array of strings. */
function metaNames(meta: ActivityMeta, key: string): string[] | null {
  const value = meta?.[key];
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

function subject(meta: ActivityMeta): string {
  return metaString(meta, "name") ?? "this record";
}

/** "" | "A" | "A and B" | "A, B and C" — the shared join for every activity
 * sentence that names more than one person. */
export function formatNameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "AT_RISK" -> "At Risk". Matches the vocabulary lock for every Phase 2 enum
 * without importing project.ts (which does not exist yet at this layer). */
function humanizeEnum(value: string | null): string {
  if (!value) return "";
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function describeActivity(entry: {
  actorName: string;
  action: string;
  meta: ActivityMeta;
}): string {
  const who = entry.actorName;
  const what = subject(entry.meta);
  const to = humanizeEnum(metaString(entry.meta, "to"));

  switch (entry.action) {
    case "client.created":
      return `${who} created client ${what}`;
    case "client.updated":
      return `${who} updated client ${what}`;
    case "client.status_changed":
      return `${who} set ${what} to ${to}`;
    case "client.deleted":
      return `${who} deleted client ${what}`;
    case "contact.added":
      return `${who} added contact ${what}`;
    case "contact.updated":
      return `${who} updated contact ${what}`;
    case "contact.primary_set":
      return `${who} made ${what} the primary contact`;
    case "contact.removed":
      return `${who} removed contact ${what}`;
    case "project.created":
      return `${who} created project ${what}`;
    case "project.updated":
      return `${who} updated project ${what}`;
    case "project.status_changed":
      return `${who} moved ${what} to ${to}`;
    case "project.health_changed":
      return `${who} flagged ${what} as ${to}`;
    case "project.progress_changed":
      return `${who} updated progress on ${what}`;
    case "milestone.added":
      return `${who} added milestone ${what}`;
    case "milestone.updated":
      return `${who} updated milestone ${what}`;
    case "milestone.completed":
      return `${who} completed milestone ${what}`;
    case "milestone.reopened":
      return `${who} reopened milestone ${what}`;
    case "milestone.removed":
      return `${who} removed milestone ${what}`;
    case "task.created":
      return `${who} created task ${what}`;
    case "task.updated":
      return `${who} updated task ${what}`;
    case "task.status_changed":
      return `${who} moved ${what} to ${to}`;
    case "task.assigned": {
      const people = metaNames(entry.meta, "people");
      return people ? `${who} assigned ${what} to ${formatNameList(people)}` : `${who} updated task ${what}`;
    }
    case "task.unassigned": {
      const people = metaNames(entry.meta, "people");
      return people ? `${who} unassigned ${formatNameList(people)} from ${what}` : `${who} updated task ${what}`;
    }
    case "task.removed":
      return `${who} removed task ${what}`;
    case "checklist.added":
      return `${who} added checklist item ${what}`;
    case "checklist.completed":
      return `${who} completed checklist item ${what}`;
    case "checklist.reopened":
      return `${who} reopened checklist item ${what}`;
    case "checklist.removed":
      return `${who} removed checklist item ${what}`;
    default:
      // Forward compatibility: an unrecognised verb renders, never throws.
      return `${who} updated this record`;
  }
}

function toMeta(value: Prisma.JsonValue | null): ActivityMeta {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The dashboard's Recent activity feed: the whole studio, not one client.
 *
 * Deliberately unscoped. Every other activity surface is anchored to a client
 * and filters by clientId; this one is the "what has been happening" panel on
 * the landing screen, and narrowing it to the viewer's own actions would make
 * it a list of things they already know they did.
 *
 * Rows with a null clientId — client.deleted, which outlives its client — are
 * included here for the same reason: they are exactly the events worth seeing.
 */
export async function listRecentActivity(
  db: PrismaClient,
  input: { limit?: number } = {}
): Promise<ActivityEntry[]> {
  const rows = await db.activityLog.findMany({
    orderBy: { at: "desc" },
    take: input.limit ?? 10,
    include: { actor: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    actorName: r.actor.name,
    action: r.action,
    meta: toMeta(r.meta),
    at: r.at,
  }));
}

export async function listClientActivity(
  db: PrismaClient,
  input: { clientId: string; limit?: number }
): Promise<ActivityEntry[]> {
  const rows = await db.activityLog.findMany({
    where: { clientId: input.clientId },
    orderBy: { at: "desc" },
    take: input.limit ?? 30,
    include: { actor: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    actorName: r.actor.name,
    action: r.action,
    meta: toMeta(r.meta),
    at: r.at,
  }));
}
