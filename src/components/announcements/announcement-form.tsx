"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextareaField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { toDateInputValue } from "@/lib/dates";
import {
  addAnnouncementAction,
  updateAnnouncementAction,
} from "@/server/actions/announcements";

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

type AnnouncementDefaults = {
  id: string;
  title: string;
  body: string;
  pinnedUntil: Date | null;
};

type Values = { title: string; body: string; pinnedUntil: string };

function initialValues(a?: AnnouncementDefaults): Values {
  return {
    title: a?.title ?? "",
    body: a?.body ?? "",
    pinnedUntil: toDateInputValue(a?.pinnedUntil ?? null),
  };
}

/** Post and edit, the same shape as every other form in the app. */
export function AnnouncementForm({ announcement }: { announcement?: AnnouncementDefaults }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>(() => initialValues(announcement));
  const [attempt, setAttempt] = useState(0);
  const save = (announcement ? updateAnnouncementAction : addAnnouncementAction) as SaveAction;

  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await save(prev, formData);
      if (result.ok) {
        setOpen(false);
        if (!announcement) setValues(initialValues());
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
    setValues(initialValues(announcement));
  }

  const formId = announcement ? `announcement-form-${announcement.id}` : "announcement-form-new";

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={announcement ? "secondary" : "primary"}
        size={announcement ? "xs" : "sm"}
        className="gap-1.5"
      >
        <Icon name={announcement ? "edit" : "add"} size="sm" />
        {announcement ? "Edit" : "Post announcement"}
      </Button>

      <Modal
        open={open}
        onClose={cancel}
        title={announcement ? "Edit announcement" : "New announcement"}
        icon="campaign"
        width={620}
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={cancel}>Cancel</Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? "Saving…" : announcement ? "Save changes" : "Post"}
            </Button>
          </>
        }
      >
        <form id={formId} key={attempt} action={formAction} className="space-y-4">
          {announcement ? (
            <input type="hidden" name="announcementId" value={announcement.id} />
          ) : null}
          {state && !state.ok ? <FormError message={state.error} /> : null}

          <Field
            label="Title"
            className="w-full"
            name="title"
            required
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
          />
          <TextareaField
            label="Announcement"
            className="w-full"
            name="body"
            rows={6}
            required
            placeholder="What does the studio need to know? Links become clickable, and @mentions link to that person."
            value={values.body}
            onChange={(e) => set("body", e.target.value)}
          />
          <Field
            label="Pin to the dashboard until"
            className="w-full"
            type="date"
            name="pinnedUntil"
            value={values.pinnedUntil}
            onChange={(e) => set("pinnedUntil", e.target.value)}
          />
          {/* An expiry rather than a boolean, because a board of permanently
              pinned notices is a board nobody reads. Leave it empty to post
              without pinning. */}
          <p className="text-xs text-[var(--text-3)]">
            Leave the date empty to post without pinning. A pin ends on its own.
          </p>
        </form>
      </Modal>
    </>
  );
}
