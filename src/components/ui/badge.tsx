import type { ReactNode } from "react";
import type { BadgeKind } from "@/lib/badges";

const BASE =
  "inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-bold";

const KIND_CLASS: Record<BadgeKind, string> = {
  ok: "border-[var(--ok-line)] bg-[var(--ok-bg)] text-[var(--ok)]",
  warn: "border-[var(--warn-line)] bg-[var(--warn-bg)] text-[var(--warn)]",
  bad: "border-[var(--bad-line)] bg-[var(--bad-bg)] text-[var(--bad)]",
  neutral: "border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-2)]",
  strong: "border-[var(--border-2)] bg-[var(--surface-3)] text-[var(--text)]",
};

const DOT_CLASS: Record<BadgeKind, string> = {
  ok: "bg-[var(--ok)]",
  warn: "bg-[var(--warn)]",
  bad: "bg-[var(--bad)]",
  neutral: "bg-[var(--text-3)]",
  strong: "bg-[var(--text)]",
};

export function Badge({
  kind,
  dot = false,
  children,
}: {
  kind: BadgeKind;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`${BASE} ${KIND_CLASS[kind]}`}>
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[kind]}`} /> : null}
      {children}
    </span>
  );
}
