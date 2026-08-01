import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export type FieldSize = "sm" | "md";

const BASE =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] " +
  "transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)] " +
  "placeholder:text-[var(--text-3)] disabled:opacity-50";

const SIZE_CLASS: Record<FieldSize, string> = {
  sm: "px-3 py-1.5",
  md: "px-3 py-2",
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

export function Field({
  label,
  error,
  size,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
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
}: SelectHTMLAttributes<HTMLSelectElement> & {
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
