import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export type FieldSize = "xs" | "sm" | "md";

/** Deliberately NOT `w-full`. The per-file constants this replaces disagreed
 * about width — client-form's FIELD was `w-full`, project-filters' SELECT was
 * not — because width is a layout decision belonging to the call site. Baking
 * it in here would stretch every bare select in the project stat strip. Form
 * fields pass `className="w-full"`. */
const BASE =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] " +
  "transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)] " +
  "placeholder:text-[var(--text-3)] disabled:opacity-50";

/** Matches Button's three sizes. `xs` exists for the dense row controls —
 * task-status-control's select is `px-2 py-1 text-xs` inside a task row, and
 * inflating it to `sm` would visibly loosen every row on three screens. Text
 * size lives here rather than in BASE because xs is text-xs. */
const SIZE_CLASS: Record<FieldSize, string> = {
  xs: "px-2 py-1 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-3 py-2 text-sm",
};

const LABEL = "block text-sm text-[var(--text-2)]";
const ERROR = "mt-1 block text-xs text-[var(--bad)]";

export function fieldClass(opts: { size?: FieldSize; className?: string } = {}): string {
  const { size = "md", className } = opts;
  return `${BASE} ${SIZE_CLASS[size]}${className ? ` ${className}` : ""}`;
}

/** The label pairing owns the top margin, not the control — that is why the
 * old per-file FIELD constants carried `mt-1` while the bare selects did
 * not. A labelled field spaces itself; a bare one sits where it is put.
 *
 * Everything inside is a <span>, because this wrapper is a <label> and a
 * <label> may not contain block elements like <p> or <div> without breaking
 * its implicit association with the control. */
function Wrap({
  label,
  error,
  children,
}: {
  label?: string;
  error?: string | null;
  children: ReactNode;
}) {
  if (!label && !error) return <>{children}</>;
  return (
    <label className={label ? LABEL : undefined}>
      {label}
      <span className={label ? "mt-1 block" : "block"}>{children}</span>
      {error ? <span className={ERROR}>{error}</span> : null}
    </label>
  );
}

/** `size` is omitted from the native attributes on purpose: <input> and
 * <select> both declare `size?: number` in the DOM, so intersecting that with
 * a string union collapses the prop to never and every call site fails with
 * "Type 'string' is not assignable to type 'undefined'". The native attribute
 * is a character-width hint nothing in this codebase uses. */
export function Field({
  label,
  error,
  size,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: string;
  error?: string | null;
  size?: FieldSize;
}) {
  return (
    <Wrap label={label} error={error}>
      <input className={fieldClass({ size, className })} {...props} />
    </Wrap>
  );
}

export function SelectField({
  label,
  error,
  size,
  className,
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  label?: string;
  error?: string | null;
  size?: FieldSize;
}) {
  return (
    <Wrap label={label} error={error}>
      <select className={fieldClass({ size, className })} {...props}>
        {children}
      </select>
    </Wrap>
  );
}

export function TextareaField({
  label,
  error,
  size,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string | null;
  size?: FieldSize;
}) {
  return (
    <Wrap label={label} error={error}>
      <textarea className={fieldClass({ size, className })} {...props} />
    </Wrap>
  );
}
