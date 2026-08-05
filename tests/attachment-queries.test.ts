import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { listAttachments } from "@/lib/attachment-queries";

type AttachmentRowSource = {
  id: string;
  fileKey: string;
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
    fileKey: "TASK/t1/cuid1/brief.pdf",
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

  it("maps a row through the flat shape, carrying the raw fileKey through for the download button", async () => {
    const { db } = fakeDb({ attachments: [attachmentRow()] });
    const rows = await listAttachments(db, { parentType: "TASK", parentId: "t1" });
    expect(rows[0]).toEqual({
      id: "a1",
      fileKey: "TASK/t1/cuid1/brief.pdf",
      fileName: "brief.pdf",
      contentType: "application/pdf",
      size: 51200,
      uploaderId: "u1",
      uploaderName: "Dana Reeve",
      uploaderInitials: "DR",
      at: CREATED_AT,
    });
  });

  it("works the same for a PROJECT or CLIENT parent — the query has no TASK-specific logic", async () => {
    const { db, findManyArgs } = fakeDb({ attachments: [] });
    await listAttachments(db, { parentType: "CLIENT", parentId: "c1" });
    expect(where(findManyArgs[0])).toEqual({ parentType: "CLIENT", parentId: "c1" });
  });
});
