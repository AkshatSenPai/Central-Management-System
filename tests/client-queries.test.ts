import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { listClients, getClientDetail } from "@/lib/client-queries";

type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
};

function contact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: "ct1",
    name: "Dana Reeve",
    email: "dana@harlowfitch.com",
    phone: null,
    role: "Marketing Director",
    isPrimary: false,
    ...overrides,
  };
}

const DONE_AT = new Date("2026-06-12T00:00:00.000Z");

function fakeDb(parts: {
  clients?: unknown[];
  detail?: unknown;
  projects?: unknown[];
  milestones?: { projectId: string; completedAt: Date | null }[];
}) {
  let milestoneCalls = 0;
  const projectFindManyArgs: unknown[] = [];
  const db = {
    client: {
      findMany: async () => parts.clients ?? [],
      findUnique: async () => parts.detail ?? null,
    },
    project: {
      findMany: async (args: unknown) => {
        projectFindManyArgs.push(args);
        return parts.projects ?? [];
      },
    },
    task: {
      groupBy: async () => [],
    },
    milestone: {
      findMany: async () => {
        milestoneCalls++;
        return parts.milestones ?? [];
      },
    },
  } as unknown as PrismaClient;
  return { db, milestoneCalls: () => milestoneCalls, projectFindManyArgs };
}

describe("listClients", () => {
  it("carries initials derived from clientInitials", async () => {
    const { db } = fakeDb({
      clients: [
        { id: "c1", name: "Harlow & Fitch", status: "ACTIVE", sector: "Retail", contacts: [], projects: [] },
      ],
    });
    const rows = await listClients(db);
    expect(rows[0].initials).toBe("HF");
  });

  it("reports the isPrimary contact as primaryContact", async () => {
    const { db } = fakeDb({
      clients: [
        {
          id: "c1",
          name: "Harlow & Fitch",
          status: "ACTIVE",
          sector: null,
          contacts: [
            contact({ id: "ct1", name: "Tom Iversen" }),
            contact({ id: "ct2", isPrimary: true, phone: "+44 20 7946 0812" }),
          ],
          projects: [],
        },
      ],
    });
    const rows = await listClients(db);
    // Phone travels with the row: this studio reaches clients on both, and
    // the list is where you look someone up before calling them.
    expect(rows[0].primaryContact).toEqual({
      name: "Dana Reeve",
      email: "dana@harlowfitch.com",
      phone: "+44 20 7946 0812",
    });
  });

  it("carries a null phone rather than dropping the field", async () => {
    const { db } = fakeDb({
      clients: [
        {
          id: "c1",
          name: "Harlow & Fitch",
          status: "ACTIVE",
          sector: null,
          contacts: [contact({ isPrimary: true, phone: null })],
          projects: [],
        },
      ],
    });
    const rows = await listClients(db);
    expect(rows[0].primaryContact?.phone).toBeNull();
  });

  it("reports a null primaryContact when contacts exist but none is primary", async () => {
    const { db } = fakeDb({
      clients: [
        {
          id: "c1",
          name: "Harlow & Fitch",
          status: "ACTIVE",
          sector: null,
          contacts: [contact(), contact({ id: "ct2", name: "Tom Iversen" })],
          projects: [],
        },
      ],
    });
    const rows = await listClients(db);
    expect(rows[0].primaryContact).toBeNull();
  });

  it("excludes DONE projects from projectCount", async () => {
    const { db } = fakeDb({
      clients: [
        {
          id: "c1",
          name: "Harlow & Fitch",
          status: "ACTIVE",
          sector: null,
          contacts: [],
          projects: [{ status: "IN_PROGRESS" }, { status: "DONE" }, { status: "PLANNING" }],
        },
      ],
    });
    const rows = await listClients(db);
    expect(rows[0].projectCount).toBe(2);
  });
});

const detailRow = {
  id: "c1",
  name: "Harlow & Fitch",
  status: "ACTIVE",
  sector: "Retail & apparel",
  website: "https://harlowfitch.com",
  notes: null,
  engagementType: "Retainer",
  clientSince: new Date("2024-03-01T00:00:00.000Z"),
  accountLead: { id: "u1", name: "Sarah Whitfield" },
  contacts: [
    contact({ id: "ct1", name: "Zoe Adams" }),
    contact({ id: "ct2", name: "Tom Iversen" }),
    contact({ id: "ct3", name: "Dana Reeve", isPrimary: true }),
  ],
};

describe("getClientDetail", () => {
  it("lists every project including DONE, so completed work stays reachable", async () => {
    const { db, projectFindManyArgs } = fakeDb({
      detail: {
        id: "c1",
        name: "Harlow & Fitch",
        status: "ACTIVE",
        sector: null,
        website: null,
        notes: null,
        engagementType: null,
        clientSince: null,
        accountLead: null,
        contacts: [],
      },
    });
    await getClientDetail(db, "c1");
    expect((projectFindManyArgs[0] as { where: Record<string, unknown> }).where).not.toHaveProperty(
      "status"
    );
  });

  it("returns null for an unknown id", async () => {
    const { db } = fakeDb({});
    expect(await getClientDetail(db, "ghost")).toBeNull();
  });

  it("sorts contacts primary-first then by name", async () => {
    const { db } = fakeDb({ detail: detailRow });
    const detail = await getClientDetail(db, "c1");
    expect(detail?.contacts.map((c) => c.name)).toEqual(["Dana Reeve", "Tom Iversen", "Zoe Adams"]);
  });

  it("builds each project row's progress view from the same batched counts provider", async () => {
    const { db, milestoneCalls } = fakeDb({
      detail: detailRow,
      projects: [
        {
          id: "p1",
          name: "Brand Guidelines v3",
          clientId: "c1",
          status: "IN_PROGRESS",
          health: "AT_RISK",
          dueDate: new Date("2026-08-14T00:00:00.000Z"),
          progressMode: "AUTO",
          manualProgress: null,
          client: { name: "Harlow & Fitch" },
          _count: { milestones: 4 },
        },
      ],
      milestones: [
        { projectId: "p1", completedAt: DONE_AT },
        { projectId: "p1", completedAt: DONE_AT },
        { projectId: "p1", completedAt: null },
        { projectId: "p1", completedAt: null },
      ],
    });
    const detail = await getClientDetail(db, "c1");
    expect(detail?.projects[0].progress).toEqual({
      percent: 50,
      mode: "AUTO",
      hasUnits: true,
      label: "50%",
    });
    // One batched call for the whole project set, not one per row.
    expect(milestoneCalls()).toBe(1);
  });
});
