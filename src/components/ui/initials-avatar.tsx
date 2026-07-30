const SHAPE_CLASS = {
  square:
    "flex flex-none items-center justify-center rounded-lg bg-[var(--surface-3)] text-[11px] font-bold text-[var(--text-2)]",
  circle:
    "flex flex-none items-center justify-center rounded-full bg-[var(--avatar)] text-[11px] font-bold text-[var(--avatar-t)]",
} as const;

/** Square for organisations, circle for people. Decorative — the name it
 * abbreviates is always rendered next to it. */
export function InitialsAvatar({
  initials,
  shape,
  size = 32,
}: {
  initials: string;
  shape: "square" | "circle";
  size?: number;
}) {
  return (
    <span className={SHAPE_CLASS[shape]} style={{ width: size, height: size }} aria-hidden="true">
      {initials}
    </span>
  );
}
