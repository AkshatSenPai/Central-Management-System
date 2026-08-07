"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { NAV_ITEMS } from "@/components/shell/sidebar";

/** The phone-width replacement for the sidebar rail: a hamburger in the
 * topbar opening a left drawer with the same `NAV_ITEMS` — imported, not
 * copied, so the two navigations cannot drift apart.
 *
 * A scrim-plus-panel overlay, not a `<dialog>`. The Modal primitive is
 * reserved for content you commit to (a form with a Cancel and a Create);
 * this is a menu, and D6's boundary is that menus stay popovers. Escape and
 * scrim-click close it, matching the popover convention everywhere else.
 *
 * Closing on `pathname` change rather than in each link's onClick is what
 * makes the drawer close *after* a navigation actually happens — including
 * ones this component did not initiate. */
export function MobileNav({ myTaskCount, isAdmin }: { myTaskCount: number; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  // Close on navigation via the adjust-state-during-render pattern rather
  // than an effect — reacting to a prop change with setState in useEffect is
  // a wasted re-render and what react-hooks/set-state-in-effect flags.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <Button
        onClick={() => setOpen(true)}
        variant="ghost"
        size="none"
        aria-label="Open navigation"
        aria-expanded={open}
        className="h-9 w-9 justify-center rounded-lg text-[var(--text-2)] hover:bg-[var(--surface-3)]"
      >
        <Icon name="menu" />
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50">
          {/* The scrim is a real button so closing works for keyboard and
              assistive tech, not only for a pointer poking the dark area. */}
          <Button
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            variant="ghost"
            size="none"
            className="absolute inset-0 h-full w-full rounded-none bg-black/40 hover:bg-black/40"
          />

          <nav className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]">
            <div className="flex h-14 flex-none items-center gap-2.5 border-b border-[var(--border)] px-3.5">
              <span
                aria-hidden="true"
                className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-[var(--btn)] text-[13px] font-bold tracking-[-0.02em] text-[var(--on-btn)]"
              >
                M
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold leading-tight tracking-[-0.01em]">
                  Meridian
                </span>
                <span className="block text-[11px] leading-tight text-[var(--text-3)]">
                  Studio Ops
                </span>
              </span>
              <Button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                variant="ghost"
                size="none"
                className="p-1 text-[var(--text-3)] hover:bg-transparent hover:text-[var(--text)]"
              >
                <Icon name="close" />
              </Button>
            </div>

            <div className="flex flex-1 flex-col gap-px overflow-y-auto px-2 py-2.5">
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
                      // h-11, not the rail's h-[34px]: drawer rows are tap
                      // targets, and 44px is the floor a fingertip needs.
                      className={`flex h-11 items-center gap-[11px] rounded-lg px-[9px] text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)] ${
                        active
                          ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                          : "text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
                      }`}
                    >
                      <Icon name={item.icon} />
                      <span className="flex-1 whitespace-nowrap">{item.label}</span>
                      {item.href === "/my-tasks" && myTaskCount > 0 ? (
                        <span className="text-[11px] font-semibold text-[var(--text-3)]">
                          {myTaskCount}
                        </span>
                      ) : null}
                    </Link>
                  </div>
                );
              })}
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
