/** Contract reads. Selects are explicit everywhere — `issuedHtml` is 30-90 KB
 * per row and must never ride along on a list query, which is the one thing a
 * `select`-less `findMany` here would quietly do.
 */

import type { PrismaClient } from "@prisma/client";
import type { ContractDeal, ContractKind, ContractStatus } from "@/lib/contract";

/** Enough for a row: what it is, where it is, and its number if it has one. */
const LIST_SELECT = {
  id: true,
  kind: true,
  trial: true,
  plan: true,
  ads: true,
  websiteTier: true,
  realEstate: true,
  status: true,
  agreementNo: true,
  projectName: true,
  clientFirm: true,
  documentDate: true,
  issuedAt: true,
  createdAt: true,
} as const;

export type ContractListRow = {
  id: string;
  deal: ContractDeal;
  status: ContractStatus;
  agreementNo: string | null;
  projectName: string;
  clientFirm: string;
  documentDate: Date;
  issuedAt: Date | null;
  createdAt: Date;
};

type RawListRow = {
  id: string;
  kind: ContractKind;
  trial: boolean;
  plan: ContractDeal["plan"];
  ads: ContractDeal["ads"];
  websiteTier: ContractDeal["websiteTier"];
  realEstate: boolean;
  status: ContractStatus;
  agreementNo: string | null;
  projectName: string;
  clientFirm: string;
  documentDate: Date;
  issuedAt: Date | null;
  createdAt: Date;
};

/** The six deal columns travel together everywhere — the resolver, the
 * summary line, the badge — so they are lifted into one object at the query
 * boundary rather than spread across every component that renders them. */
function toListRow(row: RawListRow): ContractListRow {
  return {
    id: row.id,
    deal: {
      kind: row.kind,
      trial: row.trial,
      plan: row.plan,
      ads: row.ads,
      websiteTier: row.websiteTier,
      realEstate: row.realEstate,
    },
    status: row.status,
    agreementNo: row.agreementNo,
    projectName: row.projectName,
    clientFirm: row.clientFirm,
    documentDate: row.documentDate,
    issuedAt: row.issuedAt,
    createdAt: row.createdAt,
  };
}

/** Newest first — a contract list is read to answer "what did we last send
 * them", not to be scrolled from the beginning. */
export async function listClientContracts(
  db: PrismaClient,
  clientId: string
): Promise<ContractListRow[]> {
  const rows = await db.contract.findMany({
    where: { clientId },
    select: LIST_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toListRow);
}

export type RegisterRow = ContractListRow & { clientId: string; clientName: string };

/** The register: every contract, across every client. Spec §07's "one thing
 * worth building early" — the numbers are the only way to tie a signed PDF
 * back to a deal, so there is a page that lists them. */
export async function listContracts(
  db: PrismaClient,
  filter: { status?: ContractStatus } = {}
): Promise<RegisterRow[]> {
  const rows = await db.contract.findMany({
    where: filter.status ? { status: filter.status } : {},
    select: { ...LIST_SELECT, clientId: true, client: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    ...toListRow(row),
    clientId: row.clientId,
    clientName: row.client.name,
  }));
}

/** The full row, for the detail page and the editor. `issuedHtml` is
 * deliberately NOT selected — the detail page renders a live preview for a
 * draft and the print route is what serves the frozen copy, so nothing on the
 * detail page needs 90 KB of markup it will not display. */
export async function getContractDetail(db: PrismaClient, contractId: string) {
  return db.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      clientId: true,
      client: { select: { id: true, name: true } },
      kind: true,
      trial: true,
      plan: true,
      ads: true,
      websiteTier: true,
      realEstate: true,
      status: true,
      agreementNo: true,
      clientName: true,
      clientFirm: true,
      clientPhone: true,
      clientEmail: true,
      projectName: true,
      documentDate: true,
      timeline: true,
      campaignStartDate: true,
      gracePeriod: true,
      paidAmount: true,
      paidDate: true,
      counterpartAgreementNo: true,
      templatePath: true,
      issuedAt: true,
      issuedBy: { select: { name: true } },
      voidedAt: true,
      voidReason: true,
      createdBy: { select: { name: true } },
      createdAt: true,
    },
  });
}

export type ContractDetail = NonNullable<Awaited<ReturnType<typeof getContractDetail>>>;

/** The frozen document, and only it. Its own query so that the 90 KB column
 * is fetched exactly when it is about to be streamed to a browser and never
 * as a side effect of reading anything else. */
export async function getIssuedHtml(
  db: PrismaClient,
  contractId: string
): Promise<{ html: string; agreementNo: string | null; status: ContractStatus } | null> {
  const row = await db.contract.findUnique({
    where: { id: contractId },
    select: { issuedHtml: true, agreementNo: true, status: true },
  });
  if (!row?.issuedHtml) return null;
  return { html: row.issuedHtml, agreementNo: row.agreementNo, status: row.status };
}

/** Every agreement number already spent, for the cross-reference picker on
 * the form — typing one by hand is how they end up mismatched. */
export async function listAgreementNumbers(
  db: PrismaClient,
  input: { clientId: string; excludeContractId?: string }
): Promise<{ id: string; agreementNo: string; kind: ContractKind }[]> {
  const rows = await db.contract.findMany({
    where: {
      clientId: input.clientId,
      agreementNo: { not: null },
      ...(input.excludeContractId ? { id: { not: input.excludeContractId } } : {}),
    },
    select: { id: true, agreementNo: true, kind: true },
    orderBy: { agreementNo: "asc" },
  });
  return rows.map((r) => ({ id: r.id, agreementNo: r.agreementNo!, kind: r.kind }));
}
