import { Prisma, type PrismaClient } from "@prisma/client";
import { clientInitials } from "@/lib/client";
import {
  isFeedbackOpen,
  sortFeedback,
  type FeedbackKind,
  type FeedbackStatus,
  type FeedbackStatusFilter,
} from "@/lib/feedback";

export type FeedbackRow = {
  id: string;
  kind: FeedbackKind;
  body: string;
  status: FeedbackStatus;
  authorId: string;
  authorName: string;
  authorInitials: string;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

const feedbackSelect = {
  id: true,
  kind: true,
  body: true,
  status: true,
  authorId: true,
  author: { select: { name: true } },
  resolvedBy: { select: { name: true } },
  resolvedAt: true,
  createdAt: true,
} as const;

/** The feedback list.
 *
 * `viewerId` is **not** optional, and there is no "list everything" overload.
 * A member sees only their own submissions; an admin sees the studio's. That
 * is enforced by building the where clause here from an explicit `isAdmin`
 * flag rather than by the page remembering to pass a filter — the same lesson
 * `listAssignedTasks` records about optional `userId` turning a scoped query
 * into an unscoped one the moment a caller passes undefined.
 *
 * Sorting is in memory via `sortFeedback` so untriaged rows lead regardless of
 * status; expressing that rank in SQL would mean a CASE ordering that has to
 * be kept in step with the enum by hand.
 */
export async function listFeedback(
  db: PrismaClient,
  input: { viewerId: string; isAdmin: boolean; status?: FeedbackStatusFilter | null }
): Promise<FeedbackRow[]> {
  const where: Prisma.FeedbackWhereInput = {};
  if (!input.isAdmin) where.authorId = input.viewerId;
  if (input.status && input.status !== "ALL") where.status = input.status;

  const rows = await db.feedback.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: feedbackSelect,
  });

  return sortFeedback(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind as FeedbackKind,
      body: r.body,
      status: r.status as FeedbackStatus,
      authorId: r.authorId,
      authorName: r.author.name,
      authorInitials: clientInitials(r.author.name),
      resolvedByName: r.resolvedBy?.name ?? null,
      resolvedAt: r.resolvedAt,
      createdAt: r.createdAt,
    }))
  );
}

/** How many rows are still owed an answer, in the viewer's own scope.
 *
 * Counted off the same visibility rule as `listFeedback` rather than being a
 * studio-wide number: showing a member "3 open" when all three are somebody
 * else's, and invisible to them, would be worse than showing nothing.
 *
 * Derived from the rows the page already has rather than issued as a second
 * query — the list is unpaginated and small, and a COUNT would have to repeat
 * the visibility clause exactly to stay honest. */
export function countOpenFeedback(rows: ReadonlyArray<{ status: FeedbackStatus }>): number {
  return rows.filter((r) => isFeedbackOpen(r.status)).length;
}
