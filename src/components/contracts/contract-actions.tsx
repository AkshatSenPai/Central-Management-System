"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  discardDraftAction,
  issueContractAction,
  voidContractAction,
} from "@/server/actions/contracts";
import { Button, buttonClass } from "@/components/ui/button";
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
 * `blockedReason` is the validation state the detail page already computed
 * and is showing beside the preview. Passing it in rather than recomputing
 * means the button is disabled for exactly the reasons listed on screen.
 *
 * It is a string rather than a boolean because a disabled control that does
 * not say why is a dead end. This was reported as "the Issue button is greyed
 * out, I can't issue it" — the explanation was already on the page, in a card
 * headed "Before this can be issued", and the connection between the two was
 * not made. Chrome shows `title` on a disabled button, so the reason is now
 * on the thing that refuses. */
export function IssueControl({
  contractId,
  clientId,
  blockedReason,
}: {
  contractId: string;
  clientId: string;
  blockedReason: string | null;
}) {
  const blocked = blockedReason !== null;
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
        title={blockedReason ?? undefined}
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

/** Downloads the contract as a finished A4 PDF.
 *
 * **This used to call `print()` on the preview frame, and that was the bug.**
 * The first real export came back on US Letter with `http://localhost:3000/…`
 * across every page, 6.5 MB, and font encoding mangled badly enough that WPS
 * refused to open it — because the print dialog's destination was "Microsoft
 * Print to PDF", a virtual printer that uses its own paper size and ignores
 * `@page { size: A4 }`. A legal document cannot depend on an operator getting
 * four settings right in an OS dialog, so the server renders it now and this
 * button just fetches the result.
 *
 * A plain link, not a fetch-and-blob: the browser downloads it natively, it
 * works with JavaScript off, and the filename comes from the response's
 * `content-disposition` rather than being guessed at here. `pending` exists
 * only because the render takes a couple of seconds on a cold function and a
 * button that looks inert is a button people click twice. */
export function DownloadPdfButton({ href }: { href: string }) {
  const [pending, setPending] = useState(false);

  return (
    // `buttonClass` on an anchor rather than <Button>, the same pattern as
    // push-explainer.tsx: this navigates, so it has to be a link, and
    // wrapping a link in a button nests interactive elements.
    <a
      href={href}
      className={buttonClass({ variant: "primary", size: "sm", className: "gap-1.5" })}
      onClick={() => {
        setPending(true);
        // Nothing tells a page that a native download finished, so this is a
        // timer rather than a real signal. It is honest about what it is:
        // long enough to cover a cold render, short enough that the button
        // comes back if something went wrong and the user wants another go.
        window.setTimeout(() => setPending(false), 6000);
      }}
    >
      <Icon name="download" size="sm" />
      {pending ? "Preparing…" : "Download PDF"}
    </a>
  );
}
