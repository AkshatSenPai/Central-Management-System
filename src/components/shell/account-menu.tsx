"use client";

import { useEffect, useRef, useState } from "react";
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

/** One row per theme. Both are always rendered; the `when-light` /
 * `when-dark` classes in globals.css put only the current one in the
 * document.
 *
 * Nothing here reads the theme during render, and that is the point. This
 * component sits in the layout, so it mounts on every screen; a hydration
 * guard here re-renders the whole app the moment hydration finishes, and gets
 * the label wrong for one frame before it does. next-themes has already
 * written data-theme onto <html> before first paint, so CSS can answer the
 * question and React never has to.
 *
 * `aria-checked` is a literal and still correct: the hidden row is
 * `display: none`, so it is absent from the accessibility tree entirely. */
function ThemeRow({ current, onSwitch }: { current: "light" | "dark"; onSwitch: () => void }) {
  const isDark = current === "dark";
  return (
    <Button
      onClick={onSwitch}
      role="switch"
      aria-checked={isDark}
      aria-label="Dark theme"
      size="none"
      className={`${ROW} justify-between ${isDark ? "when-dark" : "when-light"}`}
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
        <span className="block h-4 w-4 rounded-full bg-[var(--btn)]" />
      </span>
    </Button>
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
  // setTheme only — `resolvedTheme` is deliberately not read. See ThemeRow.
  const { setTheme } = useTheme();

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

          <ThemeRow current="light" onSwitch={() => setTheme("dark")} />
          <ThemeRow current="dark" onSwitch={() => setTheme("light")} />

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
