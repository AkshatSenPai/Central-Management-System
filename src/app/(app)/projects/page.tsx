import { prisma } from "@/lib/prisma";
import { listProjects } from "@/lib/project-queries";
import {
  parseHealthFilter,
  parseStatusFilter,
  projectCountLabel,
  projectListSummary,
} from "@/lib/project";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectRow } from "@/components/projects/project-row";
import { ProjectForm } from "@/components/projects/project-form";
import { ProjectFilters } from "@/components/projects/project-filters";

const COLUMNS = "grid-cols-[2fr_1fr_1.4fr_auto_auto]";

export default async function ProjectsPage(props: {
  searchParams: Promise<{ health?: string | string[]; status?: string | string[] }>;
}) {
  const raw = await props.searchParams;
  const health = parseHealthFilter(raw.health);
  const status = parseStatusFilter(raw.status);

  const [rows, clients] = await Promise.all([
    listProjects(prisma, { health, status }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // The default view is active-only, so the "N active" summary describes it
  // exactly. Once a status filter is on, that phrasing would lie — a Done-only
  // view is not "0 active projects".
  const subtitle = status === null ? projectListSummary(rows) : projectCountLabel(rows.length);

  return (
    <div className="space-y-6 p-8">
      <PageHeader title="Projects" subtitle={subtitle} action={<ProjectForm clients={clients} />} />

      <ProjectFilters health={health} status={status} />

      {rows.length === 0 ? (
        <EmptyState
          message={
            health || status
              ? "No projects match these filters."
              : "No projects yet. Create one from a client's page."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div
            className={`grid ${COLUMNS} gap-4 border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-3)]`}
          >
            <span>Project</span>
            <span>Client</span>
            <span>Progress</span>
            <span>Health</span>
            <span className="w-16 text-right">Due</span>
          </div>

          {rows.map((row) => (
            <ProjectRow key={row.id} row={row} showClient />
          ))}
        </div>
      )}
    </div>
  );
}
