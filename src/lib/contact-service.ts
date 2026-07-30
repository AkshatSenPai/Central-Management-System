import type { PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity, fieldDiff } from "@/lib/activity";
import { normalizeEmail } from "@/lib/email";

type ContactWrite = {
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
};

/** Deliberately excludes isPrimary: promotion is setPrimaryContact's job
 * alone, so an edit form can never silently break the single-primary rule. */
function writeData(input: ContactWrite) {
  return {
    name: input.name.trim(),
    email: input.email ? normalizeEmail(input.email) : null,
    phone: input.phone ? input.phone : null,
    role: input.role ? input.role : null,
  };
}

export async function addContact(
  db: PrismaClient,
  input: ContactWrite & { clientId: string; actorId: string }
): Promise<ActionResult<{ id: string }>> {
  const data = writeData(input);
  if (!data.name) return err("Contact name is required");

  const client = await db.client.findUnique({ where: { id: input.clientId } });
  if (!client) return err("Client not found");

  // The first contact a client gets is automatically its primary.
  const existing = await db.clientContact.count({ where: { clientId: input.clientId } });

  const created = await db.$transaction(async (tx) => {
    const contact = await tx.clientContact.create({
      data: { ...data, clientId: input.clientId, isPrimary: existing === 0 },
    });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CLIENT_CONTACT",
      entityId: contact.id,
      action: "contact.added",
      clientId: input.clientId,
      meta: { name: contact.name },
    });
    return contact;
  });
  return ok({ id: created.id });
}

export async function updateContact(
  db: PrismaClient,
  input: ContactWrite & { contactId: string; actorId: string }
): Promise<ActionResult> {
  const data = writeData(input);
  if (!data.name) return err("Contact name is required");

  const before = await db.clientContact.findUnique({ where: { id: input.contactId } });
  if (!before) return err("Contact not found");

  const changes = fieldDiff(before, data, ["name", "email", "phone", "role"]);
  if (!changes) return ok(undefined);

  await db.$transaction(async (tx) => {
    await tx.clientContact.update({ where: { id: input.contactId }, data });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CLIENT_CONTACT",
      entityId: input.contactId,
      action: "contact.updated",
      clientId: before.clientId,
      meta: { name: data.name, changes },
    });
  });
  return ok(undefined);
}

/** Demote-then-promote in one interactive transaction, so no window exists in
 * which a client has two primaries or none. */
export async function setPrimaryContact(
  db: PrismaClient,
  input: { contactId: string; actorId: string }
): Promise<ActionResult> {
  const contact = await db.clientContact.findUnique({ where: { id: input.contactId } });
  if (!contact) return err("Contact not found");

  await db.$transaction(async (tx) => {
    await tx.clientContact.updateMany({
      where: { clientId: contact.clientId, isPrimary: true },
      data: { isPrimary: false },
    });
    await tx.clientContact.update({
      where: { id: input.contactId },
      data: { isPrimary: true },
    });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CLIENT_CONTACT",
      entityId: input.contactId,
      action: "contact.primary_set",
      clientId: contact.clientId,
      meta: { name: contact.name },
    });
  });
  return ok(undefined);
}

/** Removing the primary promotes nobody — leaving the choice to a human beats
 * guessing, and the list renders "—" until someone picks. */
export async function removeContact(
  db: PrismaClient,
  input: { contactId: string; actorId: string }
): Promise<ActionResult> {
  const contact = await db.clientContact.findUnique({ where: { id: input.contactId } });
  if (!contact) return err("Contact not found");

  await db.$transaction(async (tx) => {
    await tx.clientContact.delete({ where: { id: input.contactId } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CLIENT_CONTACT",
      entityId: input.contactId,
      action: "contact.removed",
      clientId: contact.clientId,
      meta: { name: contact.name },
    });
  });
  return ok(undefined);
}
