import { prisma } from "@/lib/prisma";
import { listProjects } from "@/lib/project-queries";
import { parseHealthFilter, projectListSummary } from "@/lib/project";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectRow } from "@/components/projects/project-row";
import { ProjectForm } from "@/components/projects/project-form";
import { HealthFilter } from "@/components/projects/health-filter";

const COLUMNS = "grid-cols-[2fr_1fr_1.4fr_auto_auto]";

export default async function ProjectsPage(props: {
  searchParams: Promise<{ health?: string | string[] }>;
}) {
  const raw = await props.searchParams;
  const health = parseHealthFilter(raw.health);

  const [rows, clients] = await Promise.all([
    listProjects(prisma, { health }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        title="Projects"
        subtitle={projectListSummary(rows)}
        action={<ProjectForm clients={clients} />}
      />

      <HealthFilter value={health} />

      {rows.length === 0 ? (
        <EmptyState
          message={
            health
              ? "No projects match this health filter."
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
