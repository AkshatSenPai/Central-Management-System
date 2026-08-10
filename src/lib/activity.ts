import { Prisma, type PrismaClient } from "@prisma/client";

export type ActivityEntityType =
  | "CLIENT"
  | "CLIENT_CONTACT"
  | "PROJECT"
  | "MILESTONE"
  | "TASK"
  | "CHECKLIST_ITEM"
  | "COMMENT"
  | "ATTACHMENT"
  | "ANNOUNCEMENT"
  | "CALENDAR_EVENT"
  | "FEEDBACK"
  | "ATTENDANCE";

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
  | "task.dependency_added"
  | "task.dependency_removed"
  | "checklist.added"
  | "checklist.completed"
  | "checklist.reopened"
  | "checklist.removed"
  | "comment.added"
  | "comment.edited"
  | "comment.deleted"
  | "attachment.added"
  | "attachment.removed"
  | "announcement.posted"
  | "announcement.updated"
  | "announcement.removed"
  | "event.created"
  | "event.updated"
  | "event.removed"
  | "feedback.submitted"
  | "feedback.triaged"
  | "feedback.removed"
  /* Routine punches are deliberately NOT logged — see attendance-service.ts.
     Nor is the tidy-up when a forgotten session is closed by the next
     punch-in: that is the app housekeeping, not a person acting. The only
     attendance event worth an audit row is an admin resolving somebody
     else's session, which happens on deactivation. */
  | "attendance.orphaned";

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
    case "task.status_changed": {
      // Present only when an admin pushed past a blocker, so the sentence
      // says so rather than leaving it in meta_json for whoever opens the
      // export. Same shape as the assignment verbs' `people`.
      const overrode = metaNames(entry.meta, "overrodeBlockers");
      return overrode
        ? `${who} moved ${what} to ${to}, overriding ${formatNameList(overrode)}`
        : `${who} moved ${what} to ${to}`;
    }
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
    case "task.dependency_added":
      return `${who} blocked ${what} on ${metaString(entry.meta, "blocker") ?? "another task"}`;
    case "task.dependency_removed":
      return `${who} unblocked ${what} from ${metaString(entry.meta, "blocker") ?? "another task"}`;
    case "checklist.added":
      return `${who} added checklist item ${what}`;
    case "checklist.completed":
      return `${who} completed checklist item ${what}`;
    case "checklist.reopened":
      return `${who} reopened checklist item ${what}`;
    case "checklist.removed":
      return `${who} removed checklist item ${what}`;
    // The feed names the task, not the comment — a timeline of comment bodies
    // would be the thread duplicated badly. `meta.excerpt` is carried for a
    // later phase to render a preview from, including after the comment is
    // gone, but is deliberately not read here.
    case "comment.added":
      return `${who} commented on ${what}`;
    case "comment.edited":
      return `${who} edited a comment on ${what}`;
    case "comment.deleted":
      return `${who} deleted a comment on ${what}`;
    case "attachment.added":
      return `${who} attached ${what}`;
    case "attachment.removed":
      return `${who} removed attachment ${what}`;
    case "announcement.posted":
      return `${who} posted ${what}`;
    case "announcement.updated":
      return `${who} updated the announcement ${what}`;
    case "announcement.removed":
      return `${who} removed the announcement ${what}`;
    case "event.created":
      return `${who} scheduled ${what}`;
    case "event.updated":
      return `${who} updated the event ${what}`;
    // Stored as .removed, matching the file's own verb convention, while the
    // rendered sentence says "cancelled" — the column is a key, the sentence
    // is English, and cancelling a meeting is what actually happened (spec §13).
    case "event.removed":
      return `${who} cancelled ${what}`;
    // The body is never rendered into the feed. Feedback is visible to its
    // author and to admins only, and the activity timeline has no such
    // scoping — quoting it here would leak to every reader what the list
    // itself withholds. `meta.kind`/`meta.status` carry the shape instead.
    case "feedback.submitted":
      return `${who} submitted feedback`;
    case "feedback.triaged":
      return `${who} marked feedback ${humanizeEnum(metaString(entry.meta, "status"))}`;
    case "feedback.removed":
      return `${who} removed a piece of feedback`;
    // Punching in and out is not logged at all — six people clocking in and
    // out for chai and lunch would be thirty rows before noon, and this feed
    // is unscoped. The AttendanceSession table is already a complete,
    // timestamped record; only an admin acting on somebody else's session
    // earns a row here.
    case "attendance.orphaned":
      return `${who} deactivated a member who was still punched in`;
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

/** One row of the activity export. A superset of `ActivityEntry`: the export
 * carries the columns the on-screen feed has no use for — the entity the row
 * points at, its client scope, and the raw meta blob. */
export type ActivityExportRow = ActivityEntry & {
  actorId: string;
  entityType: string;
  entityId: string;
  clientId: string | null;
  clientName: string | null;
};

/** Every logged action in a window, for the CSV export.
 *
 * **Unbounded on purpose — there is no `take`.** Every other reader here caps
 * its rows because it renders a panel; this one answers "what did everyone do
 * between these two dates", and a silently truncated audit trail is worse than
 * no audit trail. The date range is the bound.
 *
 * Ascending, unlike every other reader, because an exported log is read
 * forwards: the file opens at the start of the period rather than the end.
 *
 * The window is half-open — `gte: from, lt: to` — matching `listTasksInRange`
 * and `bucketMyTasks`, so an event at exactly midnight lands in one day's
 * export rather than two. */
export async function listActivityForExport(
  db: PrismaClient,
  input: { from: Date; to: Date; clientId?: string | null; actorId?: string | null }
): Promise<ActivityExportRow[]> {
  const where: Prisma.ActivityLogWhereInput = { at: { gte: input.from, lt: input.to } };
  if (input.clientId) where.clientId = input.clientId;
  if (input.actorId) where.actorId = input.actorId;

  const rows = await db.activityLog.findMany({
    where,
    orderBy: { at: "asc" },
    include: { actor: { select: { id: true, name: true } } },
  });

  // One extra query rather than a join: ActivityLog.clientId carries no
  // foreign key (the same decision Notification.entityId records), so Prisma
  // has no relation to include and a row whose client has since been deleted
  // must still export with its id intact.
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((id): id is string => !!id))];
  const clients =
    clientIds.length > 0
      ? await db.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, name: true },
        })
      : [];
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));

  return rows.map((r) => ({
    id: r.id,
    actorId: r.actor.id,
    actorName: r.actor.name,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    clientId: r.clientId,
    clientName: r.clientId ? (clientNames.get(r.clientId) ?? null) : null,
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
