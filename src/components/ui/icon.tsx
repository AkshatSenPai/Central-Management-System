import type { IconName } from "@/lib/icons";

export type IconSize = "sm" | "md";

/** Two sizes, because the design has two tokens. The mockup also writes
 * one-off `13px`/`14px`/`15px`/`16px` icon fonts inline in a dozen places;
 * those are the inconsistency a primitive is supposed to absorb, not a
 * vocabulary to reproduce. Anything that genuinely needs a third size should
 * earn a third token in globals.css first. */
const SIZE_CLASS: Record<IconSize, string> = {
  sm: "ico-s",
  md: "ico",
};

/** A Material Symbols glyph.
 *
 * The name is the element's text content — the font substitutes a glyph for
 * the literal string `check_circle` through a ligature. Two consequences
 * worth knowing before changing this file:
 *
 * 1. **It is always `aria-hidden`.** Without that, every screen reader
 *    announces "check underscore circle". There is deliberately no `label`
 *    prop: when an icon is the only content of a control, the accessible
 *    name belongs on the control (`<Button aria-label="More actions">`), not
 *    on a decorative span inside it. One rule, no judgement call at the call
 *    site, nothing to get wrong.
 *
 * 2. **The glyph substitution is fragile.** An inherited `text-transform`,
 *    `letter-spacing` or word-break silently turns it back into visible
 *    text. The `.ico` classes in globals.css neutralise all of those; the
 *    styling is not decorative and should not be trimmed.
 *
 * Colour is not a prop. Icons inherit `currentColor` so they match whatever
 * text they sit beside, which is what the mockup does everywhere except a
 * handful of places that pass an explicit `text-[var(--text-3)]`. */
export function Icon({
  name,
  size = "md",
  className,
}: {
  name: IconName;
  size?: IconSize;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={`${SIZE_CLASS[size]}${className ? ` ${className}` : ""}`}>
      {name}
    </span>
  );
}
