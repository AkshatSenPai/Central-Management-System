"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/lib/icons";

/** Settings sits below a rule in the design — it configures the app rather
 * than being a place inside it — so it carries `ruleAbove` instead of being
 * a second array nobody would remember to keep in order. */
export const NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  icon: IconName;
  ruleAbove?: boolean;
}> = [
  { href: "/dashboard", label: "Dashboard", icon: "space_dashboard" },
  { href: "/my-tasks", label: "My Tasks", icon: "check_circle" },
  { href: "/clients", label: "Clients", icon: "business_center" },
  { href: "/projects", label: "Projects", icon: "layers" },
  { href: "/calendar", label: "Calendar", icon: "calendar_month" },
  { href: "/team", label: "Team", icon: "groups" },
  { href: "/vault", label: "Vault", icon: "lock" },
  { href: "/announcements", label: "Announcements", icon: "campaign" },
  { href: "/invoices", label: "Invoices", icon: "receipt_long" },
  { href: "/settings", label: "Settings", icon: "settings", ruleAbove: true },
];

const ROW =
  "flex h-[34px] items-center gap-[11px] rounded-lg px-[9px] text-[13.5px] font-medium " +
  "transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)]";

export function Sidebar({ myTaskCount }: { myTaskCount: number }) {
  const pathname = usePathname();
  return (
    <aside
      style={{ viewTransitionName: "app-sidebar" }}
      className="flex w-[232px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]"
    >
      {/* Same 56px as the topbar, so the two bottom rules meet and the shell
          reads as one band across the top rather than two misaligned ones. */}
      <div className="flex h-14 flex-none items-center gap-2.5 border-b border-[var(--border)] px-3.5">
        <span
          aria-hidden="true"
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-[var(--btn)] text-[13px] font-bold tracking-[-0.02em] text-[var(--on-btn)]"
        >
          M
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-bold leading-tight tracking-[-0.01em]">
            Meridian
          </span>
          <span className="block text-[11px] leading-tight text-[var(--text-3)]">Studio Ops</span>
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-px overflow-y-auto px-2 py-2.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <div key={item.href} className="contents">
              {item.ruleAbove ? (
                <span aria-hidden="true" className="mx-[9px] my-[9px] h-px bg-[var(--border)]" />
              ) : null}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`${ROW} ${
                  active
                    ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                    : "text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
                }`}
              >
                <Icon name={item.icon} />
                <span className="flex-1 whitespace-nowrap">{item.label}</span>
                {/* Only My Tasks carries a count. It is the one route whose
                    contents are the reader's own backlog, so the number is
                    about them; a count on Clients or Projects would be a row
                    total nobody asked for. Hidden at zero — "0" reads as a
                    problem, an absent badge reads as nothing to do. */}
                {item.href === "/my-tasks" && myTaskCount > 0 ? (
                  <span className="text-[11px] font-semibold text-[var(--text-3)]">
                    {myTaskCount}
                  </span>
                ) : null}
              </Link>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
