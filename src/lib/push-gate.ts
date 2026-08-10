"use client";

/** What this browser will allow, before any subscription is looked up.
 *
 * **Synchronous and free of side effects, on purpose.** `PushControl`'s own
 * `readState` deliberately heals as it reads — it unsubscribes a
 * browser-dropped subscription and deletes the row server-side, because the
 * client is the only thing that can observe a browser-side revocation. The
 * dashboard explainer must do none of that: a banner may not mutate anything.
 *
 * So this is only the platform classification, shared so the iOS and
 * permission rules cannot end up enforced in one place and not the other.
 * `PushControl` layers its subscription lookup and its healing on top. */
export type PushGate = "unsupported" | "needs-install" | "denied" | "granted" | "unasked";

export function isIosSafari(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function pushGateState(): PushGate {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  // iOS delivers push only to an installed app, so offering anything that
  // cannot work would just teach somebody the feature is broken.
  if (isIosSafari() && !isInstalled()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return "granted";
  return "unasked";
}
