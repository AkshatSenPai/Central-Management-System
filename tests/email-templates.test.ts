import { describe, it, expect } from "vitest";
import { escapeHtml, inviteEmail } from "@/lib/email-templates";

describe("escapeHtml", () => {
  it("escapes the five characters that change meaning in HTML", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml('a "quoted" value')).toBe("a &quot;quoted&quot; value");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  // `&` must be replaced first, or the entities introduced by the later
  // replacements get escaped a second time and render as literal text.
  it("does not double-escape the entities it introduces", () => {
    expect(escapeHtml("Harlow & Fitch")).toBe("Harlow &amp; Fitch");
    expect(escapeHtml("<a & b>")).toBe("&lt;a &amp; b&gt;");
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Dana Reeve")).toBe("Dana Reeve");
    expect(escapeHtml("")).toBe("");
  });
});

describe("inviteEmail", () => {
  const base = {
    inviteUrl: "https://cmsforuse.space/invite/tok123",
    inviterName: "Dana Reeve",
    expiresInDays: 7,
  };

  it("names the inviter in the subject, so the recipient knows why it arrived", () => {
    expect(inviteEmail(base).subject).toBe("Dana Reeve invited you to Meridian Ops");
  });

  it("carries the invite link in both the HTML and the text part", () => {
    const mail = inviteEmail(base);
    expect(mail.html).toContain(base.inviteUrl);
    expect(mail.text).toContain(base.inviteUrl);
  });

  // A button is useless in a client that blocks HTML, and a link somebody can
  // read before clicking is the honest way to send one.
  it("prints the URL as visible text, not only as a button target", () => {
    const mail = inviteEmail(base);
    const visible = mail.html.replace(/<[^>]+>/g, " ");
    expect(visible).toContain(base.inviteUrl);
  });

  it("always sends a text alternative — spam filters and plain-text clients both need it", () => {
    const mail = inviteEmail(base);
    expect(mail.text.length).toBeGreaterThan(0);
    expect(mail.text).not.toContain("<");
  });

  // A member's display name is user input and lands inside the HTML body.
  it("escapes the inviter's name rather than interpolating it raw", () => {
    const mail = inviteEmail({ ...base, inviterName: '<img src=x onerror="alert(1)">' });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });

  it("escapes the URL where it is used as an attribute value", () => {
    const mail = inviteEmail({
      ...base,
      inviteUrl: 'https://cmsforuse.space/invite/x"onmouseover="alert(1)',
    });
    expect(mail.html).not.toContain('"onmouseover="');
    expect(mail.html).toContain("&quot;onmouseover=&quot;");
  });

  it("pluralises the expiry correctly", () => {
    expect(inviteEmail({ ...base, expiresInDays: 7 }).text).toContain("7 days");
    expect(inviteEmail({ ...base, expiresInDays: 1 }).text).toContain("1 day");
    expect(inviteEmail({ ...base, expiresInDays: 1 }).text).not.toContain("1 days");
  });

  // No remote images: they break when clients block loading, and a
  // remote image in an email is a tracking pixel by another name — which is
  // exactly what click and open tracking were turned off to avoid.
  it("references no remote images", () => {
    expect(inviteEmail(base).html).not.toMatch(/<img/i);
  });
});
