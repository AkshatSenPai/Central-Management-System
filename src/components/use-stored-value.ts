"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/** Never changes, so `useSyncExternalStore` never resubscribes. Nothing here
 * reacts to another tab writing storage — a banner dismissed in one tab
 * staying visible in another until reload is not worth a listener. */
const noSubscribe = () => () => {};

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Safari in private mode throws on access. Treat it as "nothing stored" so
    // the feature degrades to never nagging, rather than crashing a page over
    // a banner.
    return null;
  }
}

/** One `localStorage` value, plus whether the browser has answered yet.
 *
 * **`localStorage` and not a `User` column, deliberately.** Push permission is
 * per-browser: the same person is granted on their laptop and un-asked on their
 * phone. A column would suppress the explainer everywhere after one dismissal
 * on one device — on the device that least needs it. The what's-new modal
 * shares the storage and accepts the same trade: a new browser shows the latest
 * notes once.
 *
 * **`ready` is false on the server and on the first client render**, and every
 * consumer must draw nothing until it is true. Without that, each page load
 * flashes a bar or a modal for one frame before storage says it was dismissed
 * months ago.
 *
 * `useSyncExternalStore` rather than an effect: this repo lints
 * `react-hooks/set-state-in-effect`, and reading browser-only state is exactly
 * what this hook exists for. The differing server and client snapshots are its
 * designed use, not a hydration mismatch.
 *
 * Untested by machine — vitest runs in the node environment with no jsdom
 * (`vitest.config.ts`), so the decision this feeds lives in `@/lib/dismissible`
 * and this is the thin wrapper around it. */
export function useStoredValue(key: string) {
  const ready = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );

  // What this session wrote, which wins over storage so a dismissal takes
  // effect immediately rather than on the next read.
  const [written, setWritten] = useState<string | null>(null);

  const value = written ?? (ready ? safeGet(key) : null);

  const store = useCallback(
    (next: string) => {
      setWritten(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // As above. The in-memory value still suppresses it for this session,
        // which is the best available when storage refuses to persist.
      }
    },
    [key]
  );

  return { value, store, ready };
}
