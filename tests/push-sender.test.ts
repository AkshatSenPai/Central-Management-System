import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendNotification = vi.hoisted(() => vi.fn());
const setVapidDetails = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({ default: { sendNotification, setVapidDetails } }));

import { isGoneStatus, isPushConfigured, sendPush } from "@/lib/push-sender";

const SUB = { endpoint: "https://fcm.example/abc", p256dh: "p256", auth: "auth" };
const PAYLOAD = { title: "Meridian Ops", body: "Dana assigned you a task", url: "/tasks/t1", tag: "TASK:t1" };

const original = {
  pub: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  priv: process.env.VAPID_PRIVATE_KEY,
  subj: process.env.VAPID_SUBJECT,
};

function configure(pub?: string, priv?: string, subj?: string) {
  const set = (k: string, v?: string) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  set("NEXT_PUBLIC_VAPID_PUBLIC_KEY", pub);
  set("VAPID_PRIVATE_KEY", priv);
  set("VAPID_SUBJECT", subj);
}

const ALL = ["pubkey", "privkey", "mailto:ops@cmsforuse.space"] as const;

beforeEach(() => {
  sendNotification.mockReset();
  setVapidDetails.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  configure(original.pub, original.priv, original.subj);
  vi.restoreAllMocks();
});

/** web-push reports HTTP failures as an error carrying `statusCode`. */
function pushError(statusCode: number) {
  return Object.assign(new Error(`push failed ${statusCode}`), { statusCode });
}

describe("isPushConfigured", () => {
  // One switch, not three: a half-configured environment must skip cleanly
  // rather than fail at the push service with an opaque signing error.
  it("needs all three VAPID variables", () => {
    configure(...ALL);
    expect(isPushConfigured()).toBe(true);

    configure(undefined, ALL[1], ALL[2]);
    expect(isPushConfigured()).toBe(false);

    configure(ALL[0], undefined, ALL[2]);
    expect(isPushConfigured()).toBe(false);

    configure(ALL[0], ALL[1], undefined);
    expect(isPushConfigured()).toBe(false);
  });
});

describe("isGoneStatus", () => {
  // Getting this backwards deletes everybody's subscriptions during one
  // push-service outage, and every person then has to re-enable by hand.
  it("treats only 403, 404 and 410 as permanently dead", () => {
    for (const dead of [403, 404, 410]) expect(isGoneStatus(dead)).toBe(true);
    for (const transient of [400, 401, 429, 500, 502, 503]) expect(isGoneStatus(transient)).toBe(false);
  });
});

describe("sendPush", () => {
  // What lets the whole feature merge and run before any VAPID key exists.
  it("no-ops without configuration and never touches the network", async () => {
    configure(undefined, undefined, undefined);
    const result = await sendPush(SUB, PAYLOAD);
    expect(result).toEqual({ sent: false, reason: "not-configured" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends the payload with a one-day TTL and a collapsing Topic", async () => {
    configure(...ALL);
    sendNotification.mockResolvedValue({ statusCode: 201 });

    expect(await sendPush(SUB, PAYLOAD)).toEqual({ sent: true });

    const [sub, body, options] = sendNotification.mock.calls[0];
    expect(sub).toEqual({ endpoint: SUB.endpoint, keys: { p256dh: "p256", auth: "auth" } });
    expect(JSON.parse(body)).toEqual(PAYLOAD);
    expect(options.TTL).toBe(86400);
    expect(options.headers.Topic).toBe(PAYLOAD.tag);
  });

  // The R2 trap, asserted: module-scope configuration means any test importing
  // the module throws on import when env vars are absent.
  it("does not configure VAPID at import time", () => {
    expect(setVapidDetails).not.toHaveBeenCalled();
  });

  // The three below are one rule: this runs inside after(), where the mutation
  // has already committed and an exception has nobody to catch it. Failing to
  // buzz a phone must never look like the assignment failing.
  it("reports a dead subscription instead of throwing", async () => {
    configure(...ALL);
    for (const status of [403, 404, 410]) {
      sendNotification.mockRejectedValueOnce(pushError(status));
      const result = await sendPush(SUB, PAYLOAD);
      expect(result.sent).toBe(false);
      if (!result.sent) expect(result.reason).toBe("gone");
    }
  });

  it("reports a transient rejection instead of throwing, and never as gone", async () => {
    configure(...ALL);
    for (const status of [429, 500, 503]) {
      sendNotification.mockRejectedValueOnce(pushError(status));
      const result = await sendPush(SUB, PAYLOAD);
      expect(result.sent).toBe(false);
      if (!result.sent) expect(result.reason).toBe("rejected");
    }
  });

  it("reports an unreachable service instead of throwing", async () => {
    configure(...ALL);
    sendNotification.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await sendPush(SUB, PAYLOAD);
    expect(result.sent).toBe(false);
    if (!result.sent) {
      expect(result.reason).toBe("unreachable");
      expect(result.detail).toContain("ECONNREFUSED");
    }
  });
});
