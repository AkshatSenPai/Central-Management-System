import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addChecklistItem, setChecklistItemDone, removeChecklistItem } from "@/lib/checklist-service";

type FakeParts = {
  /** Row returned by task.findUnique — addChecklistItem's own existence and
   * clientId walk-up (one level, mirroring createTask's project lookup). */
  task?: unknown;
  /** Row returned by checklistItem.findUnique — loadChecklistScope's target,
   * for setChecklistItemDone and removeChecklistItem. */
  item?: unknown;
  /** Rows returned by checklistItem.findMany — the sibling order query. */
  siblings?: { order: number }[];
};

type Sink = {
  created: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  deleted: unknown[];
  activity: Record<string, unknown>[];
};

function emptySink(): Sink {
  return { created: [], updated: [], deleted: [], activity: [] };
}

/** Same shape as task-service.test.ts's fake: reads are shared between `db`
 * and `tx`, but writes go to the sink they were called on — so a write
 * issued on the outer `db` (a non-transactional slip, including
 * `recordActivity(db, …)` instead of `recordActivity(tx, …)`) lands in `dbW`
 * and fails any test asserting it empty, instead of silently passing. The
 * `$transaction` mock also simulates rollback: a thrown error truncates txW
 * back to what it held before that call, mirroring a real rolled-back
 * transaction leaving nothing behind. */
function fakeDb(parts: FakeParts) {
  const dbW = emptySink();
  const txW = emptySink();
  const args: { siblingsWhere?: unknown } = {};

  const reads = {
    task: {
      findUnique: async () => parts.task ?? null,
    },
    checklistItem: {
      findUnique: async () => parts.item ?? null,
      findMany: async (a: { where: unknown }) => {
        args.siblingsWhere = a.where;
        return parts.siblings ?? [];
      },
    },
  };

  const writers = (sink: Sink) => ({
    checklistItem: {
      create: async (a: { data: Record<string, unknown> }) => {
        sink.created.push(a.data);
        return { id: "new1", ...a.data };
      },
      update: async (a: { data: Record<string, unknown> }) => {
        sink.updated.push(a.data);
        return a.data;
      },
      delete: async (a: unknown) => {
        sink.deleted.push(a);
        return {};
      },
    },
    activityLog: {
      create: async (a: { data: Record<string, unknown> }) => {
        sink.activity.push(a.data);
        return a.data;
      },
    },
  });

  const db = {
    task: reads.task,
    checklistItem: { ...reads.checklistItem, ...writers(dbW).checklistItem },
    activityLog: writers(dbW).activityLog,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = {
        created: txW.created.length,
        updated: txW.updated.length,
        deleted: txW.deleted.length,
        activity: txW.activity.length,
      };
      try {
        return await fn({
          task: reads.task,
          checklistItem: { ...reads.checklistItem, ...writers(txW).checklistItem },
          activityLog: writers(txW).activityLog,
        });
      } catch (e) {
        txW.created.length = before.created;
        txW.updated.length = before.updated;
        txW.deleted.length = before.deleted;
        txW.activity.length = before.activity;
        throw e;
      }
    },
  } as unknown as PrismaClient;

  return { db, dbW, txW, args };
}

const taskOnProject = { project: { clientId: "c1" } };
const personalTask = { project: null };

const itemOnProjectTask = {
  id: "i1",
  title: "Send proof",
  done: false,
  taskId: "t1",
  task: { id: "t1", title: "Draft brand brief", project: { clientId: "c1" } },
};

const doneItemOnProjectTask = { ...itemOnProjectTask, done: true };

const itemOnPersonalTask = {
  id: "i2",
  title: "Pack bag",
  done: false,
  taskId: "t2",
  task: { id: "t2", title: "Renew passport", project: null },
};

describe("addChecklistItem", () => {
  it("errors on an unknown task", async () => {
    const { db } = fakeDb({});
    const result = await addChecklistItem(db, { taskId: "ghost", title: "Send proof", actorId: "u1" });
    expect(result).toEqual({ ok: false, error: "Task not found" });
  });

  it("rejects a blank title", async () => {
    const { db } = fakeDb({ task: taskOnProject });
    const result = await addChecklistItem(db, { taskId: "t1", title: "   ", actorId: "u1" });
    expect(result).toEqual({ ok: false, error: "Checklist item title is required" });
  });

  it("scopes the sibling order query to the task", async () => {
    const { db, args } = fakeDb({ task: taskOnProject, siblings: [] });
    await addChecklistItem(db, { taskId: "t1", title: "Send proof", actorId: "u1" });
    expect(args.siblingsWhere).toEqual({ taskId: "t1" });
  });

  it("writes order 0 for a task's first item and one more than the highest existing order otherwise", async () => {
    const first = fakeDb({ task: taskOnProject, siblings: [] });
    await addChecklistItem(first.db, { taskId: "t1", title: "Send proof", actorId: "u1" });
    expect(first.txW.created[0].order).toBe(0);

    const next = fakeDb({ task: taskOnProject, siblings: [{ order: 2 }] });
    await addChecklistItem(next.db, { taskId: "t1", title: "Send proof", actorId: "u1" });
    expect(next.txW.created[0].order).toBe(3);
  });

  it("logs checklist.added carrying the great-grandparent clientId", async () => {
    const { db, txW } = fakeDb({ task: taskOnProject, siblings: [] });
    await addChecklistItem(db, { taskId: "t1", title: "Send proof", actorId: "u1" });
    expect(txW.activity[0]).toMatchObject({
      entityType: "CHECKLIST_ITEM",
      entityId: "new1",
      action: "checklist.added",
      clientId: "c1",
    });
    expect(txW.activity[0].meta).toMatchObject({ name: "Send proof" });
  });

  it("logs an item on a personal task with a null client scope", async () => {
    const { db, txW } = fakeDb({ task: personalTask, siblings: [] });
    await addChecklistItem(db, { taskId: "t2", title: "Pack bag", actorId: "u1" });
    expect(txW.activity[0].clientId).toBeNull();
  });

  it("writes the item and its activity row inside the transaction", async () => {
    const { db, dbW, txW } = fakeDb({ task: taskOnProject, siblings: [] });
    await addChecklistItem(db, { taskId: "t1", title: "Send proof", actorId: "u1" });
    expect(txW.created).toHaveLength(1);
    expect(txW.activity).toHaveLength(1);
    expect(dbW.created).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });
});

describe("setChecklistItemDone", () => {
  it("errors on an unknown item", async () => {
    const { db } = fakeDb({});
    const result = await setChecklistItemDone(db, { itemId: "ghost", done: true, actorId: "u1" });
    expect(result).toEqual({ ok: false, error: "Checklist item not found" });
  });

  it("ticking writes done true and logs checklist.completed with the item title in meta", async () => {
    const { db, txW } = fakeDb({ item: itemOnProjectTask });
    const result = await setChecklistItemDone(db, { itemId: "i1", done: true, actorId: "u1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.updated[0]).toEqual({ done: true });
    expect(txW.activity[0]).toMatchObject({ action: "checklist.completed" });
    expect(txW.activity[0].meta).toMatchObject({ name: "Send proof" });
  });

  it("unticking writes done false and logs checklist.reopened", async () => {
    const { db, txW } = fakeDb({ item: doneItemOnProjectTask });
    const result = await setChecklistItemDone(db, { itemId: "i1", done: false, actorId: "u1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.updated[0]).toEqual({ done: false });
    expect(txW.activity[0]).toMatchObject({ action: "checklist.reopened" });
  });

  it("writes nothing at all when done already holds the requested value", async () => {
    const alreadyDone = fakeDb({ item: doneItemOnProjectTask });
    const tickResult = await setChecklistItemDone(alreadyDone.db, { itemId: "i1", done: true, actorId: "u1" });
    expect(tickResult).toEqual({ ok: true, data: undefined });
    expect(alreadyDone.txW.updated).toHaveLength(0);
    expect(alreadyDone.txW.activity).toHaveLength(0);
    expect(alreadyDone.dbW.updated).toHaveLength(0);
    expect(alreadyDone.dbW.activity).toHaveLength(0);

    const alreadyOpen = fakeDb({ item: itemOnProjectTask });
    const untickResult = await setChecklistItemDone(alreadyOpen.db, { itemId: "i1", done: false, actorId: "u1" });
    expect(untickResult).toEqual({ ok: true, data: undefined });
    expect(alreadyOpen.txW.updated).toHaveLength(0);
    expect(alreadyOpen.txW.activity).toHaveLength(0);
    expect(alreadyOpen.dbW.updated).toHaveLength(0);
    expect(alreadyOpen.dbW.activity).toHaveLength(0);
  });

  it("carries the client scope on the row it writes", async () => {
    const projectItem = fakeDb({ item: itemOnProjectTask });
    await setChecklistItemDone(projectItem.db, { itemId: "i1", done: true, actorId: "u1" });
    expect(projectItem.txW.activity[0].clientId).toBe("c1");

    const personalItem = fakeDb({ item: itemOnPersonalTask });
    await setChecklistItemDone(personalItem.db, { itemId: "i2", done: true, actorId: "u1" });
    expect(personalItem.txW.activity[0].clientId).toBeNull();
  });
});

describe("removeChecklistItem", () => {
  it("errors on an unknown item", async () => {
    const { db } = fakeDb({});
    const result = await removeChecklistItem(db, { itemId: "ghost", actorId: "u1" });
    expect(result).toEqual({ ok: false, error: "Checklist item not found" });
  });

  it("deletes it and logs checklist.removed with the title captured before the delete", async () => {
    const { db, txW } = fakeDb({ item: itemOnProjectTask });
    const result = await removeChecklistItem(db, { itemId: "i1", actorId: "u1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.deleted).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "checklist.removed" });
    expect(txW.activity[0].meta).toMatchObject({ name: "Send proof" });
  });

  it("carries the client scope on the removal row", async () => {
    const projectItem = fakeDb({ item: itemOnProjectTask });
    await removeChecklistItem(projectItem.db, { itemId: "i1", actorId: "u1" });
    expect(projectItem.txW.activity[0].clientId).toBe("c1");

    const personalItem = fakeDb({ item: itemOnPersonalTask });
    await removeChecklistItem(personalItem.db, { itemId: "i2", actorId: "u1" });
    expect(personalItem.txW.activity[0].clientId).toBeNull();
  });
});
