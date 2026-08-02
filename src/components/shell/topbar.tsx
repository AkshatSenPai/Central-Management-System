"use client";

import { QuickAdd } from "@/components/tasks/quick-add";
import { AccountMenu } from "@/components/shell/account-menu";
import { NotificationBell } from "@/components/shell/notification-bell";
import type { NotificationRow } from "@/lib/notification-queries";

/** `z-30` and `relative` because the popovers escape this header; without a
 * stacking context of its own the page content below can paint over them.
 * Matches the design's own z-30 on the header.
 *
 * The design centres a search field here. It is deliberately absent: global
 * search is Phase 6, and what shipped in its place was a disabled input
 * reading "Search (coming soon)" on every screen in the app. A control that
 * cannot be used is worse than no control — it advertises a feature on every
 * page load and refuses it every time. It comes back when it works.
 *
 * The bell was absent for the same reason until Phase 4. It now rings. */
export function Topbar({
  userName,
  userEmail,
  signOutAction,
  members,
  notifications,
  unreadCount,
}: {
  userName: string;
  userEmail: string;
  signOutAction: () => Promise<void>;
  members: { id: string; name: string }[];
  notifications: NotificationRow[];
  unreadCount: number;
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
      className="relative z-30 flex h-14 flex-none items-center justify-end gap-1.5 border-b border-[var(--border)] bg-[var(--surface)] px-5"
    >
      <QuickAdd members={members} />
      <NotificationBell notifications={notifications} unreadCount={unreadCount} />
      <AccountMenu
        userName={userName}
        userEmail={userEmail}
        initials={initials}
        signOutAction={signOutAction}
      />
    </header>
  );
}
