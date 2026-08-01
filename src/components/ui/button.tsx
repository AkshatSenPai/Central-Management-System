import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "xs" | "sm" | "md";

/** Focus lives in the base, not per variant. `--ring` was defined in Phase 1
 * and consumed nowhere; declaring it once here is what closes the app's
 * keyboard-accessibility hole in one file instead of sixty.
 *
 * Text size belongs to SIZE_CLASS, not here, because `xs` is text-xs while
 * the other two are text-sm. */
const BASE =
  "inline-flex items-center justify-center rounded-md transition-colors " +
  "focus-visible:outline-none focus-visible:shadow-[var(--ring)] disabled:opacity-50";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-[var(--btn)] text-[var(--on-btn)] hover:bg-[var(--btn-h)]",
  secondary:
    "border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]",
  // The one shipped danger button hovers to --surface-2, so a red delete
  // control turns grey under the cursor — less alarming the closer you get to
  // pressing it. There is no darker red surface token to swap in, and
  // inventing one for a single button is not worth it, so the hover darkens
  // what is already there. Same perceptual effect, no new token, no hex.
  danger:
    "border border-[var(--bad-line)] bg-[var(--bad-bg)] text-[var(--bad)] hover:brightness-95",
  ghost: "text-[var(--text-2)] hover:bg-[var(--surface-2)]",
};

/** Three sizes, not two. The plan derived only sm and md, having counted
 * buttons but not the dense row controls: `px-2 py-1 text-xs` appears in
 * eight files — contact-list, invite-form, member-row-actions,
 * task-status-control, checklist, quick-add, assignee-picker, topbar — which
 * is more call sites than the danger and ghost variants combined. Folding
 * them into sm would have inflated every one of them, several inside table
 * rows whose density is the point, and no gate would have noticed. */
const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: "px-2 py-1 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

/** Exported apart from <Button> because several call sites are <Link>s that
 * look like buttons — the "Board" link on the project page, for one. Those
 * are navigations and must stay anchors, so they need the classes without
 * the element. */
export function buttonClass(
  opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}
): string {
  const { variant = "secondary", size = "sm", className } = opts;
  return `${BASE} ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]}${className ? ` ${className}` : ""}`;
}

export function Button({
  variant = "secondary",
  size = "sm",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}
