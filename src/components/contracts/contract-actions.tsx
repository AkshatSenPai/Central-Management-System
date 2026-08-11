"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  discardDraftAction,
  issueContractAction,
  voidContractAction,
} from "@/server/actions/contracts";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";

/** Issuing spends an agreement number and freezes the document, and neither
 * can be undone — a voided contract keeps its number rather than returning
 * it. So it is asked for, in the same spirit as the sequencing override that
 * "used to apply in silence, which is indistinguishable from the constraint
 * not existing".
 *
 * `blocked` is the validation state the detail page already computed and is
 * showing beside the preview. Passing it in rather than recomputing means the
 * button is disabled for exactly the reasons listed on screen. */
export function IssueControl({
  contractId,
  clientId,
  blocked,
}: {
  contractId: string;
  clientId: string;
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function run() {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("contractId", contractId);
    formData.set("clientId", clientId);
    try {
      const result = await issueContractAction(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="primary"
        size="sm"
        className="gap-1.5"
        disabled={blocked}
      >
        <Icon name="check_circle" size="sm" />
        Issue
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Issue this contract"
        icon="description"
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={run} variant="primary" disabled={pending}>
              {pending ? "Issuing…" : "Issue it"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-[var(--text-2)]">
          <p>
            This takes the next agreement number and freezes the document as it stands. From then
            on it is the record of what was sent: it cannot be edited, only voided and replaced.
          </p>
          <p className="text-[var(--text-3)]">
            A voided contract keeps its number — the register never reuses one — so issuing by
            mistake leaves a gap you have to explain rather than one you can undo.
          </p>
          {error ? <FormError message={error} /> : null}
        </div>
      </Modal>
    </>
  );
}

export function VoidControl({ contractId, clientId }: { contractId: string; clientId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function run() {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("contractId", contractId);
    formData.set("clientId", clientId);
    formData.set("reason", reason);
    try {
      const result = await voidContractAction(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
        <Icon name="close" size="sm" />
        Void
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Void this contract"
        icon="description"
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={run} variant="danger" disabled={pending}>
              {pending ? "Voiding…" : "Void it"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-2)]">
            The document and its number stay on file, marked void. Nothing is deleted — a register
            with holes in it cannot be audited.
          </p>
          <Field
            label="Why (optional)"
            className="w-full"
            value={reason}
            placeholder="Superseded by a revised scope"
            onChange={(e) => setReason(e.target.value)}
          />
          {error ? <FormError message={error} /> : null}
        </div>
      </Modal>
    </>
  );
}

/** A draft really is deleted — it has no number and was never sent, so there
 * is nothing to preserve. An issued contract is voided instead. */
export function DiscardControl({
  contractId,
  clientId,
  returnTo,
}: {
  contractId: string;
  clientId: string;
  returnTo: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  async function run() {
    setError(null);
    const formData = new FormData();
    formData.set("contractId", contractId);
    formData.set("clientId", clientId);
    try {
      const result = await discardDraftAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(returnTo);
    } catch {
      setError("Something went wrong — try again");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-3)]">Discard this draft?</span>
          <Button onClick={() => setConfirming(false)} size="sm">
            Keep
          </Button>
          <Button onClick={run} variant="danger" size="sm">
            Discard
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)} size="sm" className="gap-1.5">
          <Icon name="delete" size="sm" />
          Discard
        </Button>
      )}
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}

/** Prints the previewed document rather than the page around it.
 *
 * `iframe.contentWindow.print()` targets the frame, so what reaches the print
 * dialog is the contract's own A4 paged-media CSS with none of the app's
 * chrome — no sidebar, no header, no need for a print stylesheet on this
 * page at all. The frame is same-origin, so reaching into it is allowed.
 *
 * Falls back to opening the document in its own tab if the frame is not
 * reachable, which is also the honest answer for anyone who wants the file
 * itself rather than a printout. */
export function PrintButton({ frameId, href }: { frameId: string; href: string }) {
  function print() {
    const frame = document.getElementById(frameId);
    const win = frame instanceof HTMLIFrameElement ? frame.contentWindow : null;
    if (win) {
      win.focus();
      win.print();
      return;
    }
    window.open(href, "_blank", "noopener");
  }

  return (
    <Button onClick={print} variant="primary" size="sm" className="gap-1.5">
      <Icon name="print" size="sm" />
      Print / Save as PDF
    </Button>
  );
}
