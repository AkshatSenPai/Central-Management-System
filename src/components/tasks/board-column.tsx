import { TASK_STATUS_LABEL, type TaskStatus } from "@/lib/task";

/** A column is always rendered, even empty, because it must stay a drop
 * target. An empty column shows no text by design (Vocabulary Lock) — the
 * min-height is what keeps it droppable rather than a zero-height strip. */
export function BoardColumn({
  status,
  count,
  isOver = false,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  status: TaskStatus;
  count: number;
  isOver?: boolean;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onDragOver={onDragOver}
      // dragleave also fires when the pointer crosses into a child element,
      // which would flicker the highlight off and on over every card. Only
      // clear when the pointer has actually left the column.
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDragLeave?.();
      }}
      onDrop={onDrop}
      className={`flex min-h-40 flex-col gap-2 rounded-lg border p-3 transition-colors duration-150 ${
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
