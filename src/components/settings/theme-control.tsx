"use client";

import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const SEG =
  "h-7 gap-1.5 rounded-[7px] px-3 text-[12.5px] text-[var(--text-2)] " +
  "transition-colors hover:text-[var(--text)]";

/** The design's Appearance control, and the second copy of the theme toggle —
 * the account menu has the other. Both exist in the mockup, and they are for
 * different moments: one is a shortcut you reach for, this is the setting you
 * go looking for.
 *
 * Reads no theme state during render. `data-seg` marks which button is which
 * and globals.css decides from `data-theme` which of them looks selected, so
 * the control is correct on the first frame with no hydration guard. Same
 * reasoning as <AccountMenu>'s theme rows, and the same reason `setTheme` is
 * the only thing pulled off useTheme. */
export function ThemeControl() {
  const { setTheme } = useTheme();

  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--text)]">Theme</p>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-3)]">
          {/* Only one of these is in the document, so this line also tells a
              screen reader the current theme — which the buttons themselves
              deliberately do not claim, being actions rather than state. */}
          <span className="when-light">Currently light.</span>
          <span className="when-dark">Currently dark.</span> Also available from the account menu.
        </p>
      </div>
      <div className="flex flex-none gap-0.5 rounded-[9px] bg-[var(--surface-3)] p-0.5">
        <Button data-seg="light" size="none" className={SEG} onClick={() => setTheme("light")}>
          <Icon name="light_mode" size="sm" />
          Light
        </Button>
        <Button data-seg="dark" size="none" className={SEG} onClick={() => setTheme("dark")}>
          <Icon name="dark_mode" size="sm" />
          Dark
        </Button>
      </div>
    </div>
  );
}
