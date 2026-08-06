"use client";

import { QuickAdd } from "@/components/tasks/quick-add";
import { AccountMenu } from "@/components/shell/account-menu";
import { NotificationBell } from "@/components/shell/notification-bell";
import { SearchBox } from "@/components/shell/search-box";
import type { NotificationRow } from "@/lib/notification-queries";

/** `z-30` and `relative` because the popovers escape this header; without a
 * stacking context of its own the page content below can paint over them.
 * Matches the design's own z-30 on the header.
 *
 * Both the search box and the bell were removed earlier for advertising
 * features that did not exist. Both are back, attached to real ones. */
export function Topbar({
  userName,
  userEmail,
  signOutAction,
  members,
  projects,
  notifications,
  unreadCount,
}: {
  userName: string;
  userEmail: string;
  signOutAction: () => Promise<void>;
  members: { id: string; name: string }[];
  /** Quick Add's project picker. Same `{ id, name, clientId }` shape
   * `<TaskForm>` uses, so both pickers read the same rows and `clientId` is
   * available for the action's client-page revalidation. */
  projects: { id: string; name: string; clientId: string }[];
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
      className="relative z-30 flex h-14 flex-none items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface)] px-5"
    >
      <SearchBox />
      <QuickAdd members={members} projects={projects} />
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
