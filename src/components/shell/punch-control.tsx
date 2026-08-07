"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { formatDuration } from "@/lib/attendance";
import { toDateInputValue, toTimeInputValue } from "@/lib/dates";
import {
  punchInAction,
  punchOutAction,
  correctSessionAction,
  discardSessionAction,
} from "@/server/actions/attendance";

type PunchProps = {
  openSince: Date | null;
  unresolved: { id: string; startedAt: Date } | null;
  closedMs: number;
  /** The server's clock at render. See `skew` below — this is not decoration. */
  serverNow: Date;
};

/** Complete class strings in a lookup rather than interpolated fragments:
 * Tailwind v4 finds classes by scanning source text, so a literal written
 * flush against a `${` is silently dropped from the production build. */
const DOT = {
  on: "h-2 w-2 flex-none rounded-full bg-[var(--ok)]",
  off: "h-2 w-2 flex-none rounded-full bg-[var(--text-3)]",
} as const;

/** Punch in and out, and settle a session whose punch-out was forgotten.
 *
 * Lives in the topbar so it is one tap from any page, including on a phone —
 * forgetting is expected, and burying the control makes it likelier.
 *
 * The elapsed figure ticks on the client rather than being computed on the
 * server, because a server-rendered `now - startedAt` freezes into the RSC
 * payload and both /team and /dashboard are prefetched: the number would sit
 * visibly stale. The server sends `closedMs` (settled pairs) and `openSince`;
 * this adds the live portion.
 *
 * `skew` is why `serverNow` is a prop. Rendering `Date.now() - startedAt` raw
 * shows "-7m" on a laptop whose clock runs fast, because `startedAt` came from
 * the server's clock and `Date.now()` is the device's. Measuring the offset
 * once at mount and subtracting it keeps the two comparable. */
export function PunchControl({ openSince, unresolved, closedMs, serverNow }: PunchProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The instant the elapsed figure is measured against, seeded with the
  // server's own clock so the first client render produces byte-identical
  // markup to the server's and there is no hydration mismatch. Only the
  // interval moves it, which is also why there is no setState in an effect
  // body here.
  const [measuredAt, setMeasuredAt] = useState(() => serverNow.getTime());

  useEffect(() => {
    if (!openSince) return;
    // Skew, measured once: `startedAt` came from the server's clock and
    // `Date.now()` is the device's. Subtracting the offset is what stops a
    // laptop running seven minutes fast from rendering "-7m".
    const skew = Date.now() - serverNow.getTime();
    const id = window.setInterval(() => setMeasuredAt(Date.now() - skew), 15_000);
    return () => window.clearInterval(id);
  }, [openSince, serverNow]);

  // Derived during render rather than stored. Until the first tick this is
  // exactly the server's figure, which is correct rather than merely close:
  // any punch revalidates the layout, so a stale payload cannot survive a
  // state change.
  const liveMs = openSince ? Math.max(0, measuredAt - new Date(openSince).getTime()) : 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const isIn = openSince !== null;
  const total = closedMs + Math.max(0, liveMs);

  /** Every caller of this is a `<form action>`, never an onClick.
   *
   * That is not stylistic. Per the bundled Mutating Data guide, a Server
   * Action is wrapped in `startTransition` *automatically* only when it is
   * passed to a form's `action` or a button's `formAction` — and it is that
   * transition which applies the revalidated UI in the same roundtrip.
   * Awaiting the action from a bare click handler writes to the database
   * correctly and then leaves the button showing the old state until the next
   * navigation, which is exactly the bug this shape avoids. */
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    setError(null);
    try {
      const result = await fn();
      // A refused punch-in means "you already are" — the server state is
      // simply ahead of this tab. Revalidation re-renders the button, so
      // shouting about it would be shouting at the person for having two tabs.
      if (!result.ok && result.error) setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={rootRef} className="relative flex-none">
      <Button
        onClick={() => setOpen((o) => !o)}
        aria-label={isIn ? "Punched in — attendance" : "Punch in"}
        aria-expanded={open}
        aria-haspopup="menu"
        size="none"
        className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] sm:px-2.5"
      >
        <span aria-hidden="true" className={isIn ? DOT.on : DOT.off} />
        <Icon name="schedule" size="sm" />
        {/* The elapsed figure is the label on desktop; on a phone the dot
            carries the state and the number lives inside the popover. */}
        <span className="hidden text-[12.5px] font-semibold tabular-nums sm:inline">
          {formatDuration(total)}
        </span>
        {unresolved ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-[var(--warn)]"
          />
        ) : null}
      </Button>

      {open ? (
        <div className="fixed inset-x-3 top-16 z-40 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-lg)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[300px]">
          {error ? <FormError message={error} size="xs" className="mb-2" /> : null}

          {unresolved ? (
            <UnresolvedPrompt session={unresolved} pending={pending} run={run} />
          ) : (
            <>
              <p className="text-[12.5px] text-[var(--text-3)]">
                {isIn ? "Punched in since" : "On the clock today"}
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--text)]">
                {isIn && openSince ? toTimeInputValue(new Date(openSince)) : formatDuration(total)}
              </p>
              {isIn ? (
                <p className="mt-0.5 text-[12.5px] text-[var(--text-3)]">
                  {formatDuration(total)} today
                </p>
              ) : null}

              <form action={() => run(isIn ? punchOutAction : punchInAction)}>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={pending}
                  className="mt-3 w-full justify-center"
                >
                  {pending ? "Saving…" : isIn ? "Punch out" : "Punch in"}
                </Button>
              </form>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Shown instead of the punch button when a session was left open on an
 * earlier day. It blocks punching in on purpose: the person is asked what
 * actually happened before a new day is started on top of the old one. */
function UnresolvedPrompt({
  session,
  pending,
  run,
}: {
  session: { id: string; startedAt: Date };
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
}) {
  const startedAt = new Date(session.startedAt);
  // Defaults sit on the start's own day rather than today, because that is
  // where the real answer almost always is.
  const [date, setDate] = useState(() => toDateInputValue(startedAt));
  const [time, setTime] = useState("");

  function payload() {
    const data = new FormData();
    data.set("sessionId", session.id);
    data.set("date", date);
    data.set("time", time);
    return data;
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[12.5px] text-[var(--text)]">
        You were still punched in from {toDateInputValue(startedAt)} at{" "}
        {toTimeInputValue(startedAt)}.
      </p>
      <p className="text-[12.5px] text-[var(--text-3)]">
        When did you finish? Nothing is counted until you say.
      </p>

      {/* Two forms rather than one with a `formAction`, because they need
          different fields: the correction carries a date and time, the
          discard carries only the session. Both are forms so the Server
          Action gets its automatic transition — see `run`. */}
      <form action={() => run(() => correctSessionAction(payload()))} className="space-y-2.5">
        <div className="flex gap-2">
          <Field
            label="Date"
            type="date"
            size="sm"
            className="min-w-0 flex-1"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Field
            label="Time"
            type="time"
            size="sm"
            className="min-w-0 flex-1"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pending}
          className="w-full justify-center"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>

      {/* The honest escape hatch when nobody remembers. The session keeps its
          start time and counts zero — it is never given a guessed end. */}
      <form action={() => run(() => discardSessionAction(payload()))}>
        <Button type="submit" size="sm" disabled={pending} className="w-full justify-center">
          Don&rsquo;t count it
        </Button>
      </form>
    </div>
  );
}
