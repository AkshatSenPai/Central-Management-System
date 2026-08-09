/* Meridian Ops service worker.
 *
 * It exists for exactly one thing: receiving push messages and showing them.
 *
 * ** THIS WORKER MUST NEVER GAIN A `fetch` HANDLER OR A CACHE. **
 *
 * That is not a style preference. Next serves content-hashed chunks, so a
 * worker that caches responses turns the app into a stale-asset machine: a
 * cached HTML document referencing chunk hashes that no longer exist produces
 * a white screen, and the person seeing it cannot fix it by reloading. Offline
 * support is not in scope, and adding it is a project, not a tweak.
 *
 * That rule is also what makes skipWaiting + clients.claim safe here. The usual
 * objection to them is swapping the controller under a page that then loads
 * mismatched assets — which cannot happen when the worker intercepts nothing.
 *
 * Not unit-testable: there is no ServiceWorkerGlobalScope in node, and vitest
 * runs with environment "node". Kept short enough to read in one screen for
 * that reason; everything with real logic lives in src/lib/push-payload.ts,
 * which is tested. Changes here need a real browser.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close. A fixed
  // push bug sitting behind an old worker until someone quits their browser is
  // a fix nobody receives.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // A notification is shown on EVERY path, including the failure ones.
  // `userVisibleOnly: true` is a contract the browser enforces: a push that
  // displays nothing is replaced by the browser's own "this site was updated
  // in the background" notice, and repeated violations revoke the
  // subscription outright. A generic sentence is always better than that.
  let payload = {
    title: "Meridian Ops",
    body: "You have a new notification",
    url: "/dashboard",
    tag: "generic",
  };

  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Malformed or non-JSON data. Fall through with the generic payload —
    // never return early, or the browser posts its own notice instead.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";

  // Focus an existing window before opening a new one. This team keeps the app
  // pinned or installed, so openWindow-always would leave them with a fresh
  // tab per notification and the original still sitting there.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if ("focus" in client) {
            // navigate() can reject on cross-origin or a detached client;
            // focusing anyway beats doing nothing.
            if ("navigate" in client) client.navigate(target).catch(() => {});
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
      .catch(() => self.clients.openWindow(target))
  );
});
