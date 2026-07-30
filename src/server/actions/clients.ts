"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                                    | revalidatePath calls                       |
 * |---------------------------------------------|--------------------------------------------|
 * | client create / update / delete             | `/clients`, plus `/clients/{id}` on update |
 * | contact add / update / set-primary / remove | `/clients/{clientId}`, `/clients`          |
 *
 * Actions are thin on purpose: guard, coerce FormData, safeParse, delegate,
 * revalidate. No business rule and no arithmetic lives in this file, and no
 * action writes activity — every activity row is written by the service
 * inside its mutation's transaction.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { AuthError, requireUser, requireAdmin } from "@/server/guards";
import { clientSchema, contactSchema } from "@/lib/client";
import { createClient, updateClient, deleteClient } from "@/lib/client-service";
import {
  addContact,
  updateContact,
  setPrimaryContact,
  removeContact,
} from "@/lib/contact-service";
import { parseDateInput } from "@/lib/dates";

export async function createClientAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const parsed = clientSchema.safeParse({
      name: formData.get("name"),
      status: formData.get("status"),
      sector: formData.get("sector"),
      website: formData.get("website"),
      engagementType: formData.get("engagementType"),
      clientSince: formData.get("clientSince"),
      accountLeadId: formData.get("accountLeadId"),
      notes: formData.get("notes"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { name, status, sector, website, engagementType, clientSince, accountLeadId, notes } =
      parsed.data;
    const result = await createClient(prisma, {
      name,
      status,
      sector: sector || null,
      website: website || null,
      engagementType: engagementType || null,
      clientSince: parseDateInput(clientSince || ""),
      accountLeadId: accountLeadId || null,
      notes: notes || null,
      actorId: user.id,
    });
    revalidatePath("/clients");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateClientAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = clientSchema.safeParse({
      name: formData.get("name"),
      status: formData.get("status"),
      sector: formData.get("sector"),
      website: formData.get("website"),
      engagementType: formData.get("engagementType"),
      clientSince: formData.get("clientSince"),
      accountLeadId: formData.get("accountLeadId"),
      notes: formData.get("notes"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { name, status, sector, website, engagementType, clientSince, accountLeadId, notes } =
      parsed.data;
    const result = await updateClient(prisma, {
      clientId,
      name,
      status,
      sector: sector || null,
      website: website || null,
      engagementType: engagementType || null,
      clientSince: parseDateInput(clientSince || ""),
      accountLeadId: accountLeadId || null,
      notes: notes || null,
      actorId: user.id,
    });
    revalidatePath("/clients");
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

/** The only requireAdmin mutation in Phase 2. */
export async function deleteClientAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const result = await deleteClient(prisma, {
      clientId: String(formData.get("clientId") ?? ""),
      actorId: admin.id,
    });
    revalidatePath("/clients");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function addContactAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = contactSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      role: formData.get("role"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { name, email, phone, role } = parsed.data;
    const result = await addContact(prisma, {
      clientId,
      name,
      email: email || null,
      phone: phone || null,
      role: role || null,
      actorId: user.id,
    });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateContactAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = contactSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      role: formData.get("role"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { name, email, phone, role } = parsed.data;
    const result = await updateContact(prisma, {
      contactId: String(formData.get("contactId") ?? ""),
      name,
      email: email || null,
      phone: phone || null,
      role: role || null,
      actorId: user.id,
    });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setPrimaryContactAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const result = await setPrimaryContact(prisma, {
      contactId: String(formData.get("contactId") ?? ""),
      actorId: user.id,
    });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeContactAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const result = await removeContact(prisma, {
      contactId: String(formData.get("contactId") ?? ""),
      actorId: user.id,
    });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
