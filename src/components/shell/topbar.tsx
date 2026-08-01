"use client";

import { useTheme } from "next-themes";
import { QuickAdd } from "@/components/tasks/quick-add";

export function Topbar({
  userName,
  signOutAction,
  members,
}: {
  userName: string;
  signOutAction: () => Promise<void>;
  members: { id: string; name: string }[];
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const initials = userName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4">
      <input
        placeholder="Search (coming soon)"
        disabled
        className="w-64 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-3)]"
      />
      <div className="flex items-center gap-3">
        <QuickAdd members={members} />
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="rounded-md border border-[var(--border)] px-2 py-1 text-sm text-[var(--text-2)] hover:bg-[var(--surface-3)]"
        >
          {resolvedTheme === "dark" ? "Light" : "Dark"}
        </button>
        <span
          title={userName}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--avatar)] text-xs font-medium text-[var(--avatar-t)]"
        >
          {initials}
        </span>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-sm text-[var(--text-2)] hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
