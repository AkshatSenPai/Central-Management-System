import type {
  ComponentPropsWithRef,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { buttonClass } from "@/components/ui/button";

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
export function Wrap({
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

/** A file picker that looks like a button.
 *
 * **Why this is a primitive rather than a gate-3 exemption.** Gate 3 forbids
 * a raw `<input>` outside this directory, and a file input is a raw input;
 * the attachment upload control needed one. `checkbox.tsx` already answers
 * the same question for the same reason — "one small component is cheaper
 * than three standing exemptions in gate 3" — and the argument is stronger
 * here, not weaker: a native file input is the *one* control browsers render
 * with their own unstyleable chrome, so leaving it raw would put a
 * grey-on-white OS button, with its own font and its own "No file chosen",
 * on three pages of an app whose entire design system exists to stop exactly
 * that. An exemption would have bought a control that ignores both themes.
 *
 * **How it works.** The input is `sr-only` rather than `hidden` — hidden
 * would remove it from the tab order and break keyboard access entirely,
 * while `sr-only` leaves it focusable and operable and merely invisible. The
 * `<label>` wrapping it is what the user sees and clicks: a click anywhere
 * on the label opens the picker, which is native label-for-control behaviour
 * and needs no JavaScript.
 *
 * Because the visible element is the label but the focusable element is the
 * input inside it, the ring has to be drawn by the parent on the child's
 * behalf — hence `has-[:focus-visible]:` rather than the plain
 * `focus-visible:` in `buttonClass`'s own base, which would only ever fire
 * on a label that cannot receive focus. `has-[:disabled]:` covers the other
 * half for the same reason. Both are `:has()` selectors, so the styling
 * follows the input's real state rather than a prop this component would
 * otherwise have to be told twice.
 *
 * `type` is fixed and cannot be overridden — a `FileField` that is not a
 * file input would pass gate 3 while defeating the reason it exists. */
/** Its own constant, and every class in it followed by whitespace or the
 * closing quote — never by a `${`. Tailwind v4 finds classes by scanning
 * source text for candidates, and a candidate written flush against an
 * interpolation is not recognised: the first draft of this component ended
 * `… has-[:disabled]:opacity-50${className ? …}`, and that one utility — the
 * only one in the string touching a `${` — was silently absent from the
 * built CSS while every other class on the same line compiled. Nothing fails;
 * the control just renders at full opacity while disabled. `scripts/
 * gates.mjs` carries a warning of the same family for the same reason. */
const FILE_FIELD =
  "cursor-pointer gap-1.5 has-[:focus-visible]:shadow-[var(--ring)] " +
  "has-[:disabled]:cursor-default has-[:disabled]:opacity-50";

export function FileField({
  className,
  children,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> & { children: ReactNode }) {
  return (
    <label className={buttonClass({ className: className ? `${FILE_FIELD} ${className}` : FILE_FIELD })}>
      {children}
      <input type="file" className="sr-only" {...props} />
    </label>
  );
}

/** `ComponentPropsWithRef` rather than `TextareaHTMLAttributes`, so callers can
 * pass a `ref`. React 19 hands `ref` to function components as an ordinary
 * prop, so the existing `{...props}` spread already forwards it to the
 * <textarea> — only the type needed widening. The comment composer wants one
 * to insert an "@" at the cursor. */
export function TextareaField({
  label,
  error,
  size,
  className,
  ...props
}: ComponentPropsWithRef<"textarea"> & {
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
