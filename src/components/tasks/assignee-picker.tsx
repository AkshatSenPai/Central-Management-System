/** A plain checkbox list, meant to live inside <TaskForm>'s own <form> —
 * it renders no <form> of its own so the browser's native FormData on the
 * enclosing submit collects every checked `userId` via `getAll`. Checkboxes
 * are intentionally uncontrolled (`defaultChecked`): TaskForm listens for
 * bubbled change events and keeps the checked set in its own `values` state,
 * so a rejected submit's `key={attempt}` remount re-derives every checkbox's
 * initial state from that state instead of the original `selectedIds` prop.
 *
 * `active: false` renders identically to `active: true` — the vocabulary
 * lock has no string for "inactive", so this list never says it. */
import { Checkbox } from "@/components/ui/checkbox";

export function AssigneePicker({
  members,
  selectedIds,
}: {
  members: Array<{ id: string; name: string; active: boolean }>;
  selectedIds: string[];
}) {
  return (
    <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-[var(--border)] p-2">
      {members.map((m) => (
        <div
          key={m.id}
          className="rounded px-2 py-1 hover:bg-[var(--surface-2)]"
        >
          <Checkbox
            label={m.name}
            name="userId"
            value={m.id}
            defaultChecked={selectedIds.includes(m.id)}
          />
        </div>
      ))}
    </div>
  );
}
