import { describe, it, expect } from "vitest";
import {
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABEL,
  FEEDBACK_KIND_BADGE,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_STATUS_BADGE,
  feedbackSchema,
  isFeedbackOpen,
  compareFeedback,
  sortFeedback,
  parseFeedbackStatusFilter,
  parseFeedbackKind,
  feedbackSummary,
  type FeedbackStatus,
} from "@/lib/feedback";

const at = (iso: string) => new Date(iso);

describe("feedback vocabulary", () => {
  it("labels and badges every kind, so no picker can render an undefined option", () => {
    for (const k of FEEDBACK_KINDS) {
      expect(FEEDBACK_KIND_LABEL[k]).toBeTruthy();
      expect(FEEDBACK_KIND_BADGE[k]).toBeTruthy();
    }
  });

  it("labels and badges every status", () => {
    for (const s of FEEDBACK_STATUSES) {
      expect(FEEDBACK_STATUS_LABEL[s]).toBeTruthy();
      expect(FEEDBACK_STATUS_BADGE[s]).toBeTruthy();
    }
  });
});

describe("feedbackSchema", () => {
  it("accepts a valid submission", () => {
    const parsed = feedbackSchema.safeParse({ kind: "PROBLEM", body: "The board drags oddly." });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty or whitespace-only body with a usable message", () => {
    const empty = feedbackSchema.safeParse({ kind: "SUGGESTION", body: "" });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.error.issues[0].message).toBe("Write something first");

    expect(feedbackSchema.safeParse({ kind: "SUGGESTION", body: "   " }).success).toBe(false);
  });

  it("trims the body rather than storing the user's stray whitespace", () => {
    const parsed = feedbackSchema.safeParse({ kind: "PRAISE", body: "  thanks  " });
    expect(parsed.success && parsed.data.body).toBe("thanks");
  });

  it("rejects a kind outside the enum", () => {
    expect(feedbackSchema.safeParse({ kind: "RANT", body: "hi" }).success).toBe(false);
  });

  it("rejects a body over 4000 characters", () => {
    expect(feedbackSchema.safeParse({ kind: "SUGGESTION", body: "x".repeat(4001) }).success).toBe(
      false
    );
    expect(feedbackSchema.safeParse({ kind: "SUGGESTION", body: "x".repeat(4000) }).success).toBe(
      true
    );
  });
});

describe("isFeedbackOpen", () => {
  // DECLINED counting as closed is the whole reason that status exists: an
  // admin who disagrees would otherwise have only "leave it NEW forever", and
  // the open count would stop meaning anything.
  it("treats NEW, ACKNOWLEDGED and PLANNED as open, and DONE and DECLINED as closed", () => {
    expect(isFeedbackOpen("NEW")).toBe(true);
    expect(isFeedbackOpen("ACKNOWLEDGED")).toBe(true);
    expect(isFeedbackOpen("PLANNED")).toBe(true);
    expect(isFeedbackOpen("DONE")).toBe(false);
    expect(isFeedbackOpen("DECLINED")).toBe(false);
  });

  it("classifies every declared status without throwing", () => {
    for (const s of FEEDBACK_STATUSES) expect(typeof isFeedbackOpen(s)).toBe("boolean");
  });
});

describe("compareFeedback and sortFeedback", () => {
  const row = (id: string, status: FeedbackStatus, iso: string) => ({
    id,
    status,
    createdAt: at(iso),
  });

  it("puts untriaged work first regardless of age", () => {
    const oldNew = row("old-new", "NEW", "2026-01-01T00:00:00.000Z");
    const freshDone = row("fresh-done", "DONE", "2026-08-01T00:00:00.000Z");
    expect(compareFeedback(oldNew, freshDone)).toBeLessThan(0);
  });

  it("orders the status bands NEW, ACKNOWLEDGED, PLANNED, DONE, DECLINED", () => {
    const rows = [
      row("declined", "DECLINED", "2026-08-05T00:00:00.000Z"),
      row("done", "DONE", "2026-08-05T00:00:00.000Z"),
      row("planned", "PLANNED", "2026-08-05T00:00:00.000Z"),
      row("ack", "ACKNOWLEDGED", "2026-08-05T00:00:00.000Z"),
      row("new", "NEW", "2026-08-05T00:00:00.000Z"),
    ];
    expect(sortFeedback(rows).map((r) => r.id)).toEqual([
      "new",
      "ack",
      "planned",
      "done",
      "declined",
    ]);
  });

  it("sorts newest first inside one status band", () => {
    const rows = [
      row("older", "NEW", "2026-08-01T00:00:00.000Z"),
      row("newer", "NEW", "2026-08-06T00:00:00.000Z"),
    ];
    expect(sortFeedback(rows).map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row("a", "DONE", "2026-08-01T00:00:00.000Z"), row("b", "NEW", "2026-08-01T00:00:00.000Z")];
    sortFeedback(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("parseFeedbackStatusFilter", () => {
  it("returns null for an absent value, so a bare URL means unfiltered", () => {
    expect(parseFeedbackStatusFilter(undefined)).toBeNull();
    expect(parseFeedbackStatusFilter("")).toBeNull();
  });

  it("accepts ALL and every declared status", () => {
    expect(parseFeedbackStatusFilter("ALL")).toBe("ALL");
    for (const s of FEEDBACK_STATUSES) expect(parseFeedbackStatusFilter(s)).toBe(s);
  });

  it("rejects an unknown value rather than throwing", () => {
    expect(parseFeedbackStatusFilter("WONTFIX")).toBeNull();
    expect(parseFeedbackStatusFilter("new")).toBeNull();
  });

  it("takes the first entry when the param is repeated", () => {
    expect(parseFeedbackStatusFilter(["DONE", "NEW"])).toBe("DONE");
  });
});

describe("parseFeedbackKind", () => {
  it("accepts every declared kind and rejects anything else", () => {
    for (const k of FEEDBACK_KINDS) expect(parseFeedbackKind(k)).toBe(k);
    expect(parseFeedbackKind("RANT")).toBeNull();
    expect(parseFeedbackKind("")).toBeNull();
    expect(parseFeedbackKind(null)).toBeNull();
    expect(parseFeedbackKind(undefined)).toBeNull();
  });
});

describe("feedbackSummary", () => {
  it("names the empty state rather than saying '0 items'", () => {
    expect(feedbackSummary(0, 0)).toBe("Nothing submitted yet");
  });

  it("pluralises and appends the open count only when something is open", () => {
    expect(feedbackSummary(1, 0)).toBe("1 item");
    expect(feedbackSummary(2, 0)).toBe("2 items");
    expect(feedbackSummary(7, 3)).toBe("7 items · 3 open");
  });
});
