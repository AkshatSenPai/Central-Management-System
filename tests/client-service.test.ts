import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createClient, updateClient, deleteClient } from "@/lib/client-service";

type FakeParts = {
  /** Row returned by client.findFirst — the case-insensitive duplicate probe. */
  duplicate?: unknown;
  /** Row returned by client.findUnique. */
  client?: unknown;
  projectCount?: number;
  transactionError?: unknown;
};

function fakeDb(parts: FakeParts) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const activity: Record<string, unknown>[] = [];

  const create = async (args: { data: Record<string, unknown> }) => {
    created.push(args.data);
    return { id: "new1", ...args.data };
  };
  const update = async (args: { data: Record<string, unknown> }) => {
    updates.push(args.data);
    return args.data;
  };
  const del = async (args: unknown) => {
    deletes.push(args);
    return {};
  };
  const logCreate = async (args: { data: Record<string, unknown> }) => {
    activity.push(args.data);
    return args.data;
  };

  const clientDelegate = {
    findFirst: async () => parts.duplicate ?? null,
    findUnique: async () => parts.client ?? null,
    create,
    update,
    delete: del,
  };

  const db = {
    client: clientDelegate,
    project: { count: async () => parts.projectCount ?? 0 },
    activityLog: { create: logCreate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (parts.transactionError) throw parts.transactionError;
      const tx = { client: clientDelegate, activityLog: { create: logCreate } };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  return { db, created, updates, deletes, activity };
}

const writeInput = {
  name: "Harlow & Fitch",
  status: "ACTIVE" as const,
  sector: "Retail & apparel",
  website: "https://harlowfitch.com",
  engagementType: "Retainer",
  clientSince: new Date("2024-03-01T00:00:00.000Z"),
  accountLeadId: "u1",
  notes: "Long-standing retainer.",
  actorId: "actor1",
};

const existingClient = {
  id: "c1",
  name: "Harlow & Fitch",
  status: "ACTIVE",
  sector: "Retail & apparel",
  website: "https://harlowfitch.com",
  engagementType: "Retainer",
  clientSince: new Date("2024-03-01T00:00:00.000Z"),
  accountLeadId: "u1",
  notes: "Long-standing retainer.",
};

describe("createClient", () => {
  it("rejects a duplicate name regardless of case", async () => {
    const { db } = fakeDb({ duplicate: { id: "c1", name: "harlow & fitch" } });
    expect(await createClient(db, writeInput)).toEqual({
      ok: false,
      error: "A client with this name already exists",
    });
  });

  it("creates the client, returns its id, and logs client.created scoped to the new client", async () => {
    const { db, created, activity } = fakeDb({});
    const result = await createClient(db, writeInput);
    expect(result).toEqual({ ok: true, data: { id: "new1" } });
    expect(created[0]).toMatchObject({ name: "Harlow & Fitch", status: "ACTIVE" });
    expect(activity[0]).toMatchObject({
      actorId: "actor1",
      entityType: "CLIENT",
      entityId: "new1",
      action: "client.created",
      clientId: "new1",
    });
  });

  it("maps a P2002 from a concurrent insert to the same duplicate-name error", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const { db } = fakeDb({ transactionError: race });
    expect(await createClient(db, writeInput)).toEqual({
      ok: false,
      error: "A client with this name already exists",
    });
  });

  it("coerces empty sector, website, engagement type, notes and account lead to null in the write args", async () => {
    const { db, created } = fakeDb({});
    await createClient(db, {
      ...writeInput,
      sector: "",
      website: "",
      engagementType: "",
      accountLeadId: "",
      notes: "",
    });
    expect(created[0]).toMatchObject({
      sector: null,
      website: null,
      engagementType: null,
      accountLeadId: null,
      notes: null,
    });
  });
});

describe("updateClient", () => {
  it("errors on an unknown client", async () => {
    const { db } = fakeDb({});
    expect(await updateClient(db, { ...writeInput, clientId: "ghost" })).toEqual({
      ok: false,
      error: "Client not found",
    });
  });

  it("writes no activity row when nothing changed", async () => {
    const { db, updates, activity } = fakeDb({ client: existingClient });
    const result = await updateClient(db, { ...writeInput, clientId: "c1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates).toHaveLength(0);
    expect(activity).toHaveLength(0);
  });

  it("logs client.updated with the changed fields in meta", async () => {
    const { db, activity } = fakeDb({ client: existingClient });
    await updateClient(db, { ...writeInput, clientId: "c1", sector: "Luxury retail" });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "client.updated", clientId: "c1" });
    expect(activity[0].meta).toMatchObject({
      name: "Harlow & Fitch",
      changes: { sector: { from: "Retail & apparel", to: "Luxury retail" } },
    });
  });

  it("logs client.status_changed instead when the status differs", async () => {
    const { db, activity } = fakeDb({ client: existingClient });
    await updateClient(db, { ...writeInput, clientId: "c1", status: "PAUSED" });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "client.status_changed" });
    expect(activity[0].meta).toMatchObject({ from: "ACTIVE", to: "PAUSED" });
  });
});

describe("deleteClient", () => {
  it("refuses to delete a client that still has projects", async () => {
    const { db, deletes } = fakeDb({ client: existingClient, projectCount: 2 });
    expect(await deleteClient(db, { clientId: "c1", actorId: "actor1" })).toEqual({
      ok: false,
      error: "Remove this client's projects before deleting",
    });
    expect(deletes).toHaveLength(0);
  });

  it("deletes an empty client and logs client.deleted with a null client scope and the name in meta", async () => {
    const { db, deletes, activity } = fakeDb({ client: existingClient, projectCount: 0 });
    const result = await deleteClient(db, { clientId: "c1", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(deletes).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "client.deleted", clientId: null });
    expect(activity[0].meta).toMatchObject({ name: "Harlow & Fitch" });
  });

  it("maps a P2003 thrown between the count and the delete to the same refusal message", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
      code: "P2003",
      clientVersion: "test",
    });
    const { db } = fakeDb({ client: existingClient, projectCount: 0, transactionError: race });
    expect(await deleteClient(db, { clientId: "c1", actorId: "actor1" })).toEqual({
      ok: false,
      error: "Remove this client's projects before deleting",
    });
  });
});
