"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useStoredValue } from "@/components/use-stored-value";
import { pushGateState, type PushGate } from "@/lib/push-gate";

const STORAGE_KEY = "push-explainer-dismissed";

/** What each state is told. `granted` and `unsupported` are absent because they
 * render nothing at all.
 *
 * The copy names exactly what push does — assignment and @mentions — because
 * that is its truthful scope. Overstating it is how somebody concludes the
 * feature is broken when a status change does not buzz their phone. */
const COPY: Record<
  "unasked" | "denied" | "needs-install",
  { text: string; cta: string | null }
> = {
  unasked: {
    text: "Get notified when you're assigned a task or @mentioned — even when the app is closed.",
    cta: "Turn on notifications",
  },
  denied: {
    // No call to action, deliberately. Permission cannot be re-requested from
    // JavaScript once denied, so any button here could only ever fail.
    text: "Notifications are blocked for this site. Allow them in your browser settings, then reload.",
    cta: null,
  },
  "needs-install": {
    text: "On iPhone, notifications work only from the installed app. Tap Share, then Add to Home Screen, and open it from that icon.",
    cta: null,
  },
};

const noSubscribe = () => () => {};

/** A dismissible bar telling somebody push exists.
 *
 * **It never calls `requestPermission()`.** `push-control.tsx` records why at
 * length: `denied` cannot be undone from JavaScript, so a drive-by prompt is
 * the cheapest way to make push permanently unavailable to that person. This
 * bar's whole job is to send them to the toggle, not to be the toggle. */
export function PushExplainer() {
  // Same shape as useStoredValue's readiness: false on the server and the
  // first client render, so the gate is only read once the browser exists.
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );
  const { value, store, ready } = useStoredValue(STORAGE_KEY);

  if (!hydrated || !ready) return null;
  if (value !== null) return null;

  const gate: PushGate = pushGateState();
  if (gate === "granted" || gate === "unsupported") return null;

  const copy = COPY[gate];

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
      <Icon name="notifications" size="sm" />
      <p className="min-w-0 flex-1 text-sm text-[var(--text-2)]">{copy.text}</p>
      <div className="flex flex-none items-center gap-2">
        {/* A Link wearing the button's classes, never a Link inside a Button:
            that nests interactive elements and is invalid HTML. buttonClass is
            exported for exactly this — see its note in button.tsx. */}
        {copy.cta ? (
          <Link href="/settings" className={buttonClass({ variant: "primary", size: "xs" })}>
            {copy.cta}
          </Link>
        ) : null}
        <Button variant="ghost" size="xs" onClick={() => store("1")} aria-label="Dismiss">
          <Icon name="close" size="sm" />
        </Button>
      </div>
    </div>
  );
}
