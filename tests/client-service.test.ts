import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

// `deleteClient` now sweeps its attachments' R2 objects, so
// `client-service.ts` imports `attachment-service.ts`, which imports
// `r2.ts` — and `r2.ts` builds its `S3Client` at module scope from four env
// vars a test run does not have (`r2.ts:83-97`). Without this mock the
// import graph throws and this file never loads. Same `vi.mock`, same
// reasoning, as `tests/attachment-service.test.ts` and
// `tests/task-service.test.ts`.
vi.mock("@/lib/r2", () => ({
  deleteObjects: vi.fn(async () => undefined),
  R2DeleteObjectsError: class extends Error {},
}));

import { deleteObjects } from "@/lib/r2";
import { createClient, updateClient, deleteClient } from "@/lib/client-service";

const mockDeleteObjects = vi.mocked(deleteObjects);

beforeEach(() => {
  mockDeleteObjects.mockReset();
  mockDeleteObjects.mockResolvedValue(undefined);
});

type FakeParts = {
  /** Row returned by client.findFirst — the case-insensitive duplicate probe. */
  duplicate?: unknown;
  /** Row returned by client.findUnique. */
  client?: unknown;
  projectCount?: number;
  /** Contracts on file under this client. `deleteClient` refuses while any
   * exist — a contract register with holes in it cannot be audited, and the
   * FK is RESTRICT to back it up. Absent means none, the shape every other
   * test here assumes. */
  contractCount?: number;
  transactionError?: unknown;
  /** Rows returned by attachment.findMany — what `deleteClient`'s
   * `deleteAttachmentObjectsFor` sweep finds under this client. Absent means
   * a client with no files, the shape every other test here assumes. */
  attachments?: { id: string; fileKey: string }[];
};

function fakeDb(parts: FakeParts) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const activity: Record<string, unknown>[] = [];
  const attachmentsDeleted: unknown[] = [];
  const args: { attachmentFindManyWhere?: unknown } = {};

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

  // Returns the fixture regardless of `where`; the scope is asserted
  // separately off `args.attachmentFindManyWhere`, for the reason
  // `tests/attachment-service.test.ts` records — a fake that filtered here
  // would hide a sweep that dropped `parentId` and reached every CLIENT
  // attachment in the database.
  const attachmentDelegate = {
    findMany: async (a: { where: unknown }) => {
      args.attachmentFindManyWhere = a.where;
      return parts.attachments ?? [];
    },
    deleteMany: async (a: unknown) => {
      attachmentsDeleted.push(a);
      return { count: 0 };
    },
  };

  const db = {
    client: clientDelegate,
    project: { count: async () => parts.projectCount ?? 0 },
    contract: { count: async () => parts.contractCount ?? 0 },
    activityLog: { create: logCreate },
    attachment: attachmentDelegate,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (parts.transactionError) throw parts.transactionError;
      const tx = {
        client: clientDelegate,
        activityLog: { create: logCreate },
        attachment: attachmentDelegate,
      };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  return { db, created, updates, deletes, activity, attachmentsDeleted, args };
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

  /** A contract is a legal record whose agreement number must stay
   * answerable, so a client who has ever been sent one is kept. The message
   * points at the alternative rather than at a "remove them first" that has
   * no corresponding action anywhere in the app. */
  it("refuses to delete a client that has contracts, and says what to do instead", async () => {
    const { db, deletes } = fakeDb({ client: existingClient, projectCount: 0, contractCount: 1 });
    expect(await deleteClient(db, { clientId: "c1", actorId: "actor1" })).toEqual({
      ok: false,
      error:
        "This client has contracts on file and cannot be deleted — set them to Former instead",
    });
    expect(deletes).toHaveLength(0);
  });

  /** Two RESTRICT relations now point at Client, so the P2003 handler picks
   * its message from the constraint that actually fired. Telling somebody to
   * remove projects from a client that has none is a dead end. */
  it("names contracts when the racing P2003 came from the contract constraint", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
      code: "P2003",
      clientVersion: "test",
      meta: { constraint: "Contract_clientId_fkey" },
    });
    const { db } = fakeDb({ client: existingClient, projectCount: 0, transactionError: race });
    expect(await deleteClient(db, { clientId: "c1", actorId: "actor1" })).toEqual({
      ok: false,
      error:
        "This client has contracts on file and cannot be deleted — set them to Former instead",
    });
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

  // The client half of spec §6:111's leak. See the same block in
  // tests/task-service.test.ts for what these can and cannot prove — the
  // bucket itself is task 7's job.
  describe("the attachment sweep", () => {
    const attachments = [
      { id: "a1", fileKey: "CLIENT/c1/uuid1/msa.pdf" },
      { id: "a2", fileKey: "CLIENT/c1/uuid2/logo.svg" },
    ];

    it("deletes every R2 object under the client, and the rows naming them", async () => {
      const { db, attachmentsDeleted } = fakeDb({
        client: existingClient,
        projectCount: 0,
        attachments,
      });
      const result = await deleteClient(db, { clientId: "c1", actorId: "actor1" });
      expect(result).toEqual({ ok: true, data: undefined });
      expect(mockDeleteObjects).toHaveBeenCalledWith([
        "CLIENT/c1/uuid1/msa.pdf",
        "CLIENT/c1/uuid2/logo.svg",
      ]);
      expect(attachmentsDeleted).toEqual([{ where: { id: { in: ["a1", "a2"] } } }]);
    });

    it("scopes the sweep to this client, by both parentType and parentId", async () => {
      const { db, args } = fakeDb({ client: existingClient, projectCount: 0, attachments });
      await deleteClient(db, { clientId: "c1", actorId: "actor1" });
      expect(args.attachmentFindManyWhere).toEqual({ parentType: "CLIENT", parentId: "c1" });
    });

    it("still deletes the rows, and still succeeds, when R2 refuses", async () => {
      mockDeleteObjects.mockRejectedValue(new Error("R2 unreachable"));
      const { db, deletes, attachmentsDeleted } = fakeDb({
        client: existingClient,
        projectCount: 0,
        attachments,
      });
      const result = await deleteClient(db, { clientId: "c1", actorId: "actor1" });
      expect(result).toEqual({ ok: true, data: undefined });
      expect(attachmentsDeleted).toEqual([{ where: { id: { in: ["a1", "a2"] } } }]);
      expect(deletes).toHaveLength(1);
    });

    it("touches R2 not at all for a client with no files", async () => {
      const { db, attachmentsDeleted } = fakeDb({ client: existingClient, projectCount: 0 });
      await deleteClient(db, { clientId: "c1", actorId: "actor1" });
      expect(mockDeleteObjects).not.toHaveBeenCalled();
      expect(attachmentsDeleted).toHaveLength(0);
    });

    // A client that still has projects is refused before the transaction
    // opens, so nothing is swept — which is also why this sweep only ever
    // needs to handle CLIENT attachments: no projects means no PROJECT
    // attachments and no project tasks to carry TASK ones.
    it("sweeps nothing when the delete is refused for having projects", async () => {
      const { db, attachmentsDeleted } = fakeDb({
        client: existingClient,
        projectCount: 2,
        attachments,
      });
      await deleteClient(db, { clientId: "c1", actorId: "actor1" });
      expect(mockDeleteObjects).not.toHaveBeenCalled();
      expect(attachmentsDeleted).toHaveLength(0);
    });
  });
});
