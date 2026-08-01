import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getProjectDetail } from "@/lib/project-queries";
import { listProjectTasks } from "@/lib/task-queries";
import { EmptyState } from "@/components/ui/empty-state";
import { Board } from "@/components/tasks/board";

export default async function ProjectBoardPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  const project = await getProjectDetail(prisma, projectId);
  if (!project) notFound();

  const tasks = await listProjectTasks(prisma, projectId);

  return (
    <div className="space-y-6 p-8">
      <nav className="text-xs text-[var(--text-3)]">
        <Link href="/clients" transitionTypes={["nav-back"]}
          className="hover:text-[var(--text-2)]">
          Clients
        </Link>
        <span> / </span>
        <Link href={`/clients/${project.clientId}`} transitionTypes={["nav-back"]}
          className="hover:text-[var(--text-2)]">
          {project.clientName}
        </Link>
        <span> / </span>
        <Link href={`/projects/${project.id}`} transitionTypes={["nav-back"]}
          className="hover:text-[var(--text-2)]">
          {project.name}
        </Link>
        <span> / </span>
        <span className="text-[var(--text-2)]">Board</span>
      </nav>

      <h1 className="text-2xl font-semibold text-[var(--text)]">{project.name}</h1>

      {tasks.length === 0 ? (
        <EmptyState message="No tasks yet." />
      ) : (
        <Board rows={tasks} />
      )}
    </div>
  );
}
