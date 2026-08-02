import type { PrismaClient } from "@prisma/client";
import { clientInitials } from "@/lib/client";

export type CommentRow = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  authorInitials: string;
  edited: boolean;
  at: Date;
};

/** A task's thread, oldest first — a conversation reads downwards.
 *
 * `edited` is derived here rather than shipping `editedAt` to the client,
 * because the marker is all the UI needs and the timestamp would only invite
 * a second date on a row that already has one. */
export async function listTaskComments(
  db: PrismaClient,
  taskId: string
): Promise<CommentRow[]> {
  const rows = await db.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      authorId: true,
      editedAt: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    body: c.body,
    authorId: c.authorId,
    authorName: c.author.name,
    authorInitials: clientInitials(c.author.name),
    edited: c.editedAt !== null,
    at: c.createdAt,
  }));
}
