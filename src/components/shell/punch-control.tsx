"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { punchInAction, punchOutAction } from "@/server/actions/attendance";

/** Complete class strings in a lookup rather than interpolated fragments:
 * Tailwind v4 finds classes by scanning source text, so a literal written
 * flush against a `${` is silently dropped from the production build. */
const DOT = {
  on: "h-2 w-2 flex-none rounded-full bg-[var(--ok)]",
  off: "h-2 w-2 flex-none rounded-full bg-[var(--text-3)]",
} as const;

/** Punch in and out. Presence only — no elapsed counter, no hours, no totals
 * (owner ruling, 2026-08-07: attendance says who is here, not for how long).
 *
 * That is why this component has no timer, no `serverNow` prop and no
 * clock-skew correction: with nothing to display there is nothing to keep in
 * step with the server's clock.
 *
 * Lives in the topbar so it is one tap from any page, including on a phone. */
export function PunchControl({ isPunchedIn }: { isPunchedIn: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Invoked as a `<form action>`, never from an onClick.
   *
   * Per the bundled Mutating Data guide, a Server Action is wrapped in
   * `startTransition` — and it is that transition which applies the
   * revalidated UI in the same roundtrip — only when it is passed to a form's
   * `action` or a button's `formAction`. Awaiting it from a plain click
   * handler writes correctly and then leaves the button showing the old state
   * until the next navigation. That bug shipped once here; this shape is the
   * fix. */
  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const result = await (isPunchedIn ? punchOutAction() : punchInAction());
      // A refused punch-in means "you already are" — this tab is simply behind
      // the server. Revalidation re-renders the button, so there is nothing to
      // shout about.
      if (!result.ok) setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={toggle} className="flex-none">
      <Button
        type="submit"
        disabled={pending}
        aria-label={isPunchedIn ? "Punch out — you are Active" : "Punch in — you are Offline"}
        size="none"
        className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] sm:px-2.5"
      >
        <span aria-hidden="true" className={isPunchedIn ? DOT.on : DOT.off} />
        <Icon name="schedule" size="sm" />
        {/* Label on desktop; on a phone the dot alone carries the state and
            the aria-label keeps the name. */}
        <span className="hidden text-[12.5px] font-semibold sm:inline">
          {pending ? "…" : isPunchedIn ? "Punch out" : "Punch in"}
        </span>
      </Button>
      {error ? <FormError message={error} size="xs" /> : null}
    </form>
  );
}
