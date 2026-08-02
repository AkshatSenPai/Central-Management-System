"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/lib/icons";

/** The app's one overlay primitive, and a deliberate reversal of spec D6
 * ("no modal or drawer primitive"), inherited from Phase 3a's "no overlay
 * primitive". The design that D6 predates contains two modals — New task and
 * New project — so the decision and the design could not both stand. The
 * owner ruled for the design on 2026-08-02. See the spec for the full note.
 *
 * The reversal is narrow on purpose. A modal is for content you *commit to*:
 * a form with a Cancel and a Create. Menus, popovers and pickers stay
 * popovers — <QuickAdd> and <AccountMenu> are not dialogs and must not
 * become dialogs, or D6 will have been reversed into nothing.
 *
 * Built on native <dialog> + showModal(), which is what makes the behaviour
 * a browser guarantee rather than a hand-rolled approximation: top layer (so
 * no z-index arithmetic against the topbar's z-30), inert background, focus
 * trapped inside, initial focus placed, focus restored to the trigger on
 * close, and Escape handled. Every one of those is a thing a div-based modal
 * gets subtly wrong.
 */
export function Modal({
  open,
  onClose,
  title,
  icon,
  meta,
  width = 648,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Echoes the entity being created, the way the design's headers do —
   * check_circle for a task, layers for a project. */
  icon: IconName;
  /** A quiet identifier beside the title — the task's MER-024. Right-aligned
   * and muted in the design, because it is for citing, not for reading. */
  meta?: ReactNode;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // showModal() throws if the dialog is already open, and close() on an
    // already-closed dialog fires a spurious `close` event that would call
    // onClose again — hence both guards.
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() focuses the first focusable descendant, which is the
      // close button in the header — so opening the dialog and pressing
      // Enter dismisses it instead of submitting. Move focus to the first
      // real field when there is one; a dialog with no fields keeps the
      // browser's choice.
      dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      data-modal
      aria-labelledby="modal-title"
      // The browser's own Escape handling closes the dialog without telling
      // React, which would leave `open` true and the modal unable to reopen.
      // Listening for `close` is what keeps the two in step, whoever closed
      // it — Escape, the close button, or the form succeeding.
      onClose={onClose}
      // With showModal(), a click on the ::backdrop reports the dialog
      // itself as the target. That only holds while the dialog box has no
      // padding of its own, which is why the padding lives on the panel
      // below and `p-0` here is load-bearing, not cosmetic.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      style={{ maxWidth: width }}
      className="mx-auto mb-5 mt-14 w-full bg-transparent p-0 text-[var(--text)] backdrop:bg-transparent"
    >
      <div className="flex max-h-[calc(100vh-76px)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]">
        <div className="flex flex-none items-center gap-2.5 border-b border-[var(--border)] px-4 py-3">
          <Icon name={icon} size="sm" className="text-[var(--text-3)]" />
          <h2
            id="modal-title"
            className="flex-1 text-[14.5px] font-bold tracking-[-0.01em] text-[var(--text)]"
          >
            {title}
          </h2>
          {meta ? <span className="mono text-[11px] text-[var(--text-3)]">{meta}</span> : null}
          <Button
            onClick={onClose}
            aria-label="Close"
            variant="ghost"
            size="none"
            className="p-0 text-[var(--text-3)] hover:bg-transparent hover:text-[var(--text)]"
          >
            <Icon name="close" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        {footer ? (
          <div className="flex flex-none items-center gap-2.5 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
