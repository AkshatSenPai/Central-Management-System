"use client";

import { useActionState, useState } from "react";
import { addContactAction, updateContactAction } from "@/server/actions/clients";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

type ContactDefaults = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
};

type Values = { name: string; email: string; phone: string; role: string };

function initialValues(contact?: ContactDefaults): Values {
  return {
    name: contact?.name ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    role: contact?.role ?? "",
  };
}

/** Create and edit, the same shape as <ClientForm> and <TaskForm>.
 *
 * Edit was the half that was missing: `updateContactAction` and the
 * `updateContact` service were both written, tested and reachable by nothing,
 * so a contact's phone or role could only be set at the moment it was
 * created. That is why the seeded contacts all had a null phone and why
 * correcting one meant writing to the database by hand.
 *
 * `isPrimary` is deliberately not a field here, matching the service: promotion
 * is `setPrimaryContact`'s job alone, so an edit can never quietly leave a
 * client with two primaries or none. The contact row keeps its own
 * "Make primary" button for that. */
export function ContactForm({
  clientId,
  contact,
}: {
  clientId: string;
  contact?: ContactDefaults;
}) {
  const [open, setOpen] = useState(false);
  // Controlled on purpose: React 19 resets an uncontrolled form after the
  // action resolves, including on validation failure.
  const [values, setValues] = useState<Values>(() => initialValues(contact));
  // See ClientForm: React 19 resets the form after the action resolves, so a
  // rejected submit remounts the subtree to re-read `values`.
  const [attempt, setAttempt] = useState(0);
  const save = (contact ? updateContactAction : addContactAction) as SaveAction;
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await save(prev, formData);
      if (result.ok) {
        setOpen(false);
        // A create form starts empty again; an edit form keeps what was saved.
        if (!contact) setValues(initialValues());
      } else {
        setAttempt((a) => a + 1);
      }
      return result;
    },
    null
  );

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function cancel() {
    setOpen(false);
    setValues(initialValues(contact));
  }

  // Stable across the `attempt` remount, and unique per edit target, because
  // the footer's submit button reaches this form by id from outside it.
  const formId = contact ? `contact-form-${contact.id}` : `contact-form-new-${clientId}`;

  return (
    <>
      {/* xs in edit mode: the trigger sits in the contact row beside
          "Make primary" and "Remove", and anything larger would break that
          row's density. */}
      <Button
        onClick={() => setOpen(true)}
        size={contact ? "xs" : "sm"}
        className="gap-1.5"
        aria-label={contact ? `Edit ${contact.name}` : undefined}
      >
        <Icon name={contact ? "edit" : "add"} size="sm" />
        {contact ? "Edit" : "Add contact"}
      </Button>

      <Modal
        open={open}
        onClose={cancel}
        title={contact ? "Edit contact" : "New contact"}
        icon="person"
        width={520}
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={cancel}>Cancel</Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? "Saving…" : contact ? "Save changes" : "Add contact"}
            </Button>
          </>
        }
      >
        <form id={formId} key={attempt} action={formAction} className="space-y-4">
          <input type="hidden" name="clientId" value={clientId} />
          {/* updateContactAction reads contactId off the form; addContactAction
              ignores it, so it is only rendered where it means something. */}
          {contact ? <input type="hidden" name="contactId" value={contact.id} /> : null}
          {state && !state.ok ? <FormError message={state.error} /> : null}

          <Field
            label="Name"
            className="w-full"
            name="name"
            required
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
          />
          <Field
            label="Role"
            className="w-full"
            name="role"
            placeholder="e.g. Marketing Director"
            value={values.role}
            onChange={(e) => set("role", e.target.value)}
          />
          {/* Email and phone side by side, because this studio uses both and
              they are read together. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Email"
              className="w-full"
              name="email"
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
            />
            <Field
              label="Phone"
              className="w-full"
              name="phone"
              type="tel"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
        </form>
      </Modal>
    </>
  );
}
