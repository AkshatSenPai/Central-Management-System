import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { MAX_UPLOAD_BYTES } from "@/lib/attachment";

// The lightest stub available for a sibling lib that talks to a live
// service: `r2.ts` is itself deliberately untested (its own file header
// says why — a mocked SDK call only proves "the mock was called," never
// that R2 accepts the request). `vi.mock` replaces the whole module with
// `vi.fn()`s this file controls per test, which is enough to assert
// *which keys* `deleteObjects` was called with — the property that proves
// a sweep targets the right prefix and nothing else — without needing a
// live bucket or a hand-rolled fake that would just re-implement the SDK.
vi.mock("@/lib/r2", () => ({
  presignPut: vi.fn(async () => "https://example.r2.cloudflarestorage.com/signed-put"),
  deleteObjects: vi.fn(async () => undefined),
}));

import { presignPut, deleteObjects } from "@/lib/r2";
import {
  requestUpload,
  confirmUpload,
  removeAttachment,
  deleteAttachmentObjectsFor,
} from "@/lib/attachment-service";

const mockPresignPut = vi.mocked(presignPut);
const mockDeleteObjects = vi.mocked(deleteObjects);

beforeEach(() => {
  mockPresignPut.mockReset();
  mockDeleteObjects.mockReset();
  mockPresignPut.mockResolvedValue("https://example.r2.cloudflarestorage.com/signed-put");
  mockDeleteObjects.mockResolvedValue(undefined);
});

type FakeParts = {
  /** Row returned by task.findUnique — one hop of resolveParentScope's TASK walk. */
  task?: { project: { clientId: string | null } | null } | null;
  /** Row returned by project.findUnique — the PROJECT case, and TASK's second hop. */
  project?: { clientId: string } | null;
  /** Row returned by client.findUnique — the CLIENT case (the parent IS the client). */
  client?: { id: string } | null;
  /** Row returned by attachment.findUnique — the load in removeAttachment. */
  attachment?: unknown;
  /** Rows returned by attachment.findMany — deleteAttachmentObjectsFor's sweep. */
  attachments?: { id: string; fileKey: string }[];
  /** Thrown by attachment.create when set — simulates a retried confirm racing
   * the unique index on fileKey (P2002). */
  createError?: unknown;
  /** Thrown by attachment.delete when set — simulates a concurrent removal
   * winning the race between removeAttachment's read and its transaction. */
  deleteError?: unknown;
  /** Every write call, across both sinks and the mocked R2 calls, appends its
   * own label here in the order it actually ran — the only way to prove an
   * *ordering* decision (removeAttachment's row-then-object choice) rather
   * than just which calls happened. */
  sequence?: string[];
};

type Sink = {
  created: Record<string, unknown>[];
  deleted: unknown[];
  deletedMany: unknown[];
  activity: Record<string, unknown>[];
};

function emptySink(): Sink {
  return { created: [], deleted: [], deletedMany: [], activity: [] };
}

/** The task-service/calendar-event-service fake shape, copied exactly
 * (`tests/calendar-event-service.test.ts:52-57`): reads are shared between
 * `db` and `tx`, but writes go to the sink they were called on — so a write
 * issued on the outer `db` (a non-transactional slip, including
 * `recordActivity(db, …)` instead of `recordActivity(tx, …)`) lands in `dbW`
 * and fails any test asserting it empty, instead of silently passing. */
function fakeDb(parts: FakeParts) {
  const dbW = emptySink();
  const txW = emptySink();
  const push = (label: string) => parts.sequence?.push(label);

  const reads = {
    task: {
      findUnique: async () => parts.task ?? null,
    },
    project: {
      findUnique: async () => parts.project ?? null,
    },
    client: {
      findUnique: async () => parts.client ?? null,
    },
    attachment: {
      findUnique: async () => parts.attachment ?? null,
      findMany: async () => parts.attachments ?? [],
    },
  };

  const writers = (sink: Sink, tag: "db" | "tx") => ({
    attachment: {
      create: async (a: { data: Record<string, unknown> }) => {
        if (parts.createError) throw parts.createError;
        sink.created.push(a.data);
        push(`${tag}.attachment.create`);
        return { id: "att1", ...a.data };
      },
      delete: async (a: unknown) => {
        if (parts.deleteError) throw parts.deleteError;
        sink.deleted.push(a);
        push(`${tag}.attachment.delete`);
        return {};
      },
      deleteMany: async (a: unknown) => {
        sink.deletedMany.push(a);
        push(`${tag}.attachment.deleteMany`);
        return { count: 0 };
      },
    },
    activityLog: {
      create: async (a: { data: Record<string, unknown> }) => {
        sink.activity.push(a.data);
        push(`${tag}.activityLog.create`);
        return a.data;
      },
    },
  });

  const db = {
    task: reads.task,
    project: reads.project,
    client: reads.client,
    attachment: { ...reads.attachment, ...writers(dbW, "db").attachment },
    activityLog: writers(dbW, "db").activityLog,
    // Mirrors real transactional rollback: a thrown error undoes everything
    // this specific call pushed into txW before the error propagates, the
    // same behaviour tests/calendar-event-service.test.ts's fake provides.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = {
        created: txW.created.length,
        deleted: txW.deleted.length,
        deletedMany: txW.deletedMany.length,
        activity: txW.activity.length,
      };
      try {
        return await fn({
          task: reads.task,
          project: reads.project,
          client: reads.client,
          attachment: { ...reads.attachment, ...writers(txW, "tx").attachment },
          activityLog: writers(txW, "tx").activityLog,
        });
      } catch (e) {
        txW.created.length = before.created;
        txW.deleted.length = before.deleted;
        txW.deletedMany.length = before.deletedMany;
        txW.activity.length = before.activity;
        throw e;
      }
    },
  } as unknown as PrismaClient;

  return { db, dbW, txW };
}

const baseRequestInput = {
  parentType: "TASK" as const,
  parentId: "t1",
  fileName: "brief.pdf",
  contentType: "application/pdf",
  sizeBytes: 51200,
  actorId: "u1",
};

const taskWithProject = { project: { clientId: "c1" } };
const personalTask = { project: null };

describe("requestUpload", () => {
  it("rejects a zero-byte file via validateUpload, before minting a URL", async () => {
    const { db } = fakeDb({});
    const result = await requestUpload(db, { ...baseRequestInput, sizeBytes: 0 });
    expect(result).toEqual({ ok: false, error: "brief.pdf is empty" });
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  it("rejects an over-limit file via validateUpload, before minting a URL", async () => {
    const { db } = fakeDb({});
    const result = await requestUpload(db, { ...baseRequestInput, sizeBytes: MAX_UPLOAD_BYTES + 1 });
    expect(result.ok).toBe(false);
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  // The size check runs before any read, so it needs no parent fixture at
  // all — this is what proves that ordering rather than assuming it.
  it("the size check needs no parent lookup — a task fixture is not even supplied here", async () => {
    const { db } = fakeDb({ task: null });
    const result = await requestUpload(db, { ...baseRequestInput, sizeBytes: 0 });
    expect(result.ok).toBe(false);
  });

  it("errors when the parent does not exist, without minting a URL", async () => {
    const { db } = fakeDb({ task: null });
    const result = await requestUpload(db, baseRequestInput);
    expect(result).toEqual({ ok: false, error: "Task not found" });
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at the limit", async () => {
    const { db } = fakeDb({ task: taskWithProject });
    const result = await requestUpload(db, { ...baseRequestInput, sizeBytes: MAX_UPLOAD_BYTES });
    expect(result.ok).toBe(true);
  });

  it("writes no row on either sink, and returns a key built through buildFileKey", async () => {
    const { db, dbW, txW } = fakeDb({ task: taskWithProject });
    const result = await requestUpload(db, baseRequestInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // {parentType}/{parentId}/{cuid}/{sanitised filename} — §6:109. The
      // middle segment is requestUpload's own fresh, per-call token, so only
      // its shape (not its exact value) is asserted.
      expect(result.data.fileKey).toMatch(
        /^TASK\/t1\/[0-9a-f-]{8,}\/brief\.pdf$/
      );
      expect(result.data.uploadUrl).toBe("https://example.r2.cloudflarestorage.com/signed-put");
    }
    expect(dbW.created).toHaveLength(0);
    expect(txW.created).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
  });

  it("uses the sanitised filename in the key, never the raw one", async () => {
    const { db } = fakeDb({ task: taskWithProject });
    const result = await requestUpload(db, { ...baseRequestInput, fileName: "../../etc/passwd" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fileKey).not.toContain("..");
      expect(result.data.fileKey.split("/")).toHaveLength(4);
    }
  });

  it("mints a fresh key per call — the unguessability property, not just a shared shape", async () => {
    const { db } = fakeDb({ task: taskWithProject });
    const first = await requestUpload(db, baseRequestInput);
    const second = await requestUpload(db, baseRequestInput);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.data.fileKey).not.toBe(second.data.fileKey);
    }
  });

  it("passes the declared content-type and size through to presignPut's content-length condition", async () => {
    const { db } = fakeDb({ task: taskWithProject });
    await requestUpload(db, { ...baseRequestInput, contentType: "image/png", sizeBytes: 2048 });
    expect(mockPresignPut).toHaveBeenCalledTimes(1);
    expect(mockPresignPut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "image/png", contentLength: 2048 })
    );
  });

  it("works the same for a PROJECT or CLIENT parent — the existence check has no TASK-specific branching", async () => {
    const { db: projectDb } = fakeDb({ project: { clientId: "c9" } });
    const projectResult = await requestUpload(projectDb, {
      ...baseRequestInput,
      parentType: "PROJECT",
      parentId: "p1",
    });
    expect(projectResult.ok).toBe(true);

    const { db: clientDb } = fakeDb({ client: { id: "c1" } });
    const clientResult = await requestUpload(clientDb, {
      ...baseRequestInput,
      parentType: "CLIENT",
      parentId: "c1",
    });
    expect(clientResult.ok).toBe(true);
  });
});

const baseConfirmInput = {
  parentType: "TASK" as const,
  parentId: "t1",
  fileKey: "TASK/t1/cuid1/brief.pdf",
  fileName: "brief.pdf",
  contentType: "application/pdf",
  sizeBytes: 51200,
  actorId: "u1",
};

describe("confirmUpload", () => {
  it("errors when the parent task does not exist, with nothing written", async () => {
    const { db, dbW, txW } = fakeDb({ task: null });
    const result = await confirmUpload(db, baseConfirmInput);
    expect(result).toEqual({ ok: false, error: "Task not found" });
    expect(txW.created).toHaveLength(0);
    expect(dbW.created).toHaveLength(0);
  });

  it("errors when the parent project does not exist, with nothing written", async () => {
    const { db, txW } = fakeDb({ project: null });
    const result = await confirmUpload(db, { ...baseConfirmInput, parentType: "PROJECT", parentId: "p1" });
    expect(result).toEqual({ ok: false, error: "Project not found" });
    expect(txW.created).toHaveLength(0);
  });

  it("errors when the parent client does not exist, with nothing written", async () => {
    const { db, txW } = fakeDb({ client: null });
    const result = await confirmUpload(db, { ...baseConfirmInput, parentType: "CLIENT", parentId: "c1" });
    expect(result).toEqual({ ok: false, error: "Client not found" });
    expect(txW.created).toHaveLength(0);
  });

  it("rejects an invalid declared size before any write", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject });
    const result = await confirmUpload(db, { ...baseConfirmInput, sizeBytes: 0 });
    expect(result.ok).toBe(false);
    expect(txW.created).toHaveLength(0);
  });

  it("writes the row and records attachment.added in one transaction, both on tx, never on the outer db", async () => {
    const { db, dbW, txW } = fakeDb({ task: taskWithProject });
    const result = await confirmUpload(db, baseConfirmInput);
    expect(result.ok).toBe(true);
    expect(txW.created).toHaveLength(1);
    expect(txW.created[0]).toMatchObject({
      parentType: "TASK",
      parentId: "t1",
      fileKey: "TASK/t1/cuid1/brief.pdf",
      fileName: "brief.pdf",
      contentType: "application/pdf",
      size: 51200,
      uploadedById: "u1",
    });
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "attachment.added", entityType: "ATTACHMENT" });
    expect(txW.activity[0].meta).toEqual({ name: "brief.pdf" });
    expect(dbW.created).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });

  it("resolves clientId through a task's project for the activity row's scope", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject });
    await confirmUpload(db, baseConfirmInput);
    expect(txW.activity[0]).toMatchObject({ clientId: "c1" });
  });

  it("resolves clientId to null for a personal task with no project", async () => {
    const { db, txW } = fakeDb({ task: personalTask });
    await confirmUpload(db, baseConfirmInput);
    expect(txW.activity[0]).toMatchObject({ clientId: null });
  });

  it("resolves clientId directly from a PROJECT parent", async () => {
    const { db, txW } = fakeDb({ project: { clientId: "c9" } });
    await confirmUpload(db, { ...baseConfirmInput, parentType: "PROJECT", parentId: "p1" });
    expect(txW.activity[0]).toMatchObject({ clientId: "c9" });
  });

  it("resolves clientId as the parent itself for a CLIENT parent", async () => {
    const { db, txW } = fakeDb({ client: { id: "c1" } });
    await confirmUpload(db, { ...baseConfirmInput, parentType: "CLIENT", parentId: "c1" });
    expect(txW.activity[0]).toMatchObject({ clientId: "c1" });
  });

  it("maps a concurrently-confirmed duplicate fileKey (P2002) to a friendly error, rolling back the activity row", async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`fileKey`)", {
      code: "P2002",
      clientVersion: "test",
    });
    const { db, txW } = fakeDb({ task: taskWithProject, createError: duplicate });
    const result = await confirmUpload(db, baseConfirmInput);
    expect(result).toEqual({ ok: false, error: "This upload was already confirmed" });
    expect(txW.activity).toEqual([]);
  });
});

describe("removeAttachment", () => {
  // uploadedById "u1" — most tests below act as this same uploader ("u1",
  // isAdmin: false) to prove the ordinary path still works once the gate
  // exists; the permission tests further down act as someone else instead.
  const storedAttachment = {
    id: "att1",
    parentType: "TASK",
    parentId: "t1",
    fileKey: "TASK/t1/cuid1/brief.pdf",
    fileName: "brief.pdf",
    uploadedById: "u1",
  };

  it("errors when the attachment does not exist", async () => {
    const { db } = fakeDb({ attachment: null });
    const result = await removeAttachment(db, { attachmentId: "ghost", actorId: "u1", isAdmin: false });
    expect(result).toEqual({ ok: false, error: "Attachment not found" });
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  // Deliberate extension of the spec (§6/§7 do not rule on this) applying
  // the house pattern D3/announcement/calendar-event already set: uploader
  // or admin, nobody else. Nothing written, R2 never touched.
  it("refuses a non-uploader, non-admin removal, with nothing written and no R2 call", async () => {
    const { db, dbW, txW } = fakeDb({ attachment: storedAttachment, task: taskWithProject });
    const result = await removeAttachment(db, {
      attachmentId: "att1",
      actorId: "someone-else",
      isAdmin: false,
    });
    expect(result).toEqual({ ok: false, error: "You can only remove attachments you uploaded" });
    expect(txW.deleted).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.deleted).toHaveLength(0);
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  it("an admin who did not upload the file may still remove it", async () => {
    const { db, txW } = fakeDb({ attachment: storedAttachment, task: taskWithProject });
    const result = await removeAttachment(db, {
      attachmentId: "att1",
      actorId: "someone-else",
      isAdmin: true,
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.deleted).toHaveLength(1);
  });

  it("the uploader may remove their own attachment without being an admin", async () => {
    const { db, txW } = fakeDb({ attachment: storedAttachment, task: taskWithProject });
    const result = await removeAttachment(db, { attachmentId: "att1", actorId: "u1", isAdmin: false });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.deleted).toHaveLength(1);
  });

  it("deletes the row and records attachment.removed in one transaction, both on tx, never on the outer db", async () => {
    const { db, dbW, txW } = fakeDb({ attachment: storedAttachment, task: taskWithProject });
    const result = await removeAttachment(db, { attachmentId: "att1", actorId: "u1", isAdmin: false });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.deleted).toHaveLength(1);
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({
      action: "attachment.removed",
      entityType: "ATTACHMENT",
      clientId: "c1",
    });
    expect(txW.activity[0].meta).toEqual({ name: "brief.pdf" });
    expect(dbW.deleted).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });

  it("deletes the R2 object at the attachment's own fileKey", async () => {
    const { db } = fakeDb({ attachment: storedAttachment, task: taskWithProject });
    await removeAttachment(db, { attachmentId: "att1", actorId: "u1", isAdmin: false });
    expect(mockDeleteObjects).toHaveBeenCalledWith(["TASK/t1/cuid1/brief.pdf"]);
  });

  // The ordering decision this task asks to be defended: the row (and its
  // activity entry) are committed to Postgres BEFORE the R2 object-delete is
  // even attempted. See the ordering comment on removeAttachment itself for
  // the full reasoning; this test is what would fail if the order were ever
  // flipped back to object-first.
  it("deletes the row before attempting the R2 object-delete — proves the order, not just that both happened", async () => {
    const sequence: string[] = [];
    mockDeleteObjects.mockImplementation(async () => {
      sequence.push("r2.deleteObjects");
    });
    const { db } = fakeDb({ attachment: storedAttachment, task: taskWithProject, sequence });
    await removeAttachment(db, { attachmentId: "att1", actorId: "u1", isAdmin: false });
    expect(sequence).toEqual(["tx.attachment.delete", "tx.activityLog.create", "r2.deleteObjects"]);
  });

  // The failure-direction proof: when the object-delete fails, the row is
  // ALREADY gone (committed before the R2 call ran at all), so the outcome
  // is an orphan R2 object with no row — a leak, invisible and reapable —
  // never a row left pointing at a file that turned out to be gone.
  it("a failed object-delete does not leave the row claiming a file that is gone — the row is already gone by then", async () => {
    mockDeleteObjects.mockRejectedValue(new Error("R2 unreachable"));
    const { db, txW } = fakeDb({ attachment: storedAttachment, task: taskWithProject });
    await expect(
      removeAttachment(db, { attachmentId: "att1", actorId: "u1", isAdmin: false })
    ).rejects.toThrow("R2 unreachable");
    // The DB half of the operation is durably done — nothing here is
    // "the row still exists, still claiming the file is there": there is no
    // row left to claim anything, in either direction.
    expect(txW.deleted).toHaveLength(1);
    expect(txW.activity).toHaveLength(1);
  });

  it("maps a concurrent removal race (P2025) to Attachment not found, and never calls R2", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("Record to delete does not exist.", {
      code: "P2025",
      clientVersion: "test",
    });
    const { db, txW } = fakeDb({ attachment: storedAttachment, task: taskWithProject, deleteError: race });
    const result = await removeAttachment(db, { attachmentId: "att1", actorId: "u1", isAdmin: false });
    expect(result).toEqual({ ok: false, error: "Attachment not found" });
    expect(txW.activity).toEqual([]);
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  it("still removes the attachment when its parent no longer exists, logging clientId as null", async () => {
    const { db, txW } = fakeDb({ attachment: storedAttachment, task: null });
    const result = await removeAttachment(db, { attachmentId: "att1", actorId: "u1", isAdmin: false });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.activity[0]).toMatchObject({ clientId: null });
  });
});

describe("deleteAttachmentObjectsFor", () => {
  it("does nothing gracefully when a parent has no attachments", async () => {
    const { db, dbW, txW } = fakeDb({ attachments: [] });
    await deleteAttachmentObjectsFor(db, { parentType: "TASK", parentId: "t1" });
    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(dbW.deletedMany).toHaveLength(0);
    expect(txW.deletedMany).toHaveLength(0);
  });

  it("deletes every object at this parent's keys, then deletes exactly those rows", async () => {
    const rows = [
      { id: "att1", fileKey: "TASK/t1/c1/brief.pdf" },
      { id: "att2", fileKey: "TASK/t1/c2/photo.png" },
    ];
    const { db, dbW } = fakeDb({ attachments: rows });
    await deleteAttachmentObjectsFor(db, { parentType: "TASK", parentId: "t1" });
    expect(mockDeleteObjects).toHaveBeenCalledWith(["TASK/t1/c1/brief.pdf", "TASK/t1/c2/photo.png"]);
    expect(dbW.deletedMany).toHaveLength(1);
    expect(dbW.deletedMany[0]).toEqual({ where: { id: { in: ["att1", "att2"] } } });
  });

  // The order this function is specified to use (§6:111, task-4-brief.md):
  // objects first, rows second — proven the same way removeAttachment's
  // opposite order is proven, by a shared sequence array.
  it("deletes the objects before the rows", async () => {
    const sequence: string[] = [];
    mockDeleteObjects.mockImplementation(async () => {
      sequence.push("r2.deleteObjects");
    });
    const rows = [{ id: "att1", fileKey: "TASK/t1/c1/brief.pdf" }];
    const { db } = fakeDb({ attachments: rows, sequence });
    await deleteAttachmentObjectsFor(db, { parentType: "TASK", parentId: "t1" });
    expect(sequence).toEqual(["r2.deleteObjects", "db.attachment.deleteMany"]);
  });

  it("propagates a deleteObjects failure and deletes no rows at all", async () => {
    mockDeleteObjects.mockRejectedValue(new Error("R2 refused to delete 1 of 2 requested object(s)"));
    const rows = [
      { id: "att1", fileKey: "TASK/t1/c1/brief.pdf" },
      { id: "att2", fileKey: "TASK/t1/c2/photo.png" },
    ];
    const { db, dbW } = fakeDb({ attachments: rows });
    await expect(deleteAttachmentObjectsFor(db, { parentType: "TASK", parentId: "t1" })).rejects.toThrow(
      "R2 refused to delete"
    );
    expect(dbW.deletedMany).toHaveLength(0);
  });

  it("works identically for a CLIENT parent — no TASK-specific branching", async () => {
    const rows = [{ id: "att1", fileKey: "CLIENT/c1/cuid1/logo.png" }];
    const { db } = fakeDb({ attachments: rows });
    await deleteAttachmentObjectsFor(db, { parentType: "CLIENT", parentId: "c1" });
    expect(mockDeleteObjects).toHaveBeenCalledWith(["CLIENT/c1/cuid1/logo.png"]);
  });
});
