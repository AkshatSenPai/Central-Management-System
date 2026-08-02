"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

/** The design collapses three loose topbar controls — a theme button, a bare
 * avatar and a sign-out button — into one account menu.
 *
 * A popover, not a modal: it is a menu, it dismisses on outside click and
 * Escape, and it must not trap focus or lock scroll. The modal primitive next
 * door is for content you commit to; this is content you glance at. That
 * distinction is what keeps the D6 reversal from turning every overlay in the
 * app into a dialog.
 *
 * Dismissal is the same listener pair as <QuickAdd>. Duplicated rather than
 * abstracted at two call sites: a shared hook earns its place at three, and
 * extracting one now would mean editing quick-add's tested behaviour to save
 * nine lines. */
const ROW =
  "flex w-full items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-[13px] " +
  "text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)] " +
  "focus-visible:outline-none focus-visible:shadow-[var(--ring)]";

/** True only after hydration.
 *
 * next-themes cannot know the resolved theme until it has read the DOM on the
 * client, so `resolvedTheme` is undefined on the server and for the first
 * client render. Without a guard the theme row paints a light-mode icon and
 * the word "Light" for one frame in a dark UI, and the two renders disagree.
 *
 * useSyncExternalStore rather than the usual `useState(false)` +
 * `useEffect(() => setMounted(true))`: the store's server snapshot is false
 * and its client snapshot is true, which is exactly the question being asked,
 * and it avoids the cascading render that `react-hooks/set-state-in-effect`
 * correctly objects to. The subscriber never fires — hydration happens once. */
const noopSubscribe = () => () => {};
function useHasHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

export function AccountMenu({
  userName,
  userEmail,
  initials,
  signOutAction,
}: {
  userName: string;
  userEmail: string;
  initials: string;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme, setTheme } = useTheme();

  const mounted = useHasHydrated();
  const isDark = resolvedTheme === "dark";

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
        aria-label="Account"
        aria-expanded={open}
        aria-haspopup="menu"
        size="none"
        className="h-8 gap-1.5 rounded-lg border border-[var(--border)] pl-[3px] pr-1.5 hover:bg-[var(--surface-2)]"
      >
        <InitialsAvatar initials={initials} shape="circle" size={24} />
        <Icon name="expand_more" size="sm" className="text-[var(--text-3)]" />
      </Button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[244px] rounded-[11px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-lg)]">
          <div className="flex items-center gap-2.5 px-[9px] pb-2.5 pt-2">
            <InitialsAvatar initials={initials} shape="circle" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-[var(--text)]">
                {userName}
              </span>
              <span className="block truncate text-[11.5px] text-[var(--text-3)]">{userEmail}</span>
            </span>
          </div>

          <span aria-hidden="true" className="mb-1.5 mt-0.5 block h-px bg-[var(--border)]" />

          {/* Rendered only once mounted, so the label never claims the wrong
              theme. The gap it leaves for one frame is invisible next to a
              row that says "Light" in a dark UI. */}
          {mounted ? (
            <Button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              role="switch"
              aria-checked={isDark}
              size="none"
              className={`${ROW} justify-between`}
            >
              <span className="flex items-center gap-[9px]">
                <Icon name={isDark ? "dark_mode" : "light_mode"} size="sm" />
                {isDark ? "Dark" : "Light"}
              </span>
              <span
                aria-hidden="true"
                className={`flex h-[22px] w-[38px] flex-none rounded-full border border-[var(--border-2)] bg-[var(--surface-3)] p-0.5 ${
                  isDark ? "justify-end" : "justify-start"
                }`}
              >
                <span className="block h-4 w-4 rounded-full bg-[var(--btn)] transition-all duration-150" />
              </span>
            </Button>
          ) : null}

          <Link href="/settings/profile" onClick={() => setOpen(false)} className={ROW}>
            <Icon name="person" size="sm" />
            Profile &amp; settings
          </Link>

          <form action={signOutAction}>
            <Button type="submit" size="none" className={ROW}>
              <Icon name="logout" size="sm" />
              Sign out
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
