import type { PrismaClient } from "@prisma/client";
import { taskRowSubtitle } from "@/lib/task";
import type { SearchHit } from "@/lib/search";

/** Case-insensitive substring match. `mode: "insensitive"` compiles to ILIKE
 * on Postgres, so this needs no citext column and no extension.
 *
 * Deliberately not full-text search. Postgres tsvector would rank better and
 * handle stemming, but it needs a generated column, an index and a migration,
 * and at this data volume — tens of clients, hundreds of tasks — ILIKE returns
 * in single-digit milliseconds. Revisit when a search feels slow, not before.
 *
 * The term is passed as a parameter by Prisma, so a `%` or `_` in it is
 * matched literally rather than acting as a wildcard, and there is no
 * injection surface.
 */
const TAKE_PER_KIND = 8;

export async function searchEverything(
  db: PrismaClient,
  term: string
): Promise<SearchHit[]> {
  const contains = { contains: term, mode: "insensitive" as const };

  // One round trip's worth of latency rather than three, which matters when
  // the database is a continent away.
  const [clients, projects, tasks] = await Promise.all([
    db.client.findMany({
      where: { name: contains },
      select: { id: true, name: true, sector: true, status: true },
      orderBy: { name: "asc" },
      take: TAKE_PER_KIND,
    }),
    db.project.findMany({
      where: { name: contains },
      select: {
        id: true,
        name: true,
        status: true,
        client: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      take: TAKE_PER_KIND,
    }),
    db.task.findMany({
      where: { title: contains },
      select: {
        id: true,
        title: true,
        dueDate: true,
        project: { select: { name: true, client: { select: { name: true } } } },
      },
      orderBy: { title: "asc" },
      take: TAKE_PER_KIND,
    }),
  ]);

  return [
    ...clients.map((c) => ({
      kind: "client" as const,
      id: c.id,
      title: c.name,
      subtitle: c.sector ?? "Client",
      href: `/clients/${c.id}`,
    })),
    ...projects.map((p) => ({
      kind: "project" as const,
      id: p.id,
      title: p.name,
      subtitle: p.client.name,
      href: `/projects/${p.id}`,
    })),
    ...tasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      // The same subtitle the task lists use, so a task reads identically
      // wherever it is found.
      subtitle: taskRowSubtitle({
        clientName: t.project?.client.name ?? null,
        projectName: t.project?.name ?? null,
        dueDate: t.dueDate,
      }),
      href: `/tasks/${t.id}`,
    })),
  ];
}
