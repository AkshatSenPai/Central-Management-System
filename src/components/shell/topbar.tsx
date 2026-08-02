"use client";

import { QuickAdd } from "@/components/tasks/quick-add";
import { AccountMenu } from "@/components/shell/account-menu";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";

/** `z-30` and `relative` because the account menu and quick-add popover
 * escape this header; without a stacking context of its own the page content
 * below can paint over them. Matches the design's own z-30 on the header. */
export function Topbar({
  userName,
  userEmail,
  signOutAction,
  members,
}: {
  userName: string;
  userEmail: string;
  signOutAction: () => Promise<void>;
  members: { id: string; name: string }[];
}) {
  const initials = userName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header
      style={{ viewTransitionName: "app-topbar" }}
      className="relative z-30 flex h-14 flex-none items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5"
    >
      {/* Centred and capped at 400px, as in the design. The icon sits inside
          the <label> so clicking it still focuses the input; it is padding,
          not a control, hence pointer-events-none. */}
      <div className="flex flex-1 justify-center">
        <label className="relative flex w-full max-w-[400px] items-center">
          <Icon
            name="search"
            size="sm"
            className="pointer-events-none absolute left-2.5 text-[var(--text-3)]"
          />
          <Field
            size="sm"
            className="h-8 w-full bg-[var(--surface-2)] pl-[34px]"
            placeholder="Search (coming soon)"
            aria-label="Search"
            disabled
          />
        </label>
      </div>

      {/* The design's notification bell is deliberately absent: notifications
          are Phase 4, and a bell that never rings is worse than no bell. */}
      <div className="flex flex-none items-center gap-1.5">
        <QuickAdd members={members} />
        <AccountMenu
          userName={userName}
          userEmail={userEmail}
          initials={initials}
          signOutAction={signOutAction}
        />
      </div>
    </header>
  );
}
