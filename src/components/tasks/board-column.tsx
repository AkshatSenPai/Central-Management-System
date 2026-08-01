import { TASK_STATUS_LABEL, type TaskStatus } from "@/lib/task";

/** A column is always rendered, even empty, because it must stay a drop
 * target. An empty column shows no text by design (Vocabulary Lock) — the
 * min-height is what keeps it droppable rather than a zero-height strip. */
export function BoardColumn({
  status,
  count,
  isOver = false,
  onDragOver,
  onDrop,
  children,
}: {
  status: TaskStatus;
  count: number;
  isOver?: boolean;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex min-h-40 flex-col gap-2 rounded-lg border p-3 ${
        isOver
          ? "border-[var(--accent-line)] bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-[var(--surface-2)]"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium text-[var(--text)]">{TASK_STATUS_LABEL[status]}</h2>
        <span className="text-xs text-[var(--text-3)]">{count}</span>
      </div>
      {children}
    </div>
  );
}
