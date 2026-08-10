import Link from "next/link";

/** Two links, never a second <form>. A GET form submits only its own fields,
 * so a sibling form would drop the status and sort parameters — the exact bug
 * task-status-filter.tsx documents at length. Links carry them through
 * explicitly, which is also what lets the Sequences view leave them untouched
 * in the URL and the List view find them again on the way back.
 *
 * Labelled with words rather than icons, the same call my-task-sort.tsx
 * records: no glyph here is in ICON_NAMES, and adding one means re-subsetting
 * the icon font for gates 7 and 8 to save two short words. */
export function MyTasksViewSwitch({
  view,
  status,
  sort,
}: {
  view: "list" | "sequences";
  status: string;
  sort: string;
}) {
  function href(target: "list" | "sequences") {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (sort) params.set("sort", sort);
    if (target === "sequences") params.set("view", "sequences");
    const query = params.toString();
    return query ? `/my-tasks?${query}` : "/my-tasks";
  }

  // Built as their own constants: Tailwind v4 finds classes by scanning source
  // text, and a literal written flush against a `${` is silently dropped.
  const base = "rounded-md px-3 py-1.5 text-sm transition-colors";
  const on = "bg-[var(--surface-3)] font-medium text-[var(--text)]";
  const off = "text-[var(--text-2)] hover:bg-[var(--surface-2)]";

  return (
    <nav className="flex items-center gap-1" aria-label="My Tasks view">
      <Link
        href={href("list")}
        aria-current={view === "list" ? "page" : undefined}
        className={`${base} ${view === "list" ? on : off}`}
      >
        List
      </Link>
      <Link
        href={href("sequences")}
        aria-current={view === "sequences" ? "page" : undefined}
        className={`${base} ${view === "sequences" ? on : off}`}
      >
        Sequences
      </Link>
    </nav>
  );
}
