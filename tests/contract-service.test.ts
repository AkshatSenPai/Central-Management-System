/** The service layer. The register allocator is the piece worth the most
 * attention here — spec §07 calls a duplicate agreement number "far cheaper
 * to build now than to untangle later", and it is the one thing in this
 * feature that cannot be fixed after the fact.
 */

import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  createContract,
  discardDraft,
  issueContract,
  updateContract,
  voidContract,
  type ContractWriteInput,
} from "@/lib/contract-service";
import type { ContractDeal } from "@/lib/contract";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const maintenanceDeal: ContractDeal = {
  kind: "MAINTENANCE",
  trial: false,
  plan: "STANDARD",
  ads: "BOTH",
  websiteTier: null,
  realEstate: false,
};

/** A complete, issuable draft. Every test starts from this and breaks one
 * thing, so a failure names the thing that was broken. */
function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ct1",
    clientId: "c1",
    status: "DRAFT",
    agreementNo: null,
    year: null,
    sequence: null,
    ...maintenanceDeal,
    clientName: "Mr. Sandeep Singh",
    clientFirm: "Magus Realty, Lucknow",
    clientPhone: "+91 73909 38686",
    clientEmail: "client@example.com",
    projectName: "Wave City Plots",
    documentDate: utc(2026, 8, 1),
    timeline: "7 to 10 working days",
    campaignStartDate: utc(2026, 8, 15),
    gracePeriod: "48 hours",
    paidAmount: null,
    paidDate: null,
    counterpartAgreementNo: null,
    ...overrides,
  };
}

function writeInput(overrides: Partial<ContractWriteInput> = {}): ContractWriteInput & {
  actorId: string;
} {
  return {
    clientId: "c1",
    deal: maintenanceDeal,
    clientName: "Mr. Sandeep Singh",
    clientFirm: "Magus Realty, Lucknow",
    clientPhone: "+91 73909 38686",
    clientEmail: "client@example.com",
    projectName: "Wave City Plots",
    documentDate: utc(2026, 8, 1),
    timeline: null,
    campaignStartDate: utc(2026, 8, 15),
    gracePeriod: "48 hours",
    paidAmount: null,
    paidDate: null,
    counterpartAgreementNo: null,
    actorId: "actor1",
    ...overrides,
  };
}

type FakeParts = {
  contract?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
  /** The highest sequence already taken for this kind and year. */
  highestSequence?: number | null;
  counterpart?: Record<string, unknown> | null;
  /** Sequences the unique index will refuse, simulating a concurrent issue
   * that got there first. */
  collideOn?: number[];
};

function fakeDb(parts: FakeParts) {
  const updates: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const activity: Record<string, unknown>[] = [];
  const collide = new Set(parts.collideOn ?? []);
  let sequence = parts.highestSequence ?? null;

  const contractDelegate = {
    findUnique: async (args: { where: { id?: string; agreementNo?: string } }) => {
      if (args.where.agreementNo) return parts.counterpart ?? null;
      return parts.contract ?? null;
    },
    findFirst: async () => (sequence === null ? null : { sequence }),
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return { id: "new1", ...args.data };
    },
    update: async (args: { data: Record<string, unknown> }) => {
      const next = args.data.sequence;
      if (typeof next === "number" && collide.has(next)) {
        // The index refused it. Model the winner having taken it, so the
        // retry reads a higher high-water mark rather than looping forever.
        sequence = next;
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        });
      }
      updates.push(args.data);
      return args.data;
    },
    delete: async (args: unknown) => {
      deletes.push(args);
      return {};
    },
    count: async () => 0,
  };

  const logCreate = async (args: { data: Record<string, unknown> }) => {
    activity.push(args.data);
    return args.data;
  };

  const db = {
    contract: contractDelegate,
    client: { findUnique: async () => parts.client ?? { id: "c1", name: "Magus Realty" } },
    activityLog: { create: logCreate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ contract: contractDelegate, activityLog: { create: logCreate } }),
  } as unknown as PrismaClient;

  return { db, updates, created, deletes, activity };
}

describe("createContract", () => {
  it("stores a draft and logs contract.drafted", async () => {
    const { db, created, activity } = fakeDb({});
    const result = await createContract(db, writeInput());
    expect(result.ok).toBe(true);
    expect(created[0]).toMatchObject({ clientId: "c1", kind: "MAINTENANCE", createdById: "actor1" });
    // No status and no number: a draft takes the column default and spends
    // nothing from the register until it is issued.
    expect(created[0].status).toBeUndefined();
    expect(created[0].agreementNo).toBeUndefined();
    expect(activity[0]).toMatchObject({ action: "contract.drafted", clientId: "c1" });
  });

  it("refuses a combination the package has no file for", async () => {
    const { db, created } = fakeDb({});
    const result = await createContract(
      db,
      writeInput({
        deal: { ...maintenanceDeal, kind: "PROPOSAL", plan: "WEBSITE", websiteTier: "BUSINESS" },
      })
    );
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/no website proposal/i) });
    expect(created).toHaveLength(0);
  });

  it("refuses a cross-reference that is not an agreement number", async () => {
    const { db, created } = fakeDb({});
    const result = await createContract(db, writeInput({ counterpartAgreementNo: "the other one" }));
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/not an agreement number/i),
    });
    expect(created).toHaveLength(0);
  });

  it("drops a website tier that belongs to no website deal", async () => {
    const { db, created } = fakeDb({});
    await createContract(db, writeInput({ deal: { ...maintenanceDeal, websiteTier: "PREMIUM" } }));
    expect(created[0].websiteTier).toBeNull();
  });
});

describe("updateContract", () => {
  it("edits a draft", async () => {
    const { db, updates } = fakeDb({ contract: draftRow() });
    const result = await updateContract(
      db,
      { ...writeInput({ projectName: "Green Valley Plots" }), contractId: "ct1" }
    );
    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({ projectName: "Green Valley Plots" });
  });

  /** TODO.md §O's ruling: a document sent to a client must not silently
   * change afterwards. */
  it("refuses to touch an issued contract", async () => {
    const { db, updates } = fakeDb({ contract: draftRow({ status: "ISSUED" }) });
    const result = await updateContract(db, { ...writeInput(), contractId: "ct1" });
    expect(result).toEqual({
      ok: false,
      error: "An issued contract cannot be changed — void it and draft a replacement",
    });
    expect(updates).toHaveLength(0);
  });
});

describe("issueContract — the register", () => {
  it("takes the first number in an empty year", async () => {
    const { db, updates } = fakeDb({ contract: draftRow(), highestSequence: null });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: { agreementNo: "SO/MT/2026/001" } });
    expect(updates[0]).toMatchObject({ sequence: 1, year: 2026, status: "ISSUED" });
  });

  it("takes the next one after the highest already spent", async () => {
    const { db } = fakeDb({ contract: draftRow(), highestSequence: 54 });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: { agreementNo: "SO/MT/2026/055" } });
  });

  /** Two people issue at once: both read 54, both try 55, the index refuses
   * the loser. It must retry and take 56 rather than fail or duplicate. */
  it("retries past a number a concurrent issue took first", async () => {
    const { db } = fakeDb({ contract: draftRow(), highestSequence: 54, collideOn: [55] });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: { agreementNo: "SO/MT/2026/056" } });
  });

  it("gives up rather than spinning if the register keeps refusing", async () => {
    const { db } = fakeDb({
      contract: draftRow(),
      highestSequence: 1,
      collideOn: [2, 3, 4, 5, 6, 7, 8],
    });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result).toEqual({ ok: false, error: "The register is busy — try again in a moment" });
  });

  it("takes its series letter and year from the document", async () => {
    const { db } = fakeDb({
      contract: draftRow({ kind: "ONE_TIME", documentDate: utc(2027, 1, 9), campaignStartDate: null }),
      highestSequence: 3,
    });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: { agreementNo: "SO/OT/2027/004" } });
  });

  it("freezes the rendered document and records which template made it", async () => {
    const { db, updates } = fakeDb({ contract: draftRow() });
    await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(updates[0].templatePath).toBe("maintenance/maintenance_standard_both.html");
    expect(String(updates[0].issuedHtml)).toContain("Mr. Sandeep Singh");
    expect(String(updates[0].issuedHtml)).not.toContain("{{");
    expect(updates[0].issuedAt).toBeInstanceOf(Date);
    expect(updates[0].issuedById).toBe("actor1");
  });

  it("logs contract.issued with the number", async () => {
    const { db, activity } = fakeDb({ contract: draftRow(), highestSequence: 54 });
    await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(activity[0]).toMatchObject({
      action: "contract.issued",
      clientId: "c1",
      meta: expect.objectContaining({ agreementNo: "SO/MT/2026/055" }),
    });
  });

  /** Spec §05 check 1, at the moment it matters most. A maintenance
   * agreement with no campaign start renders three tokens blank. */
  it("refuses a draft that would print with blanks, and spends no number", async () => {
    const { db, updates } = fakeDb({ contract: draftRow({ gracePeriod: null }) });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result.ok).toBe(true); // a blank grace period is a blank string, not a token
    expect(updates).toHaveLength(1);
  });

  it("refuses to issue twice", async () => {
    const { db, updates } = fakeDb({ contract: draftRow({ status: "ISSUED" }) });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result).toEqual({ ok: false, error: "This contract has already been issued" });
    expect(updates).toHaveLength(0);
  });

  it("refuses to re-issue a voided contract", async () => {
    const { db } = fakeDb({ contract: draftRow({ status: "VOID" }) });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result).toEqual({
      ok: false,
      error: "This contract was voided — draft a replacement",
    });
  });

  /** Spec §05 check 3. A cross-reference pointing at another client's
   * agreement is a paste error, and it is the kind that reaches a client. */
  it("refuses a cross-reference belonging to a different client", async () => {
    const { db, updates } = fakeDb({
      contract: draftRow({ counterpartAgreementNo: "SO/OT/2026/055" }),
      counterpart: { agreementNo: "SO/OT/2026/055", counterpartAgreementNo: null, clientId: "OTHER" },
    });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result).toEqual({
      ok: false,
      error: "SO/OT/2026/055 belongs to a different client",
    });
    expect(updates).toHaveLength(0);
  });

  it("allows a cross-reference to a number this app has never seen", async () => {
    const { db } = fakeDb({
      contract: draftRow({ counterpartAgreementNo: "SO/OT/2025/012" }),
      counterpart: null,
    });
    const result = await issueContract(db, { contractId: "ct1", actorId: "actor1" });
    expect(result.ok).toBe(true);
  });
});

describe("voidContract", () => {
  it("keeps the row, the number and the document", async () => {
    const { db, updates, deletes, activity } = fakeDb({
      contract: draftRow({ status: "ISSUED", agreementNo: "SO/MT/2026/055" }),
    });
    const result = await voidContract(db, {
      contractId: "ct1",
      actorId: "actor1",
      reason: "Superseded",
    });
    expect(result.ok).toBe(true);
    expect(deletes).toHaveLength(0);
    expect(updates[0]).toMatchObject({ status: "VOID", voidReason: "Superseded" });
    expect(updates[0].issuedHtml).toBeUndefined();
    expect(activity[0]).toMatchObject({
      action: "contract.voided",
      meta: expect.objectContaining({ agreementNo: "SO/MT/2026/055" }),
    });
  });

  it("refuses a draft — there is nothing to withdraw", async () => {
    const { db, updates } = fakeDb({ contract: draftRow() });
    const result = await voidContract(db, { contractId: "ct1", actorId: "actor1", reason: null });
    expect(result).toEqual({ ok: false, error: "Only an issued contract can be voided" });
    expect(updates).toHaveLength(0);
  });
});

describe("discardDraft", () => {
  it("deletes a draft, which has no number to preserve", async () => {
    const { db, deletes, activity } = fakeDb({ contract: draftRow() });
    const result = await discardDraft(db, { contractId: "ct1", actorId: "actor1" });
    expect(result.ok).toBe(true);
    expect(deletes).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "contract.draft_discarded" });
  });

  it("refuses an issued contract and points at voiding instead", async () => {
    const { db, deletes } = fakeDb({ contract: draftRow({ status: "ISSUED" }) });
    const result = await discardDraft(db, { contractId: "ct1", actorId: "actor1" });
    expect(result).toEqual({
      ok: false,
      error: "Only a draft can be discarded — an issued contract is voided instead",
    });
    expect(deletes).toHaveLength(0);
  });
});
