"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { subscribeToPushAction, unsubscribeFromPushAction } from "@/server/actions/push";

/** What this browser can currently do about push. Derived from the browser
 * every time, never from the database — a toggle rendered from a stored
 * subscription shows "on" for somebody who revoked permission in their browser
 * settings, which is precisely the case that needs surfacing rather than
 * hiding. */
type PushState =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "denied"
  | "off"
  | "on";

/** Complete class strings in a lookup, never interpolated fragments: Tailwind
 * v4 scans source text, so a literal written flush against a `${` is silently
 * dropped from the production build. */
const DOT = {
  on: "h-2 w-2 flex-none rounded-full bg-[var(--ok)]",
  off: "h-2 w-2 flex-none rounded-full bg-[var(--text-3)]",
} as const;

function isIosSafari(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

/** Turns the browser's public key string into the byte array `subscribe()`
 * wants. Base64url, so the two URL-safe characters are swapped back and the
 * padding restored before decoding.
 *
 * The buffer is allocated explicitly rather than using `Uint8Array.from`:
 * TypeScript now types `Uint8Array` over its backing buffer, and `from`
 * infers the wider `ArrayBufferLike`, which `applicationServerKey` rejects
 * because it admits `SharedArrayBuffer`. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Notifications when the app is closed.
 *
 * Lives in Settings rather than the topbar for the reason `<ThemeControl>`
 * already records: the topbar is for shortcuts you reach for, Settings is for
 * the thing you go looking for. You enable push once.
 *
 * **`requestPermission()` is called only from a real click**, never on mount.
 * A drive-by prompt is the cheapest way to make this feature permanently
 * unavailable to somebody: "denied" cannot be undone from JavaScript, and the
 * way back is a per-browser settings journey most people will not make. With
 * six people, one dead toggle is a sixth of the rollout. */
export function PushControl({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<PushState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Reads the truth from the browser and *returns* it rather than setting it.
   *
   * Returning keeps every `setState` out of the effect body — the state is
   * applied in a `then`, which is always asynchronous — and it separates
   * "what is true" from "what is rendered", which is the easier of the two to
   * reason about.
   *
   * It does have one side effect, deliberately: a subscription the browser
   * has dropped is deleted server-side on the way past, because the client is
   * the only thing that can observe a browser-side revocation, so it is the
   * only thing that can heal the row. */
  const readState = useCallback(async (): Promise<PushState> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    // iOS delivers push only to an installed app, so offering a toggle that
    // cannot work would just teach somebody the feature is broken.
    if (isIosSafari() && !isInstalled()) return "needs-install";
    if (Notification.permission === "denied") return "denied";

    const registration = await navigator.serviceWorker.getRegistration();
    const existing = await registration?.pushManager.getSubscription();
    if (existing && Notification.permission === "granted") return "on";
    if (existing) {
      // Permission went away but the subscription lingers: drop it both sides
      // so the stored row cannot outlive the browser's consent.
      await existing.unsubscribe().catch(() => {});
      await unsubscribeFromPushAction(existing.endpoint);
    }
    return "off";
  }, []);

  useEffect(() => {
    let cancelled = false;
    readState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState("off");
      });
    return () => {
      cancelled = true;
    };
  }, [readState]);

  async function enable() {
    setPending(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js", {
        // Never let a cached copy of the worker decide whether to update.
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          // Required by every browser: a push that displays nothing is
          // replaced by the browser's own "updated in the background" notice.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const json = subscription.toJSON();
      const result = await subscribeToPushAction({
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setState("on");
    } catch (e) {
      // A key rotation makes subscribe() reject with InvalidStateError,
      // because the browser still holds a subscription bound to the old
      // applicationServerKey. Clearing it lets the next attempt succeed, so
      // say that rather than showing a name nobody can act on.
      const name = e instanceof Error ? e.name : "";
      setError(
        name === "InvalidStateError"
          ? "This browser had an old subscription. Try again."
          : "Could not turn notifications on — try again."
      );
      const registration = await navigator.serviceWorker.getRegistration();
      const stale = await registration?.pushManager.getSubscription();
      await stale?.unsubscribe().catch(() => {});
    } finally {
      setPending(false);
    }
  }

  async function disable() {
    setPending(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        // Server first: if the browser call succeeded and this failed, the row
        // would outlive the device and push into a void forever.
        await unsubscribeFromPushAction(subscription.endpoint);
        await subscription.unsubscribe().catch(() => {});
      }
      setState("off");
    } catch {
      setError("Could not turn notifications off — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--text)]">Notifications on this device</p>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-3)]">
          {state === "checking" ? "Checking…" : null}
          {state === "unsupported" ? "This browser cannot show notifications." : null}
          {state === "needs-install"
            ? "On iPhone and iPad, add Meridian to your Home Screen first: tap Share, then Add to Home Screen, and open it from there."
            : null}
          {state === "denied"
            ? "Blocked for this site. Allow notifications in your browser's site settings, then reload."
            : null}
          {state === "off"
            ? "Get assignments and @mentions when the app is closed. Each device is separate."
            : null}
          {state === "on" ? "On for this device. Assignments and @mentions only." : null}
        </p>
        {error ? <FormError message={error} size="xs" className="mt-1.5" /> : null}
      </div>

      {/* No control at all in the three states where one cannot work. A toggle
          that silently does nothing is worse than an explanation. */}
      {state === "off" || state === "on" ? (
        <div className="flex flex-none items-center gap-2.5">
          <span aria-hidden="true" className={state === "on" ? DOT.on : DOT.off} />
          <Button
            onClick={state === "on" ? disable : enable}
            disabled={pending}
            variant={state === "on" ? "secondary" : "primary"}
            size="sm"
            className="gap-1.5"
          >
            <Icon name="notifications" size="sm" />
            {pending ? "…" : state === "on" ? "Turn off" : "Turn on"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
