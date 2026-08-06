"use client";

import { useState } from "react";
import { FileField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { MAX_UPLOAD_BYTES, formatFileSize, validateUpload } from "@/lib/attachment";
import { requestUploadAction, confirmUploadAction } from "@/server/actions/attachments";
import { scopeFormData, type AttachmentScope } from "@/components/attachments/attachment-scope";

/**
 * The browser half of spec §6:108's two-step write, and the only place in
 * this app where bytes leave the user's machine.
 *
 * **The bytes never touch this server.** `requestUploadAction` returns a
 * presigned PUT; the `fetch` below sends the file straight to R2; only then
 * does `confirmUploadAction` write the row. §6:107 gives the reason —
 * "routing bytes through a Server Action would hit Next's body limits and
 * burn server memory on a file the server has no reason to see" — and the
 * limit is not theoretical: this version of Next caps a Server Action's
 * request body at 1 MB by default (`server-actions.md`, Security), against
 * a 25 MB file limit. A `File` in a Server Action's `FormData` would fail
 * at 1 MB and be wrong at every size.
 *
 * That is why the `<form action={run}>` below is bound to a **client**
 * function. React builds the `FormData` in the browser and hands it to
 * `run`, which reads the `File` out of it and never passes it to an action —
 * the two payloads that do reach the server carry `fileName`,
 * `contentType` and `sizeBytes`, and no bytes. The same shape
 * `EventRemoveControl` uses, for a different reason: there, so a failed
 * delete keeps its error; here, so React wraps the whole sequence in a
 * transition, which is what lets `confirmUploadAction`'s `revalidatePath`
 * response re-render the list underneath without a second round trip.
 *
 * **The picker submits itself.** A file input has no natural submit — the
 * user has already made their only decision by the time `change` fires, and
 * a separate "Upload" button would just be a second click asking them to
 * confirm what they already chose. `requestSubmit()` is this version of
 * Next's own documented way to do that (`forms.md`, "Programmatic form
 * submission"), and going through the form rather than calling `run`
 * directly from the handler is what keeps the transition above.
 *
 * **Why the form is remounted by `key`.** A file input holds the chosen file
 * until it is reset, so picking the *same* file twice in a row fires no
 * second `change` event and the second upload silently never starts.
 * Bumping `attempt` remounts the input empty. `CommentComposer` uses the
 * same trick for the same mechanical reason, though it only needs it on
 * success; this needs it on failure too, since "try that again" is the
 * likeliest next action after an upload fails.
 */
export function AttachmentUpload({ scope }: { scope: AttachmentScope }) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyWith, setBusyWith] = useState<string | null>(null);

  async function run(formData: FormData) {
    const file = formData.get("file");
    // Not a guard against the user — `change` cannot fire without a file —
    // but against the shape: `FormData.get` is typed `FormDataEntryValue |
    // null`, and narrowing it here is what lets everything below read
    // `.name`, `.size` and `.type` without a cast.
    if (!(file instanceof File)) return;

    setError(null);

    // §6:110's client-side half, before a URL is minted rather than after:
    // the point of checking here is to spend no round trip at all on a file
    // that cannot be accepted. The presigned URL's own content-length
    // condition is the enforcement (`r2.ts`), and this is the advice — the
    // same `validateUpload` both, so the two cannot disagree about what 25 MB
    // means.
    const validationError = validateUpload(file.name, file.size);
    if (validationError) {
      setError(validationError);
      setAttempt((a) => a + 1);
      return;
    }

    setBusyWith(file.name);
    try {
      const request = scopeFormData(scope);
      request.set("fileName", file.name);
      request.set("contentType", file.type);
      request.set("sizeBytes", String(file.size));

      const requested = await requestUploadAction(request);
      if (!requested.ok) {
        setError(requested.error);
        return;
      }
      const { uploadUrl, fileKey, contentType } = requested.data;

      // `contentType` is the value the *server* signed, echoed back, not
      // `file.type` — `presignPut` signs over `content-type`, so a header
      // that differs from the signed one by so much as a space fails the
      // signature check. See `normaliseContentType` in `attachment.ts`.
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!put.ok) {
        // Deliberately does not call `confirmUploadAction`. A failed PUT
        // leaves at most an incomplete object and no row — §6:108's safe
        // failure direction, "invisible in the UI and reapable later".
        // Confirming anyway would write the row this whole ordering exists
        // to withhold, and hand the user a download button for bytes that
        // never arrived.
        setError(`${file.name} did not reach storage — try again`);
        return;
      }

      const confirm = scopeFormData(scope);
      confirm.set("fileKey", fileKey);
      confirm.set("fileName", file.name);
      confirm.set("contentType", contentType);
      confirm.set("sizeBytes", String(file.size));

      const confirmed = await confirmUploadAction(confirm);
      if (!confirmed.ok) setError(confirmed.error);
    } catch {
      // Reached when the PUT itself throws rather than returning a bad
      // status — a dropped connection, or a CORS rejection, which `fetch`
      // surfaces as a network error with no readable detail by design.
      setError(`${file.name} could not be uploaded — check your connection and try again`);
    } finally {
      setBusyWith(null);
      setAttempt((a) => a + 1);
    }
  }

  return (
    <div className="space-y-2">
      <form key={attempt} action={run} className="flex items-center gap-2.5">
        <FileField
          name="file"
          disabled={busyWith !== null}
          aria-label="Attach a file"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          <Icon name="attach_file" size="sm" />
          {busyWith ? "Uploading…" : "Attach a file"}
        </FileField>
        <span className="text-[11.5px] text-[var(--text-3)]">
          {busyWith ?? `Up to ${formatFileSize(MAX_UPLOAD_BYTES)} per file`}
        </span>
      </form>
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
