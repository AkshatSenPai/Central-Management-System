"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextareaField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { FEEDBACK_KINDS, FEEDBACK_KIND_LABEL, type FeedbackKind } from "@/lib/feedback";
import { addFeedbackAction } from "@/server/actions/feedback";

type Values = { kind: FeedbackKind; body: string };

const EMPTY: Values = { kind: "SUGGESTION", body: "" };

/** Submit-only. There is no edit, deliberately: feedback is a statement
 * someone made at a point in time, and an admin acting on it needs to know it
 * still says what it said when they read it. Getting it wrong is what delete
 * is for. */
export function FeedbackForm() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>(EMPTY);
  const [attempt, setAttempt] = useState(0);

  const [state, formAction, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof addFeedbackAction>> | null, formData: FormData) => {
      const result = await addFeedbackAction(prev, formData);
      if (result.ok) {
        setOpen(false);
        setValues(EMPTY);
      } else {
        setAttempt((a) => a + 1);
      }
      return result;
    },
    null
  );

  function cancel() {
    setOpen(false);
    setValues(EMPTY);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="primary" size="sm" className="gap-1.5">
        <Icon name="add" size="sm" />
        Give feedback
      </Button>

      <Modal
        open={open}
        onClose={cancel}
        title="Give feedback"
        icon="campaign"
        width={560}
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={cancel}>Cancel</Button>
            <Button type="submit" form="feedback-form" variant="primary" disabled={pending}>
              {pending ? "Sending…" : "Send"}
            </Button>
          </>
        }
      >
        {/* `key={attempt}` remounts the form after a rejected submit, the same
            trick every other form here uses so a stale native value cannot
            survive an error. The selects below are fully controlled, which is
            what stops the fall-back-to-first-option divergence that shipped
            Low-priority quick-adds. */}
        <form id="feedback-form" key={attempt} action={formAction} className="space-y-4">
          {state && !state.ok ? <FormError message={state.error} /> : null}

          <SelectField
            label="What kind?"
            className="w-full"
            name="kind"
            value={values.kind}
            onChange={(e) => setValues((v) => ({ ...v, kind: e.target.value as FeedbackKind }))}
          >
            {FEEDBACK_KINDS.map((k) => (
              <option key={k} value={k}>
                {FEEDBACK_KIND_LABEL[k]}
              </option>
            ))}
          </SelectField>

          <TextareaField
            label="Tell us"
            className="w-full"
            name="body"
            rows={6}
            required
            placeholder="What would make this easier? What got in your way? What is working well?"
            value={values.body}
            onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))}
          />

          <p className="text-xs text-[var(--text-3)]">
            An admin reads every item and marks it Acknowledged, Planned, Done or Declined — so you
            can see what happened to it.
          </p>
        </form>
      </Modal>
    </>
  );
}
