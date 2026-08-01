import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PROJECT_HEALTH_BADGE, PROJECT_HEALTH_LABEL } from "@/lib/project";
import { shortDate } from "@/lib/dates";
import type { ProjectListRow } from "@/lib/project-queries";

const SWATCH: Record<number, string> = {
  1: "bg-[var(--pj1)]",
  2: "bg-[var(--pj2)]",
  3: "bg-[var(--pj3)]",
  4: "bg-[var(--pj4)]",
  5: "bg-[var(--pj5)]",
  6: "bg-[var(--pj6)]",
};

/** Shared by the client detail page and the global projects list — the same
 * row, with the client column switched on for the global surface. */
export function ProjectRow({ row, showClient = false }: { row: ProjectListRow; showClient?: boolean }) {
  return (
    <Link
      href={`/projects/${row.id}`}
      transitionTypes={["nav-forward"]}
      className={`grid items-center gap-4 border-b border-[var(--border)] px-4 py-3 last:border-b-0 hover:bg-[var(--surface-2)] ${
        showClient
          ? "grid-cols-[2fr_1fr_1.4fr_auto_auto]"
          : "grid-cols-[2fr_1.4fr_auto_auto]"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`h-8 w-[3px] flex-none rounded-full ${SWATCH[row.colorIndex] ?? SWATCH[1]}`} />
        <div className="min-w-0">
          <p
            style={{ viewTransitionName: `project-${row.id}` }}
            className="truncate text-sm font-medium text-[var(--text)]"
          >
            {row.name}
          </p>
          <p className="truncate text-xs text-[var(--text-3)]">{row.subtitle}</p>
        </div>
      </div>

      {showClient ? (
        <span className="truncate text-sm text-[var(--text-2)]">{row.clientName}</span>
      ) : null}

      <ProgressBar view={row.progress} />

      <Badge kind={PROJECT_HEALTH_BADGE[row.health]} dot>
        {PROJECT_HEALTH_LABEL[row.health]}
      </Badge>

      <span className="w-16 text-right text-xs text-[var(--text-3)]">
        {row.dueDate ? shortDate(row.dueDate) : "—"}
      </span>
    </Link>
  );
}
