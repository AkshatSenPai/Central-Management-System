import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { listAttachments } from "@/lib/attachment-queries";

type AttachmentRowSource = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedById: string;
  createdAt: Date;
  uploadedBy: { name: string };
};

function fakeDb(parts: { attachments?: AttachmentRowSource[] }) {
  const byDelegate = { attachment: 0 };
  const findManyArgs: unknown[] = [];

  const db = {
    attachment: {
      findMany: async (args: unknown) => {
        byDelegate.attachment++;
        findManyArgs.push(args);
        return parts.attachments ?? [];
      },
    },
  } as unknown as PrismaClient;

  return { db, callsByDelegate: () => ({ ...byDelegate }), findManyArgs };
}

const CREATED_AT = new Date("2026-08-05T09:00:00.000Z");

function attachmentRow(overrides: Partial<AttachmentRowSource> = {}): AttachmentRowSource {
  return {
    id: "a1",
    fileName: "brief.pdf",
    contentType: "application/pdf",
    size: 51200,
    uploadedById: "u1",
    createdAt: CREATED_AT,
    uploadedBy: { name: "Dana Reeve" },
    ...overrides,
  };
}

describe("listAttachments", () => {
  const where = (args: unknown) => (args as { where: Record<string, unknown> }).where;

  it("filters by parentType and parentId", async () => {
    const { db, findManyArgs } = fakeDb({ attachments: [] });
    await listAttachments(db, { parentType: "TASK", parentId: "t1" });
    expect(where(findManyArgs[0])).toEqual({ parentType: "TASK", parentId: "t1" });
  });

  it("issues exactly one query", async () => {
    const { db, callsByDelegate } = fakeDb({ attachments: [attachmentRow()] });
    await listAttachments(db, { parentType: "TASK", parentId: "t1" });
    expect(callsByDelegate()).toEqual({ attachment: 1 });
  });

  it("orders newest first", async () => {
    const { db, findManyArgs } = fakeDb({ attachments: [] });
    await listAttachments(db, { parentType: "PROJECT", parentId: "p1" });
    expect((findManyArgs[0] as { orderBy: unknown }).orderBy).toEqual({ createdAt: "desc" });
  });

  // `toEqual` on the whole object, not field-by-field assertions: this row is
  // serialised into the RSC payload of three pages, so an *extra* field is as
  // much a defect as a missing one, and only an exact-shape assertion catches
  // the extra. That is what this test is for now — Task 5 removed `fileKey`
  // from this shape (see `attachment-queries.ts`'s own comment: the download
  // action takes an id and re-reads the key server-side), and nothing but an
  // exact match would notice it creeping back in.
  it("maps a row through the flat shape, and publishes no field the list does not render", async () => {
    const { db } = fakeDb({ attachments: [attachmentRow()] });
    const rows = await listAttachments(db, { parentType: "TASK", parentId: "t1" });
    expect(rows[0]).toEqual({
      id: "a1",
      fileName: "brief.pdf",
      contentType: "application/pdf",
      size: 51200,
      uploaderId: "u1",
      uploaderName: "Dana Reeve",
      uploaderInitials: "DR",
      at: CREATED_AT,
    });
  });

  // The select is the other half of the same guarantee: a field that is never
  // read out of the database cannot be leaked by a mapper that forgets to
  // drop it.
  it("does not even select fileKey — the storage layout never leaves the server", async () => {
    const { db, findManyArgs } = fakeDb({ attachments: [] });
    await listAttachments(db, { parentType: "TASK", parentId: "t1" });
    const select = (findManyArgs[0] as { select: Record<string, unknown> }).select;
    expect(select).not.toHaveProperty("fileKey");
  });

  it("works the same for a PROJECT or CLIENT parent — the query has no TASK-specific logic", async () => {
    const { db, findManyArgs } = fakeDb({ attachments: [] });
    await listAttachments(db, { parentType: "CLIENT", parentId: "c1" });
    expect(where(findManyArgs[0])).toEqual({ parentType: "CLIENT", parentId: "c1" });
  });
});
