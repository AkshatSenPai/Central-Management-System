import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  deleteDeadSubscription,
  deletePushSubscription,
  hashEndpoint,
  savePushSubscription,
} from "@/lib/push-subscription-service";

type UpsertArgs = {
  where: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

/** A fake standing in for the one delegate these functions touch, plus a tiny
 * in-memory table so "does re-subscribing add a second row?" is answerable
 * rather than merely asserted about arguments. */
function fakeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const upserts: UpsertArgs[] = [];
  const deleteManyArgs: Record<string, unknown>[] = [];

  const db = {
    pushSubscription: {
      upsert: async (args: UpsertArgs) => {
        upserts.push(args);
        const key = String(args.where.endpointHash);
        const existing = rows.get(key);
        if (existing) rows.set(key, { ...existing, ...args.update });
        else rows.set(key, { id: `row${rows.size + 1}`, ...args.create });
        return { id: rows.get(key)!.id as string };
      },
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        deleteManyArgs.push(args.where);
        let count = 0;
        for (const [key, row] of [...rows]) {
          const matchesHash =
            args.where.endpointHash === undefined || row.endpointHash === args.where.endpointHash;
          const matchesUser = args.where.userId === undefined || row.userId === args.where.userId;
          const matchesId = args.where.id === undefined || row.id === args.where.id;
          if (matchesHash && matchesUser && matchesId) {
            rows.delete(key);
            count++;
          }
        }
        return { count };
      },
    },
  } as unknown as PrismaClient;

  return { db, rows, upserts, deleteManyArgs };
}

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const base = { endpoint: ENDPOINT, p256dh: "p256key", auth: "authsecret" };

describe("hashEndpoint", () => {
  it("hashes deterministically to 64 hex characters", () => {
    const a = hashEndpoint(ENDPOINT);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEndpoint(ENDPOINT)).toBe(a);
    expect(hashEndpoint(`${ENDPOINT}x`)).not.toBe(a);
  });

  // The reason the hash exists at all: a unique btree index refuses entries
  // much over 2704 bytes, and the Push API sets no endpoint length limit.
  it("is a fixed length however long the endpoint is", () => {
    expect(hashEndpoint(`https://push.example/${"x".repeat(5000)}`)).toHaveLength(64);
  });
});

describe("savePushSubscription", () => {
  it("stores a new subscription against its owner", async () => {
    const { db, rows } = fakeDb();
    const result = await savePushSubscription(db, { userId: "u1", ...base });

    expect(result.ok).toBe(true);
    expect(rows.size).toBe(1);
    expect([...rows.values()][0]).toMatchObject({ userId: "u1", endpoint: ENDPOINT });
  });

  it("re-subscribing the same browser updates one row rather than adding a second", async () => {
    const { db, rows } = fakeDb();
    await savePushSubscription(db, { userId: "u1", ...base });
    await savePushSubscription(db, { userId: "u1", ...base, p256dh: "rotated" });

    expect(rows.size).toBe(1);
    expect([...rows.values()][0]).toMatchObject({ p256dh: "rotated" });
  });

  // THE security test. A browser profile holds one subscription, so a second
  // person signing in on a shared laptop gets handed the same endpoint. If
  // this kept both rows, every mention meant for the new person would also be
  // delivered to a device the previous person still has.
  it("moves the device when a second person subscribes on a shared machine", async () => {
    const { db, rows, upserts } = fakeDb();
    await savePushSubscription(db, { userId: "u1", ...base });
    await savePushSubscription(db, { userId: "u2", ...base });

    expect(rows.size).toBe(1);
    expect([...rows.values()][0]).toMatchObject({ userId: "u2" });
    // The key is the endpoint hash alone — never (userId, endpointHash).
    expect(Object.keys(upserts[1].where)).toEqual(["endpointHash"]);
    expect(upserts[1].update).toMatchObject({ userId: "u2" });
  });

  it("refuses a subscription missing either key, so no undeliverable route is stored", async () => {
    const { db, rows } = fakeDb();
    expect((await savePushSubscription(db, { userId: "u1", ...base, p256dh: "" })).ok).toBe(false);
    expect((await savePushSubscription(db, { userId: "u1", ...base, auth: "  " })).ok).toBe(false);
    expect((await savePushSubscription(db, { userId: "u1", ...base, endpoint: "" })).ok).toBe(false);
    expect(rows.size).toBe(0);
  });

  it("clamps the user-agent label and tolerates its absence", async () => {
    const { db, rows } = fakeDb();
    await savePushSubscription(db, { userId: "u1", ...base, userAgent: "U".repeat(1000) });
    expect(String([...rows.values()][0].userAgent)).toHaveLength(255);

    const second = fakeDb();
    await savePushSubscription(second.db, { userId: "u1", ...base });
    expect([...second.rows.values()][0].userAgent).toBeNull();
  });
});

describe("deletePushSubscription", () => {
  // The where clause IS the authorisation check — there is no separate
  // ownership read that could pass while the delete targets something else.
  it("scopes the delete to the owner", async () => {
    const { db, deleteManyArgs } = fakeDb();
    await deletePushSubscription(db, { userId: "u1", endpoint: ENDPOINT });
    expect(deleteManyArgs[0]).toEqual({ endpointHash: hashEndpoint(ENDPOINT), userId: "u1" });
  });

  it("cannot remove a device belonging to somebody else", async () => {
    const { db, rows } = fakeDb();
    await savePushSubscription(db, { userId: "u1", ...base });
    await deletePushSubscription(db, { userId: "u2", endpoint: ENDPOINT });
    expect(rows.size).toBe(1);
  });

  it("reports success when there was nothing to remove", async () => {
    const { db } = fakeDb();
    expect((await deletePushSubscription(db, { userId: "u1", endpoint: ENDPOINT })).ok).toBe(true);
  });
});

describe("deleteDeadSubscription", () => {
  it("removes by id alone, since the push service has already judged the row", async () => {
    const { db, rows, deleteManyArgs } = fakeDb();
    await savePushSubscription(db, { userId: "u1", ...base });
    const id = [...rows.values()][0].id as string;

    await deleteDeadSubscription(db, id);
    expect(deleteManyArgs[0]).toEqual({ id });
    expect(rows.size).toBe(0);
  });

  // Runs inside after(), where a P2025 from a row a concurrent unsubscribe
  // already removed would be an unhandled rejection nobody catches.
  it("does not throw when the row is already gone", async () => {
    const { db } = fakeDb();
    await expect(deleteDeadSubscription(db, "missing")).resolves.toBeUndefined();
  });
});
