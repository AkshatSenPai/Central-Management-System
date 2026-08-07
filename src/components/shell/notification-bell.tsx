"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { relativeTime } from "@/lib/dates";
import {
  describeNotification,
  notificationHref,
  notificationIcon,
  unreadBadge,
} from "@/lib/notifications";
import type { NotificationRow } from "@/lib/notification-queries";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/server/actions/notifications";

/** The design's bell, badge and dropdown.
 *
 * A popover, like <AccountMenu> and <QuickAdd> — not a dialog. Same dismissal
 * pair, same reasoning: this is content you glance at, and trapping focus to
 * read a list would be worse than not having the list.
 *
 * Both the count and the rows are props, resolved on the server in the
 * layout. Nothing here fetches, and nothing here reads client-only state
 * during render — the rule this codebase learned the hard way with the theme
 * toggle. The badge is therefore correct in the server-rendered HTML, with no
 * flash of an empty bell.
 */
export function NotificationBell({
  notifications,
  unreadCount,
}: {
  notifications: NotificationRow[];
  unreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const badge = unreadBadge(unreadCount);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        onClick={() => setOpen((o) => !o)}
        // The count is in the accessible name, not only in the badge — a
        // screen reader should not have to infer "3" from a decorative dot.
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications, none unread"
        }
        aria-expanded={open}
        aria-haspopup="menu"
        size="none"
        className="relative h-8 w-8 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      >
        <Icon name="notifications" size="sm" />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--bad)] px-0.5 text-[9.5px] font-bold leading-none text-[var(--on-btn)]"
          >
            {badge}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="fixed inset-x-3 top-16 z-40 overflow-hidden rounded-[11px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[376px]">
          {/* Below sm this panel pins to the viewport instead of the trigger:
              376px is wider than a phone, and right-aligning it to a bell that
              sits mid-topbar would push it off the left edge. Still a child of
              rootRef, so the click-outside close is untouched. */}
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold text-[var(--text)]">Notifications</span>
              {unreadCount > 0 ? (
                <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-px text-[11px] font-bold text-[var(--accent)]">
                  {unreadCount} new
                </span>
              ) : null}
            </div>
            {/* The action is wrapped rather than passed directly: it returns
                an ActionResult, per the project convention, and a form action
                must resolve to void. There is no error surface here — a failed
                mark-all leaves the badge as it was, which is honest. */}
            {unreadCount > 0 ? (
              <form
                action={async () => {
                  await markAllNotificationsReadAction();
                }}
              >
                <Button
                  type="submit"
                  variant="ghost"
                  size="none"
                  className="text-[12.5px] font-semibold text-[var(--accent)] hover:bg-transparent"
                >
                  Mark all read
                </Button>
              </form>
            ) : null}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-[12.5px] text-[var(--text-3)]">
                Nothing yet. You will hear about assignments and mentions here.
              </p>
            ) : (
              notifications.map((n) => (
                <Link
                  key={n.id}
                  href={notificationHref(n)}
                  onClick={() => {
                    setOpen(false);
                    // Fire and forget: the navigation is the point, and
                    // awaiting a write before moving would make every click
                    // feel slow. The action revalidates the layout, so the
                    // badge settles on arrival.
                    const fd = new FormData();
                    fd.set("notificationId", n.id);
                    void markNotificationReadAction(fd);
                  }}
                  className="flex gap-2.5 border-b border-[var(--border)] px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--surface-2)]"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-[var(--surface-3)] text-[var(--text-2)]"
                  >
                    <Icon name={notificationIcon(n.type)} size="sm" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] leading-[1.4] text-[var(--text)]">
                      {describeNotification(n)}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-[var(--text-3)]">
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                  {/* Read rows stay in the list — a notification centre that
                      empties itself on read is one nobody trusts to check —
                      so the dot is what distinguishes them. */}
                  {n.readAt === null ? (
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full bg-[var(--btn)]"
                    />
                  ) : null}
                </Link>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
