import { describe, it, expect } from "vitest";
import type { NotificationType } from "@prisma/client";
import {
  MAX_PAYLOAD_BYTES,
  MAX_TITLE_CHARS,
  buildPushPayload,
  payloadBytes,
  truncateTitle,
  type PushSourceRow,
} from "@/lib/push-payload";
import { describeNotification, notificationHref } from "@/lib/notifications";

function row(overrides: Partial<PushSourceRow> = {}): PushSourceRow {
  return {
    type: "TASK_ASSIGNED",
    entityType: "TASK",
    entityId: "t1",
    actorName: "Dana Reeve",
    meta: { name: "Draft the brief" },
    ...overrides,
  };
}

const ALL_TYPES: NotificationType[] = [
  "TASK_ASSIGNED",
  "COMMENT_MENTION",
  "TASK_STATUS_CHANGED",
  "ANNOUNCEMENT_POSTED",
  "TASK_DUE_SOON",
  "EVENT_SCHEDULED",
];

describe("truncateTitle", () => {
  it("leaves a short title alone", () => {
    expect(truncateTitle("Draft the brief")).toBe("Draft the brief");
  });

  it("caps a pasted paragraph and marks it with an ellipsis", () => {
    const long = "x".repeat(200);
    const out = truncateTitle(long);
    expect(out).toHaveLength(MAX_TITLE_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(truncateTitle("  spaced  ")).toBe("spaced");
  });
});

describe("buildPushPayload", () => {
  // Consistency: the phone and the bell must say the same thing, or somebody
  // reads two different accounts of one event.
  it("says exactly what the bell says, for every notification type", () => {
    for (const type of ALL_TYPES) {
      const r = row({ type });
      expect(buildPushPayload(r).body).toBe(
        describeNotification({ type: r.type, actorName: r.actorName, meta: r.meta })
      );
    }
  });

  it("opens where the bell row links to", () => {
    const r = row();
    expect(buildPushPayload(r).url).toBe(
      notificationHref({ entityType: r.entityType, entityId: r.entityId, meta: r.meta })
    );
  });

  it("titles every notification with the app, putting the noun in the body", () => {
    expect(buildPushPayload(row()).title).toBe("Meridian Ops");
    expect(buildPushPayload(row()).body).toContain("Draft the brief");
  });

  it("tags by entity so repeats about one thing collapse on the device", () => {
    expect(buildPushPayload(row({ entityType: "TASK", entityId: "t9" })).tag).toBe("TASK:t9");
  });

  // THE security test for this module. `meta.excerpt` is a colleague's prose
  // about a client, and this payload lands on a lock screen and in the Android
  // system log. It is withheld structurally — describeNotification cannot read
  // that key — so this asserts the guarantee rather than the implementation.
  it("never carries the comment excerpt onto a device", () => {
    const sentinel = "SENSITIVE-CLIENT-PRICING-DETAIL-9f3a";
    const payload = buildPushPayload(
      row({
        type: "COMMENT_MENTION",
        meta: { name: "Draft the brief", excerpt: sentinel },
      })
    );
    expect(JSON.stringify(payload)).not.toContain(sentinel);
  });

  it("never carries the mentioned-user ids onto a device", () => {
    const payload = buildPushPayload(
      row({
        type: "COMMENT_MENTION",
        meta: { name: "Draft the brief", mentionedUserIds: ["u-secret-1", "u-secret-2"] },
      })
    );
    expect(JSON.stringify(payload)).not.toContain("u-secret-1");
    expect(JSON.stringify(payload)).not.toContain("mentionedUserIds");
  });

  it("exposes only title, body, url and tag — nothing else may be added silently", () => {
    expect(Object.keys(buildPushPayload(row())).sort()).toEqual(["body", "tag", "title", "url"]);
  });

  it("truncates a pasted paragraph of a title inside the sentence", () => {
    const payload = buildPushPayload(row({ meta: { name: "y".repeat(300) } }));
    expect(payload.body).toContain("…");
    expect(payload.body.length).toBeLessThan(140);
  });

  it("stays well under the push size limit even for a very long title", () => {
    const payload = buildPushPayload(row({ meta: { name: "z".repeat(500) } }));
    expect(payloadBytes(payload)).toBeLessThan(MAX_PAYLOAD_BYTES);
  });

  // Inherited from notifications.ts: describeNotification is total, so an
  // unrecognised type still renders a sentence rather than throwing on a
  // device nobody can debug.
  it("still renders a sentence for an unrecognised type", () => {
    const payload = buildPushPayload(row({ type: "SOMETHING_NEW" as NotificationType }));
    expect(payload.body.length).toBeGreaterThan(0);
    expect(payload.url.length).toBeGreaterThan(0);
  });

  it("survives a null meta and a null actor", () => {
    const payload = buildPushPayload(row({ meta: null, actorName: null }));
    expect(payload.body.length).toBeGreaterThan(0);
    expect(payload.title).toBe("Meridian Ops");
  });
});
