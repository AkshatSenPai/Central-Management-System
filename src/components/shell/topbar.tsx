"use client";

import { useTheme } from "next-themes";
import { QuickAdd } from "@/components/tasks/quick-add";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

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
    <header
      style={{ viewTransitionName: "app-topbar" }}
      className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4"
    >
      <Field
        size="sm"
        className="w-64 bg-[var(--surface-2)]"
        placeholder="Search (coming soon)"
        disabled
      />
      <div className="flex items-center gap-3">
        <QuickAdd members={members} />
        <Button onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          {resolvedTheme === "dark" ? "Light" : "Dark"}
        </Button>
        <span
          title={userName}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--avatar)] text-xs font-medium text-[var(--avatar-t)]"
        >
          {initials}
        </span>
        <form action={signOutAction}>
          <Button type="submit" variant="ghost">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
