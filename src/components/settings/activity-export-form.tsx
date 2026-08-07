"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";

/** A plain GET form pointing at the export Route Handler.
 *
 * `method="get"` and no `onSubmit`: the browser navigates, sees
 * `Content-Disposition: attachment`, and downloads without leaving the page.
 * That is why this is not a Server Action — there is no Blob to build, no
 * synthetic click, and it works with JavaScript disabled.
 *
 * The date defaults are computed on the client and held in state rather than
 * passed from the server, because a server-rendered "today" would be baked
 * into a cached page and go stale. Empty is a valid starting state: the
 * handler rejects a missing date with a sentence rather than exporting
 * everything since the epoch. */
export function ActivityExportForm({
  clients,
  members,
}: {
  clients: ReadonlyArray<{ id: string; name: string }>;
  members: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  return (
    <form method="get" action="/api/activity/export" className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Field
          label="From"
          type="date"
          name="from"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          label="To"
          type="date"
          name="to"
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Both pickers default to "" — every option, no filter — and "" is a
            real option here, so the rendered value always matches one and
            cannot fall back to the first the way an unmatched value would. */}
        <SelectField label="Client" name="clientId" defaultValue="">
          <option value="">Every client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>

        <SelectField label="Member" name="actorId" defaultValue="">
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="sm" className="gap-1.5">
          <Icon name="download" size="sm" />
          Download CSV
        </Button>
        <span className="text-xs text-[var(--text-3)]">
          Both dates are included. Opens in Excel; the raw detail is kept in a{" "}
          <span className="mono">meta_json</span> column so nothing is lost.
        </span>
      </div>
    </form>
  );
}
