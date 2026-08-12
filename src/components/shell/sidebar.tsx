"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/lib/icons";

/** Settings sits below a rule in the design — it configures the app rather
 * than being a place inside it — so it carries `ruleAbove` instead of being
 * a second array nobody would remember to keep in order.
 *
 * `adminOnly` hides a row from members. It is presentation only: /all-tasks
 * guards itself server-side, because a nav that omits a link is not access
 * control — anyone can type the URL. */
export const NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  icon: IconName;
  ruleAbove?: boolean;
  adminOnly?: boolean;
}> = [
  { href: "/dashboard", label: "Dashboard", icon: "space_dashboard" },
  { href: "/my-tasks", label: "My Tasks", icon: "check_circle" },
  { href: "/all-tasks", label: "All Tasks", icon: "checklist", adminOnly: true },
  { href: "/clients", label: "Clients", icon: "business_center" },
  { href: "/projects", label: "Projects", icon: "layers" },
  { href: "/calendar", label: "Calendar", icon: "calendar_month" },
  { href: "/team", label: "Team", icon: "groups" },
  { href: "/vault", label: "Vault", icon: "lock" },
  { href: "/announcements", label: "Announcements", icon: "campaign" },
  { href: "/contracts", label: "Contracts", icon: "description" },
  { href: "/feedback", label: "Feedback", icon: "feedback" },
  { href: "/invoices", label: "Invoices", icon: "receipt_long" },
  { href: "/settings", label: "Settings", icon: "settings", ruleAbove: true },
];

const ROW =
  "flex h-[34px] items-center gap-[11px] rounded-lg px-[9px] text-[13.5px] font-medium " +
  "transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)]";

/** `collapsed` arrives from the layout, which read it from a cookie, so the
 * server renders the correct width on the very first frame. That is the whole
 * reason the preference is a cookie and not localStorage: localStorage cannot
 * be read during a server render, so the sidebar would paint expanded and
 * then snap narrow on every single page load.
 *
 * It also means the toggle works with JavaScript disabled — it is a form
 * posting to a Server Action, not an onClick. */
export function Sidebar({
  myTaskCount,
  isAdmin,
  collapsed,
  toggleAction,
}: {
  myTaskCount: number;
  isAdmin: boolean;
  collapsed: boolean;
  toggleAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside
      style={{ viewTransitionName: "app-sidebar" }}
      // `hidden md:flex`: below md the rail disappears entirely and the
      // topbar's <MobileNav> drawer takes over. Even the 60px collapsed rail
      // is 16% of a 375px phone, and its hover-tooltip affordance does not
      // exist under touch.
      className={`hidden shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-150 md:flex ${
        collapsed ? "w-[60px]" : "w-[232px]"
      }`}
    >
      {/* Same 56px as the topbar, so the two bottom rules meet and the shell
          reads as one band across the top rather than two misaligned ones. */}
      <div
        className={`flex h-14 flex-none items-center gap-2.5 border-b border-[var(--border)] ${
          collapsed ? "justify-center px-0" : "px-3.5"
        }`}
      >
        <span
          aria-hidden="true"
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-[var(--btn)] text-[13px] font-bold tracking-[-0.02em] text-[var(--on-btn)]"
        >
          M
        </span>
        {collapsed ? null : (
          <span className="min-w-0">
            <span className="block text-[13.5px] font-bold leading-tight tracking-[-0.01em]">
              Meridian
            </span>
            <span className="block text-[11px] leading-tight text-[var(--text-3)]">Studio Ops</span>
          </span>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-px overflow-y-auto px-2 py-2.5">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <div key={item.href} className="contents">
              {item.ruleAbove ? (
                <span aria-hidden="true" className="mx-[9px] my-[9px] h-px bg-[var(--border)]" />
              ) : null}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                // The label is the accessible name when it is rendered; when
                // collapsed there is no text, so the title carries it — and
                // doubles as the hover tooltip that makes a narrow rail
                // usable at all.
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`${ROW} ${collapsed ? "justify-center px-0" : ""} ${
                  active
                    ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                    : "text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
                }`}
              >
                <Icon name={item.icon} />
                {collapsed ? null : (
                  <>
                    <span className="flex-1 whitespace-nowrap">{item.label}</span>
                    {/* Only My Tasks carries a count. It is the one route
                        whose contents are the reader's own backlog, so the
                        number is about them. Hidden at zero — "0" reads as a
                        problem, an absent badge reads as nothing to do. */}
                    {item.href === "/my-tasks" && myTaskCount > 0 ? (
                      <span className="text-[11px] font-semibold text-[var(--text-3)]">
                        {myTaskCount}
                      </span>
                    ) : null}
                  </>
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="flex-none border-t border-[var(--border)] p-2">
        <form action={toggleAction}>
          <Button
            type="submit"
            variant="ghost"
            size="none"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`h-8 w-full gap-[11px] rounded-lg px-[9px] text-[12.5px] font-medium text-[var(--text-3)] hover:bg-[var(--surface-3)] hover:text-[var(--text-2)] ${
              collapsed ? "justify-center px-0" : ""
            }`}
          >
            <Icon name={collapsed ? "right_panel_open" : "left_panel_close"} />
            {collapsed ? null : <span className="whitespace-nowrap">Collapse</span>}
          </Button>
        </form>
      </div>
    </aside>
  );
}
