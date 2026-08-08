import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isEmailConfigured, sendEmail } from "@/lib/email-sender";

const MESSAGE = { to: "dana@example.com", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };

const originalKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.EMAIL_FROM;

function configure(apiKey: string | undefined, from: string | undefined) {
  if (apiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = apiKey;
  if (from === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = from;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  configure(originalKey, originalFrom);
  vi.restoreAllMocks();
});

describe("isEmailConfigured", () => {
  // Both halves are required. A key without a from-address cannot send, and a
  // from-address without a key cannot either — treating them as one switch is
  // what stops a half-configured environment failing at the API instead of
  // being skipped cleanly.
  it("needs both the API key and the from-address", () => {
    configure("re_test", "no-reply@cmsforuse.space");
    expect(isEmailConfigured()).toBe(true);

    configure("re_test", undefined);
    expect(isEmailConfigured()).toBe(false);

    configure(undefined, "no-reply@cmsforuse.space");
    expect(isEmailConfigured()).toBe(false);

    configure(undefined, undefined);
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("sendEmail", () => {
  // This is what lets the whole feature be built and used before a Resend key
  // exists: invites still work, the link is still shown on screen, and nothing
  // errors.
  it("no-ops without configuration and never touches the network", async () => {
    configure(undefined, undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await sendEmail(MESSAGE);

    expect(result).toEqual({ sent: false, reason: "not-configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to Resend with the configured from-address and a bearer token", async () => {
    configure("re_test", "no-reply@cmsforuse.space");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
    );

    const result = await sendEmail(MESSAGE);

    expect(result).toEqual({ sent: true, id: "msg_1" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "no-reply@cmsforuse.space",
      to: ["dana@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });

  // The three tests below are one rule: this runs inside `after()`, where the
  // mutation has already committed and an exception has nobody to catch it. A
  // task really was assigned; failing to email about it must never look like
  // the assignment failing.
  it("reports a rejection instead of throwing", async () => {
    configure("re_test", "no-reply@cmsforuse.space");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("domain not verified", { status: 403 })
    );

    const result = await sendEmail(MESSAGE);
    expect(result.sent).toBe(false);
    if (!result.sent) {
      expect(result.reason).toBe("rejected");
      expect(result.detail).toContain("domain not verified");
    }
  });

  it("reports an unreachable API instead of throwing", async () => {
    configure("re_test", "no-reply@cmsforuse.space");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await sendEmail(MESSAGE);
    expect(result.sent).toBe(false);
    if (!result.sent) {
      expect(result.reason).toBe("unreachable");
      expect(result.detail).toContain("ECONNREFUSED");
    }
  });

  it("still reports success when the response body is not JSON", async () => {
    configure("re_test", "no-reply@cmsforuse.space");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

    expect(await sendEmail(MESSAGE)).toEqual({ sent: true, id: null });
  });
});
