import { Icon } from "@/components/ui/icon";

/** The same three lines were written twenty times across the codebase — a
 * paragraph or span in --bad, at text-sm in form bodies and text-xs in the
 * dense row controls, with no icon and no announcement. The design pairs the
 * message with an `error` glyph; doing that twenty times by hand is how a
 * codebase ends up with nineteen of them.
 *
 * `role="alert"` is the point of the component as much as the icon is. These
 * strings appear *after* a submit fails, which means a screen-reader user
 * gets no notification at all unless the region announces itself — the error
 * simply materialises somewhere they are not looking.
 *
 * A <span>, not a <p>: several call sites render inside a <label> or a flex
 * row, and a <p> in a <label> breaks the implicit control association. Same
 * reasoning as field.tsx's Wrap.
 */
export function FormError({
  message,
  size = "sm",
  className,
}: {
  message: string;
  /** `xs` for the dense inline controls — status selects, progress, board
   * cards — where the surrounding text is already text-xs. */
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <span
      role="alert"
      className={`flex items-center gap-1.5 font-medium text-[var(--bad)] ${
        size === "xs" ? "text-xs" : "text-sm"
      }${className ? ` ${className}` : ""}`}
    >
      <Icon name="error" size="sm" className="flex-none" />
      {message}
    </span>
  );
}
