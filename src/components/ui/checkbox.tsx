import type { InputHTMLAttributes } from "react";

/** Only three call sites, which would not normally earn a component. It
 * earns one because it needs the same focus ring as everything else, and one
 * small component is cheaper than three standing exemptions in gate 3. */
export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const input = (
    <input
      type="checkbox"
      className={`h-4 w-4 rounded border-[var(--border)] focus-visible:outline-none focus-visible:shadow-[var(--ring)]${
        className ? ` ${className}` : ""
      }`}
      {...props}
    />
  );
  if (!label) return input;
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--text)]">
      {input}
      {label}
    </label>
  );
}
