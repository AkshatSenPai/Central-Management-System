import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity, fieldDiff } from "@/lib/activity";
import type { ClientStatus } from "@/lib/client";

export type ClientWriteInput = {
  name: string;
  status: ClientStatus;
  sector: string | null;
  website: string | null;
  engagementType: string | null;
  clientSince: Date | null;
  accountLeadId: string | null;
  notes: string | null;
};

const DIFFED_FIELDS = [
  "name",
  "status",
  "sector",
  "website",
  "engagementType",
  "clientSince",
  "accountLeadId",
  "notes",
] as const;

const DUPLICATE_NAME = "A client with this name already exists";
const HAS_PROJECTS = "Remove this client's projects before deleting";

/** Defensive: the action layer already maps cleared optionals to null, but a
 * stray "" must never reach the column. */
function emptyToNull(value: string | null): string | null {
  return value ? value : null;
}

function writeData(input: ClientWriteInput) {
  return {
    name: input.name.trim(),
    status: input.status,
    sector: emptyToNull(input.sector),
    website: emptyToNull(input.website),
    engagementType: emptyToNull(input.engagementType),
    clientSince: input.clientSince,
    accountLeadId: emptyToNull(input.accountLeadId),
    notes: emptyToNull(input.notes),
  };
}

export async function createClient(
  db: PrismaClient,
  input: ClientWriteInput & { actorId: string }
): Promise<ActionResult<{ id: string }>> {
  const data = writeData(input);
  if (!data.name) return err("Client name is required");

  const duplicate = await db.client.findFirst({
    where: { name: { equals: data.name, mode: "insensitive" } },
  });
  if (duplicate) return err(DUPLICATE_NAME);

  try {
    const created = await db.$transaction(async (tx) => {
      const client = await tx.client.create({ data });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "CLIENT",
        entityId: client.id,
        action: "client.created",
        clientId: client.id,
        meta: { name: client.name },
      });
      return client;
    });
    return ok({ id: created.id });
  } catch (e) {
    // The pre-check above loses to a concurrent insert; the unique index wins.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err(DUPLICATE_NAME);
    }
    throw e;
  }
}

export async function updateClient(
  db: PrismaClient,
  input: ClientWriteInput & { clientId: string; actorId: string }
): Promise<ActionResult> {
  const data = writeData(input);
  if (!data.name) return err("Client name is required");

  const before = await db.client.findUnique({ where: { id: input.clientId } });
  if (!before) return err("Client not found");

  const changes = fieldDiff(before, data, [...DIFFED_FIELDS]);
  if (!changes) return ok(undefined);

  const statusChanged = "status" in changes;
  try {
    await db.$transaction(async (tx) => {
      await tx.client.update({ where: { id: input.clientId }, data });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "CLIENT",
        entityId: input.clientId,
        action: statusChanged ? "client.status_changed" : "client.updated",
        clientId: input.clientId,
        meta: statusChanged
          ? { name: data.name, from: changes.status.from, to: changes.status.to }
          : { name: data.name, changes },
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

/** ADMIN-only (enforced at the action layer) and blocked while any project
 * remains — checked here and backstopped by ON DELETE RESTRICT in the DB. */
export async function deleteClient(
  db: PrismaClient,
  input: { clientId: string; actorId: string }
): Promise<ActionResult> {
  const client = await db.client.findUnique({ where: { id: input.clientId } });
  if (!client) return err("Client not found");

  const projectCount = await db.project.count({ where: { clientId: input.clientId } });
  if (projectCount > 0) return err(HAS_PROJECTS);

  try {
    await db.$transaction(async (tx) => {
      await tx.client.delete({ where: { id: input.clientId } });
      // clientId is null on purpose: the audit row outlives the client it
      // describes, so it must not be scoped to a row that no longer exists.
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "CLIENT",
        entityId: input.clientId,
        action: "client.deleted",
        clientId: null,
        meta: { name: client.name },
      });
    });
  } catch (e) {
    // A project created between the count and the delete trips the FK.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return err(HAS_PROJECTS);
    }
    throw e;
  }
  return ok(undefined);
}
