import { useEffect, useId, useRef, useState } from "react";
import {
  emptyMessage,
  filterOptions,
  initialActiveIndex,
  labelForValue,
  type ComboboxOption,
} from "@/lib/combobox";
import { fieldClass, Wrap, type FieldSize } from "./field";
import { Icon } from "./icon";

export type { ComboboxOption };

/** A type-to-filter picker for entity lists the database sizes. Deliberately
 * NOT a replacement for SelectField, which stays on the fourteen fixed-enum
 * sites: the browser gives keyboard support, mobile behaviour and
 * accessibility away free on a native select, and a list of four statuses is
 * not worth re-implementing all three for.
 *
 * No "use client" directive, matching field.tsx. Both adopters are already
 * client entry points.
 *
 * The props are written out rather than spread from InputHTMLAttributes. That
 * is why field.tsx's Omit<..., "size"> workaround is absent here — nothing
 * native is intersected, so `size` never collapses to never. Spreading would
 * also let a caller pass `name` to the visible input and quietly defeat the
 * hidden-input contract below. */
export function Combobox({
  label,
  error,
  size,
  className,
  name,
  value,
  onChange,
  options,
  placeholder,
  required,
  disabled,
}: {
  label?: string;
  error?: string | null;
  size?: FieldSize;
  className?: string;
  /** The name of the HIDDEN input. The visible one is never named: the typed
   * text and the committed value are different strings, and only one of them
   * is the form's answer. A named visible input would submit whatever
   * half-word was in the box, and taskSchema would accept "Harlo" as a
   * projectId without complaint, because it validates shape and not
   * existence. */
  name: string;
  value: string;
  /** The id, not a change event. Every call site already unwrapped
   * e.target.value immediately, and there is no HTMLSelectElement behind this
   * control for a synthesised event to honestly describe. */
  onChange: (value: string) => void;
  /** Rendered in the order given, never re-sorted: the server already sorted
   * by name, and a picker whose rows move as you type is one you cannot aim
   * at. */
  options: ComboboxOption[];
  /** Shown when value is "" and "" is not itself an option. This is where
   * project-form's disabled sentinel lands: a prompt that can never be
   * chosen. */
  placeholder?: string;
  /** Goes on the VISIBLE input, which is focusable and can therefore show the
   * browser's validation bubble; a hidden input is barred from constraint
   * validation and would enforce nothing. */
  required?: boolean;
  /** Forwarded to the VISIBLE input only, never to the hidden one. A disabled
   * control is skipped when the form's entry list is built, so a disabled
   * hidden input would drop the field out of FormData entirely —
   * formData.get() would return null rather than "", and the zod parse would
   * fail on a field the user cannot even see. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** null means the user is not typing. The visible input's text is derived
   * as `query ?? labelForValue(options, value)` and never separately stored,
   * which is what makes the snap back to the selected label a property of not
   * typing rather than of the blur event — so it happens on every route out
   * of a typed state, including the three that fire no blur. */
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  /** Clearing the query whenever `value` changes is load-bearing twice: it
   * covers cancel() and the successful-create branch, neither of which bumps
   * `attempt`, and the modal never unmounts its children — so without this,
   * creating a task with a project and reopening New task would show a box
   * reading that project over a hidden input submitting "". It is also why
   * the restore after a commit reads the just-committed id rather than one
   * captured before it. */
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    setQuery(null);
    setActiveIndex(-1);
    setOpen(false);
  }

  const listRef = useRef<HTMLSpanElement>(null);
  const listId = useId();

  const matches = filterOptions(options, query ?? "");
  const text = query ?? labelForValue(options, value);

  /** "nearest" is the load-bearing word: it scrolls only ancestors that
   * actually need scrolling, so arrowing down scrolls the listbox and leaves
   * the modal body where the user put it. */
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function commit(option: ComboboxOption) {
    onChange(option.value);
    setQuery(null);
    setActiveIndex(-1);
    setOpen(false);
  }

  function close() {
    setQuery(null);
    setActiveIndex(-1);
    setOpen(false);
  }

  function openList() {
    setQuery(null);
    setActiveIndex(initialActiveIndex(options, value));
    setOpen(true);
  }

  return (
    <Wrap label={label} error={error}>
      <span className="relative block">
        <input
          type="text"
          role="combobox"
          autoComplete="off"
          className={fieldClass({ size, className })}
          value={text}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(filterOptions(options, e.target.value).length > 0 ? 0 : -1);
            setOpen(true);
          }}
          onClick={(e) => {
            // Opens only, never closes. A click inside an already-open box is
            // the user placing the caret in their own query, not asking to
            // dismiss the list — closing here would discard what they typed.
            // Blur, Escape, commit and outside-click all still close it.
            if (open) return;
            openList();
            e.currentTarget.select();
          }}
          onBlur={close}
        />

        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-3)]"
        >
          <Icon name="expand_more" />
        </span>

        {open ? (
          <span
            ref={listRef}
            id={listId}
            role="listbox"
            // Holds focus when the pointer lands on the popover's own
            // scrollbar, which would otherwise blur the input and close the
            // list mid-drag.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 top-full z-20 mt-1 block max-h-64 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-lg)]"
          >
            {matches.length === 0 ? (
              <span
                role="option"
                aria-disabled="true"
                aria-selected="false"
                className="block px-3 py-1.5 text-sm text-[var(--text-3)]"
              >
                {emptyMessage(query ?? "", options.length > 0)}
              </span>
            ) : (
              matches.map((option, index) => (
                <span
                  key={option.value}
                  data-index={index}
                  role="option"
                  aria-selected={option.value === value}
                  onMouseDown={(e) => {
                    // mousedown, not click: it stops the input blurring
                    // between the press and the pick, which would fire the
                    // derived restore first and discard the selection.
                    e.preventDefault();
                    commit(option);
                  }}
                  onClick={(e) => {
                    // The enclosing <label> forwards a synthetic click to the
                    // visible input, whose handler toggles the list — so a
                    // mouse pick would commit, close, and instantly reopen.
                    // Label forwarding dispatches from click, not mousedown,
                    // so cancelling the mousedown default does not stop it.
                    e.preventDefault();
                  }}
                  // surface-3 and the hover pairing both match the menu rows
                  // in account-menu.tsx:25, so a listbox row and a menu row
                  // highlight identically. Hover is separate from activeIndex
                  // on purpose: pointing at a row is not the same as arrowing
                  // onto it, and only the latter is what Enter commits.
                  className={`block cursor-pointer px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)] ${
                    index === activeIndex
                      ? "bg-[var(--surface-3)] text-[var(--text)]"
                      : "text-[var(--text-2)]"
                  }`}
                >
                  {option.label}
                </span>
              ))
            )}
          </span>
        ) : null}
      </span>

      <input type="hidden" name={name} value={value} />
    </Wrap>
  );
}
