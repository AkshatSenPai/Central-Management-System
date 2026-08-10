"use client";

import { useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useStoredValue } from "@/components/use-stored-value";
import { shouldShowRelease } from "@/lib/dismissible";
import { RELEASES } from "@/lib/releases";

const STORAGE_KEY = "seen-release";

/** Shows the NEWEST release only, never a backlog. Somebody away for three
 * deploys gets the latest note — this is an announcement, not an archive. */
export function WhatsNew() {
  const newest = RELEASES[0];
  const { value, store, seed, ready } = useStoredValue(STORAGE_KEY);

  const firstEverVisit = ready && value === null && Boolean(newest);

  // Records the current release without showing it. `seed` writes storage and
  // deliberately does not setState: this repo lints react-hooks/set-state-in-effect,
  // and a re-render here would achieve nothing anyway.
  useEffect(() => {
    if (firstEverVisit) seed(newest.id);
  }, [firstEverVisit, seed, newest]);

  if (!ready || !newest) return null;
  if (!shouldShowRelease(value, newest.id)) return null;

  return (
    <Modal
      open
      onClose={() => store(newest.id)}
      title={newest.title}
      icon="campaign"
      meta={newest.date}
      width={520}
      footer={
        <Button variant="primary" size="sm" onClick={() => store(newest.id)}>
          Got it
        </Button>
      }
    >
      <ul className="space-y-2 text-sm text-[var(--text-2)]">
        {newest.items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden className="flex-none text-[var(--text-3)]">
              •
            </span>
            <span className="min-w-0 flex-1">{item}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
