import { describe, it, expect } from "vitest";
import { segmentBody, extractMentionedUserIds, commentSchema } from "@/lib/rich-text";

const MEMBERS = [
  { id: "u1", name: "Dana Reeve" },
  { id: "u2", name: "Tom Iversen" },
  { id: "u3", name: "Dana" },
];

const text = (t: string) => ({ kind: "text", text: t });

describe("segmentBody — plain text", () => {
  it("returns a single text segment for ordinary prose", () => {
    expect(segmentBody("Fixed the header.", MEMBERS)).toEqual([text("Fixed the header.")]);
  });

  it("returns nothing for an empty body", () => {
    expect(segmentBody("", MEMBERS)).toEqual([]);
  });

  it("preserves line breaks as text — the renderer handles wrapping", () => {
    expect(segmentBody("one\ntwo", MEMBERS)).toEqual([text("one\ntwo")]);
  });
});

describe("segmentBody — links", () => {
  it("links a bare https URL", () => {
    expect(segmentBody("see https://example.com now", MEMBERS)).toEqual([
      text("see "),
      { kind: "link", text: "https://example.com", href: "https://example.com" },
      text(" now"),
    ]);
  });

  // "see https://x.com." should link the URL and leave the sentence's full
  // stop behind, not swallow it into the href.
  it("does not swallow trailing punctuation", () => {
    const segs = segmentBody("see https://example.com.", MEMBERS);
    expect(segs[1]).toEqual({
      kind: "link",
      text: "https://example.com",
      href: "https://example.com",
    });
    expect(segs[2]).toEqual(text("."));
  });

  // The whole point of D1: nothing here can produce a dangerous href.
  it("leaves a javascript: scheme as literal text", () => {
    const body = "javascript:alert(document.cookie)";
    const segs = segmentBody(body, MEMBERS);
    expect(segs.every((s) => s.kind === "text")).toBe(true);
    expect(segs.map((s) => s.text).join("")).toBe(body);
  });

  it("leaves a data: URL as literal text", () => {
    const body = "data:text/html;base64,PHNjcmlwdD4=";
    expect(segmentBody(body, MEMBERS).every((s) => s.kind === "text")).toBe(true);
  });

  // An @ inside a URL's query string must not be read as a mention, or the
  // link gets torn in half.
  it("does not find mentions inside a URL", () => {
    const url = "https://example.com/x?to=@Dana%20Reeve";
    const segs = segmentBody(url, MEMBERS);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe("link");
  });
});

describe("segmentBody — mentions", () => {
  it("turns a member's name into a mention", () => {
    expect(segmentBody("ask @Dana Reeve please", MEMBERS)).toEqual([
      text("ask "),
      { kind: "mention", text: "@Dana Reeve", userId: "u1" },
      text(" please"),
    ]);
  });

  // Longest first, or "@Dana Reeve" matches member "Dana" and leaves the
  // surname as stray text next to a link to the wrong person.
  it("prefers the longest matching name", () => {
    const segs = segmentBody("@Dana Reeve", MEMBERS);
    expect(segs).toEqual([{ kind: "mention", text: "@Dana Reeve", userId: "u1" }]);
  });

  it("still matches the shorter name when that is what was typed", () => {
    expect(segmentBody("@Dana said so", MEMBERS)).toEqual([
      { kind: "mention", text: "@Dana", userId: "u3" },
      text(" said so"),
    ]);
  });

  it("is case-insensitive but preserves what was typed", () => {
    expect(segmentBody("@dana reeve", MEMBERS)).toEqual([
      { kind: "mention", text: "@dana reeve", userId: "u1" },
    ]);
  });

  // "@Dana" must not match inside "@Danactive".
  it("requires a word boundary after the name", () => {
    const segs = segmentBody("@Danactive", MEMBERS);
    expect(segs.every((s) => s.kind === "text")).toBe(true);
  });

  it("leaves an unknown name as literal text", () => {
    expect(segmentBody("@Nobody Here", MEMBERS)).toEqual([text("@Nobody Here")]);
  });

  it("leaves a bare @ alone", () => {
    expect(segmentBody("email me @ work", MEMBERS)).toEqual([text("email me @ work")]);
  });

  it("handles several mentions in one body", () => {
    const segs = segmentBody("@Dana Reeve and @Tom Iversen", MEMBERS);
    expect(segs.filter((s) => s.kind === "mention").map((s) => s.text)).toEqual([
      "@Dana Reeve",
      "@Tom Iversen",
    ]);
  });

  it("survives an empty member list", () => {
    expect(segmentBody("@Dana Reeve", [])).toEqual([text("@Dana Reeve")]);
  });

  // A zero-length name would otherwise match at every "@" forever.
  it("ignores a member with an empty name", () => {
    expect(segmentBody("@x", [{ id: "bad", name: "" }])).toEqual([text("@x")]);
  });
});

describe("segmentBody — round trip", () => {
  // Whatever the segmentation, concatenating the visible text must give the
  // body back. If this ever fails, the renderer is dropping or duplicating
  // what someone wrote.
  it.each([
    "plain",
    "ask @Dana Reeve about https://example.com today",
    "@Dana Reeve@Tom Iversen",
    "https://a.com https://b.com",
    "@@Dana",
    "<script>alert(1)</script>",
    "  leading and trailing  ",
  ])("reproduces the body exactly: %j", (body) => {
    expect(
      segmentBody(body, MEMBERS)
        .map((s) => s.text)
        .join("")
    ).toBe(body);
  });
});

describe("extractMentionedUserIds", () => {
  it("collects the ids", () => {
    expect(extractMentionedUserIds("@Dana Reeve and @Tom Iversen", MEMBERS)).toEqual(["u1", "u2"]);
  });

  // Phase 4 will notify from this array; three mentions is still one person.
  it("deduplicates", () => {
    expect(extractMentionedUserIds("@Dana Reeve @Dana Reeve", MEMBERS)).toEqual(["u1"]);
  });

  it("is empty when nobody is mentioned", () => {
    expect(extractMentionedUserIds("no one here", MEMBERS)).toEqual([]);
  });
});

describe("commentSchema", () => {
  it("rejects an empty body", () => {
    expect(commentSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("trims", () => {
    const parsed = commentSchema.parse({ body: "  hi  " });
    expect(parsed.body).toBe("hi");
  });

  it("rejects a body over 4000 characters", () => {
    expect(commentSchema.safeParse({ body: "x".repeat(4001) }).success).toBe(false);
  });
});
