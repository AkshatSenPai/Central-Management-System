import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getProjectDetail } from "@/lib/project-queries";
import { PROJECT_HEALTH_BADGE, PROJECT_HEALTH_LABEL } from "@/lib/project";
import { shortDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectForm } from "@/components/projects/project-form";
import { ProjectHealthControl } from "@/components/projects/project-health-control";
import { ProjectStatusControl } from "@/components/projects/project-status-control";
import { ProgressControl } from "@/components/projects/progress-control";
import { MilestoneStrip } from "@/components/projects/milestone-strip";
import { MilestoneForm } from "@/components/projects/milestone-form";

const STAT_LABEL = "text-[11px] font-semibold tracking-wide text-[var(--text-3)]";

export default async function ProjectDetailPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  const project = await getProjectDetail(prisma, projectId);
  if (!project) notFound();

  return (
    <div className="space-y-6 p-8">
      <nav className="text-xs text-[var(--text-3)]">
        <Link href="/clients" className="hover:text-[var(--text-2)]">
          Clients
        </Link>
        <span> / </span>
        <Link href={`/clients/${project.clientId}`} className="hover:text-[var(--text-2)]">
          {project.clientName}
        </Link>
        <span> / </span>
        <span className="text-[var(--text-2)]">Project</span>
      </nav>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-[var(--text)]">{project.name}</h1>
            <Badge kind={PROJECT_HEALTH_BADGE[project.health]} dot>
              {PROJECT_HEALTH_LABEL[project.health]}
            </Badge>
          </div>
          {project.description ? (
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-3)]">{project.description}</p>
          ) : null}
        </div>
        <div className="flex-none">
          <ProjectForm
            project={{
              id: project.id,
              clientId: project.clientId,
              name: project.name,
              description: project.description,
              status: project.status,
              health: project.health,
              startDate: project.startDate,
              dueDate: project.dueDate,
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="min-w-[220px]">
          <p className={STAT_LABEL}>Progress</p>
          <div className="mt-1.5">
            <ProgressBar view={project.progress} size="md" showLabel={false} />
          </div>
          {project.progress.hasUnits ? (
            <p className="mt-1 text-sm text-[var(--text-2)]">{project.progress.percent}% complete</p>
          ) : null}
        </div>

        <div>
          <p className={STAT_LABEL}>Due</p>
          <p className="mt-1.5 text-sm text-[var(--text-2)]">
            {project.dueDate ? `Due ${shortDate(project.dueDate)}` : "No due date"}
          </p>
        </div>

        <div>
          <p className={STAT_LABEL}>Status</p>
          <div className="mt-1.5">
            <ProjectStatusControl
              projectId={project.id}
              clientId={project.clientId}
              status={project.status}
            />
          </div>
        </div>

        <div>
          <p className={STAT_LABEL}>Health</p>
          <div className="mt-1.5">
            <ProjectHealthControl
              projectId={project.id}
              clientId={project.clientId}
              health={project.health}
            />
          </div>
        </div>

        <div>
          <p className={STAT_LABEL}>Progress mode</p>
          <div className="mt-1.5">
            <ProgressControl
              projectId={project.id}
              clientId={project.clientId}
              progressMode={project.progressMode}
              manualProgress={project.manualProgress}
            />
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-[var(--text)]">Milestones</h2>
          <MilestoneForm projectId={project.id} clientId={project.clientId} />
        </div>
        {project.milestones.length === 0 ? (
          <EmptyState message="No milestones yet." />
        ) : (
          <MilestoneStrip
            projectId={project.id}
            clientId={project.clientId}
            milestones={project.milestones}
          />
        )}
      </section>
    </div>
  );
}
