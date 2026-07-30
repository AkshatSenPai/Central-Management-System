import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  addContact,
  updateContact,
  setPrimaryContact,
  removeContact,
} from "@/lib/contact-service";

type FakeParts = {
  contact?: unknown;
  client?: unknown;
  contactCount?: number;
};

/** The canonical Phase 2 fake: one shared set of closures behind both the
 * top-level delegates and the transaction client, so a write is captured
 * whether the service used `db` or `tx`. */
function fakeDb(parts: FakeParts) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const activity: Record<string, unknown>[] = [];

  const findUnique = async () => parts.contact ?? null;
  const update = async (args: { data: Record<string, unknown> }) => {
    updates.push(args.data);
    return args.data;
  };
  const updateMany = async (args: { data: Record<string, unknown> }) => {
    updates.push(args.data);
    return { count: 1 };
  };
  const create = async (args: { data: Record<string, unknown> }) => {
    created.push(args.data);
    return { id: "new1", ...args.data };
  };
  const del = async (args: unknown) => {
    deletes.push(args);
    return {};
  };
  const logCreate = async (args: { data: Record<string, unknown> }) => {
    activity.push(args.data);
    return args.data;
  };

  const contactDelegate = {
    findUnique,
    update,
    updateMany,
    create,
    delete: del,
    count: async () => parts.contactCount ?? 0,
  };

  const db = {
    clientContact: contactDelegate,
    client: { findUnique: async () => parts.client ?? null },
    activityLog: { create: logCreate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { clientContact: contactDelegate, activityLog: { create: logCreate } };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  return { db, created, updates, deletes, activity };
}

const client = { id: "c1", name: "Harlow & Fitch" };
const contact = {
  id: "ct1",
  clientId: "c1",
  name: "Dana Reeve",
  email: "dana@harlowfitch.com",
  phone: null,
  role: "Marketing Director",
  isPrimary: true,
};

const addInput = {
  clientId: "c1",
  name: "Dana Reeve",
  email: "dana@harlowfitch.com",
  phone: null,
  role: "Marketing Director",
  actorId: "actor1",
};

describe("addContact", () => {
  it("errors on an unknown client", async () => {
    const { db } = fakeDb({});
    expect(await addContact(db, addInput)).toEqual({ ok: false, error: "Client not found" });
  });

  it("makes the first contact for a client primary", async () => {
    const { db, created } = fakeDb({ client, contactCount: 0 });
    await addContact(db, addInput);
    expect(created[0].isPrimary).toBe(true);
  });

  it("leaves a second contact non-primary", async () => {
    const { db, created } = fakeDb({ client, contactCount: 1 });
    await addContact(db, addInput);
    expect(created[0].isPrimary).toBe(false);
  });

  it("lowercases and trims the email before writing", async () => {
    const { db, created } = fakeDb({ client, contactCount: 0 });
    await addContact(db, { ...addInput, email: "  Jo@Example.COM " });
    expect(created[0].email).toBe("jo@example.com");
  });

  it("stores an empty email as null", async () => {
    const { db, created } = fakeDb({ client, contactCount: 0 });
    await addContact(db, { ...addInput, email: "" });
    expect(created[0].email).toBeNull();
  });

  it("logs contact.added scoped to the client", async () => {
    const { db, activity } = fakeDb({ client, contactCount: 0 });
    await addContact(db, addInput);
    expect(activity[0]).toMatchObject({
      actorId: "actor1",
      entityType: "CLIENT_CONTACT",
      entityId: "new1",
      action: "contact.added",
      clientId: "c1",
    });
    expect(activity[0].meta).toMatchObject({ name: "Dana Reeve" });
  });
});

describe("updateContact", () => {
  it("errors on an unknown contact", async () => {
    const { db } = fakeDb({});
    expect(
      await updateContact(db, {
        contactId: "ghost",
        name: "Dana Reeve",
        email: null,
        phone: null,
        role: null,
        actorId: "actor1",
      })
    ).toEqual({ ok: false, error: "Contact not found" });
  });

  it("never writes isPrimary, even when the input carries it", async () => {
    const { db, updates } = fakeDb({ contact });
    // Assigned to a const so TS's excess-property check does not reject the
    // extra key — the point is that the service must ignore it at runtime.
    const smuggled = {
      contactId: "ct1",
      name: "Dana Reeve-Hall",
      email: "dana@harlowfitch.com",
      phone: null,
      role: "Marketing Director",
      actorId: "actor1",
      isPrimary: false,
    };
    await updateContact(db, smuggled);
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0])).not.toContain("isPrimary");
  });
});

describe("setPrimaryContact", () => {
  it("demotes the incumbent and promotes the target inside one transaction", async () => {
    const { db, updates } = fakeDb({ contact: { ...contact, isPrimary: false } });
    const result = await setPrimaryContact(db, { contactId: "ct1", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates).toEqual([{ isPrimary: false }, { isPrimary: true }]);
  });

  it("logs contact.primary_set", async () => {
    const { db, activity } = fakeDb({ contact: { ...contact, isPrimary: false } });
    await setPrimaryContact(db, { contactId: "ct1", actorId: "actor1" });
    expect(activity[0]).toMatchObject({
      entityType: "CLIENT_CONTACT",
      entityId: "ct1",
      action: "contact.primary_set",
      clientId: "c1",
    });
  });
});

describe("removeContact", () => {
  it("deletes the contact and logs contact.removed with the name in meta", async () => {
    const { db, deletes, activity } = fakeDb({ contact });
    const result = await removeContact(db, { contactId: "ct1", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(deletes).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "contact.removed", clientId: "c1" });
    expect(activity[0].meta).toMatchObject({ name: "Dana Reeve" });
  });

  it("removing the primary promotes nobody", async () => {
    const { db, updates } = fakeDb({ contact });
    await removeContact(db, { contactId: "ct1", actorId: "actor1" });
    expect(updates).toHaveLength(0);
  });
});
