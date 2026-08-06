"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { fieldClass, fieldErrorClass, fieldLabelClass, type FieldSize } from "@/components/ui/field";

/** A password input with a show/hide toggle.
 *
 * **Why its own file rather than another export from `field.tsx`.** The
 * toggle needs `useState`, which makes this a client component — and
 * `"use client"` applies to a whole module. Adding it to `field.tsx` would
 * drag `Field`, `SelectField` and `TextareaField` across the boundary too,
 * for no benefit and a larger client bundle on every page that renders a
 * form. It still lives under `src/components/ui/`, which is what keeps the
 * raw `<input>` inside gate 3's exemption.
 *
 * **Why it does not use `Wrap`.** `Wrap` renders a `<label>` around its
 * children, and HTML forbids a `<label>` containing interactive content
 * other than the control it labels. A `<button>` in there is invalid, and in
 * practice clicking it would also fire the label's own focus behaviour. So
 * the label is associated by `htmlFor`/`id` instead, with the button outside
 * it — and the label and error styling is imported from `field.tsx` rather
 * than copied, so a password field cannot drift away from every other field.
 *
 * **The toggle is deliberately not persisted.** It resets to hidden on every
 * mount. A remembered "show password" preference is a shoulder-surfing
 * hazard that outlives the moment it was useful for, and the moment it is
 * useful for is short: checking a typo while you type it.
 *
 * `type="button"` on the toggle is load-bearing — the default is `submit`,
 * so without it, revealing your password would submit the login form.
 */
export function PasswordField({
  label,
  error,
  size,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> & {
  label?: string;
  error?: string | null;
  size?: FieldSize;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span className="block">
      {label ? (
        <label htmlFor={id} className={fieldLabelClass}>
          {label}
        </label>
      ) : null}
      <span className={label ? "relative mt-1 block" : "relative block"}>
        <input
          id={id}
          type={visible ? "text" : "password"}
          // `pr-10` reserves room for the toggle so a long password does not
          // run underneath it.
          className={fieldClass({ size, className: className ? `pr-10 ${className}` : "pr-10" })}
          {...props}
        />
        <Button
          type="button"
          variant="ghost"
          size="none"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          // The icon is the only content, so the accessible name has to come
          // from aria-label — <Icon> is always aria-hidden by design.
          className="absolute inset-y-0 right-0 px-2.5 text-[var(--text-3)] hover:bg-transparent hover:text-[var(--text-2)]"
        >
          <Icon name={visible ? "visibility_off" : "visibility"} size="sm" />
        </Button>
      </span>
      {error ? <span className={fieldErrorClass}>{error}</span> : null}
    </span>
  );
}
