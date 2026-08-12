/** Contract writes: draft, edit, issue, void, discard.
 *
 * The one interesting function here is `issueContract`. Everything else is
 * the ordinary shape this codebase already uses — validate, transact, log.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import {
  CONTRACT_KIND_LABEL,
  dealProblem,
  dealSummary,
  formatAgreementNo,
  type ContractDeal,
} from "@/lib/contract";
import {
  crossReferenceShapeProblem,
  type ContractFacts,
  type RenderProblem,
} from "@/lib/contract-render";
import { loadRealEstateClauses, renderContract } from "@/lib/contract-template";

/** What a person typed, after the action layer has parsed dates. */
export type ContractWriteInput = {
  clientId: string;
  deal: ContractDeal;
  clientName: string;
  clientFirm: string;
  clientPhone: string | null;
  clientEmail: string | null;
  projectName: string;
  documentDate: Date;
  timeline: string | null;
  campaignStartDate: Date | null;
  gracePeriod: string | null;
  paidAmount: string | null;
  paidDate: Date | null;
  counterpartAgreementNo: string | null;
};

const NOT_FOUND = "Contract not found";
const NOT_A_DRAFT = "An issued contract cannot be changed — void it and draft a replacement";

/** A one-line name for the timeline and the activity feed. */
function describeContract(deal: ContractDeal): string {
  return `${CONTRACT_KIND_LABEL[deal.kind]} — ${dealSummary(deal)}`;
}

/** The fields that are common to every write, so create and update cannot
 * drift into storing different subsets of the same form. */
function writeData(input: ContractWriteInput) {
  return {
    kind: input.deal.kind,
    trial: input.deal.trial,
    plan: input.deal.plan,
    ads: input.deal.ads,
    websiteTier: input.deal.plan === "WEBSITE" ? input.deal.websiteTier : null,
    realEstate: input.deal.realEstate,
    clientName: input.clientName.trim(),
    clientFirm: input.clientFirm.trim(),
    clientPhone: input.clientPhone || null,
    clientEmail: input.clientEmail || null,
    projectName: input.projectName.trim(),
    documentDate: input.documentDate,
    timeline: input.timeline || null,
    campaignStartDate: input.campaignStartDate,
    gracePeriod: input.gracePeriod || null,
    paidAmount: input.paidAmount || null,
    paidDate: input.paidDate,
    counterpartAgreementNo: input.counterpartAgreementNo || null,
  };
}

/** Refuses anything the template package has no file for, plus a
 * cross-reference that is not an agreement number. Both are cheap and both
 * are far better caught here than at issue time, when someone is one click
 * from sending the thing. */
function inputProblem(input: ContractWriteInput): string | null {
  return dealProblem(input.deal) ?? crossReferenceShapeProblem(input.counterpartAgreementNo);
}

export async function createContract(
  db: PrismaClient,
  input: ContractWriteInput & { actorId: string }
): Promise<ActionResult<{ id: string }>> {
  const problem = inputProblem(input);
  if (problem) return err(problem);

  const client = await db.client.findUnique({ where: { id: input.clientId } });
  if (!client) return err("Client not found");

  const created = await db.$transaction(async (tx) => {
    const contract = await tx.contract.create({
      data: { ...writeData(input), clientId: input.clientId, createdById: input.actorId },
    });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CONTRACT",
      entityId: contract.id,
      action: "contract.drafted",
      clientId: input.clientId,
      meta: { name: describeContract(input.deal) },
    });
    return contract;
  });
  return ok({ id: created.id });
}

/** Drafts only. An issued document is the record of what was sent and does
 * not change afterwards — `TODO.md` §O's own ruling, and the reason `status`
 * is checked here rather than trusted from the caller. */
export async function updateContract(
  db: PrismaClient,
  input: ContractWriteInput & { contractId: string; actorId: string }
): Promise<ActionResult> {
  const problem = inputProblem(input);
  if (problem) return err(problem);

  const before = await db.contract.findUnique({ where: { id: input.contractId } });
  if (!before) return err(NOT_FOUND);
  if (before.status !== "DRAFT") return err(NOT_A_DRAFT);

  // No activity row: a draft is working material, and logging every keystroke
  // session would bury the three events that matter. See the note on the
  // contract verbs in activity.ts.
  await db.contract.update({ where: { id: input.contractId }, data: writeData(input) });
  return ok(undefined);
}

/** Reads a stored row back into the shape the renderer wants. One function,
 * so the preview and the issued document are built from identical facts —
 * if these ever diverged, what someone approved and what got frozen would be
 * two different documents. */
export function factsFromRow(
  row: {
    kind: ContractDeal["kind"];
    trial: boolean;
    plan: ContractDeal["plan"];
    ads: ContractDeal["ads"];
    websiteTier: ContractDeal["websiteTier"];
    realEstate: boolean;
    clientName: string;
    clientFirm: string;
    clientPhone: string | null;
    clientEmail: string | null;
    projectName: string;
    documentDate: Date;
    timeline: string | null;
    campaignStartDate: Date | null;
    gracePeriod: string | null;
    paidAmount: string | null;
    paidDate: Date | null;
    counterpartAgreementNo: string | null;
  },
  agreementNo: string,
  realEstateClauses: string | null
): ContractFacts {
  return {
    deal: {
      kind: row.kind,
      trial: row.trial,
      plan: row.plan,
      ads: row.ads,
      websiteTier: row.websiteTier,
      realEstate: row.realEstate,
    },
    agreementNo,
    clientName: row.clientName,
    clientFirm: row.clientFirm,
    clientPhone: row.clientPhone,
    clientEmail: row.clientEmail,
    projectName: row.projectName,
    documentDate: row.documentDate,
    timeline: row.timeline,
    campaignStartDate: row.campaignStartDate,
    gracePeriod: row.gracePeriod,
    paidAmount: row.paidAmount,
    paidDate: row.paidDate,
    counterpartAgreementNo: row.counterpartAgreementNo,
    realEstateClauses,
  };
}

/** The number a draft *would* get, used for the preview so that what someone
 * approves looks like what they will send. It is not reserved — two people
 * previewing at once see the same number and only one of them will get it,
 * which is correct: a preview is not a claim on the register. */
export const PROVISIONAL_AGREEMENT_NO = "SO/__/____/___";

/** Spec §07 step 3: "Allocate agreement numbers from a running register —
 * never reuse one."
 *
 * Max-plus-one inside the issuing transaction, guarded by the unique index on
 * (kind, year, sequence). Two simultaneous issues both read 54 and both try
 * 55; the index refuses the loser, which retries and gets 56. That is why the
 * retry loop exists and why it is around the whole transaction rather than
 * around the read — re-reading inside a doomed transaction would just produce
 * 55 again.
 *
 * A Postgres sequence was the alternative and was rejected: sequences are not
 * transactional, so an issue that rolled back for any other reason would burn
 * a number and leave a hole in a register whose entire purpose is not having
 * holes. */
async function nextSequence(
  tx: Prisma.TransactionClient,
  kind: ContractDeal["kind"],
  year: number
): Promise<number> {
  const highest = await tx.contract.findFirst({
    where: { kind, year },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (highest?.sequence ?? 0) + 1;
}

const MAX_ALLOCATION_ATTEMPTS = 5;

/** The §05 checks produce a list, and `ActionResult` carries one string.
 * Joined here rather than widened there: every other refusal in this app is
 * one sentence, and a second error shape would make every `ActionResult`
 * consumer ask which kind it had. The draft page shows the same problems as a
 * list next to the preview, so nobody has to read this string to fix them —
 * it is the refusal, not the diagnosis. */
function describeProblems(problems: RenderProblem[]): string {
  return problems.map((p) => `${p.check}: ${p.detail}`).join(" · ");
}

/** Issue: allocate a number, render, freeze.
 *
 * Ordering, and each step is where it is for a reason:
 *
 * 1. **Validate outside the transaction.** The document is rendered once with
 *    a placeholder number purely to run spec §05's checks. Nothing but
 *    `{{AGREEMENT_NO}}` depends on the real number, and that token cannot
 *    introduce a validation problem — it is a string this file generates.
 *    Doing it here means a contract with a blank phone number is refused
 *    without ever opening a transaction or touching the register.
 * 2. **Warm the template cache.** That first render also pulls the template
 *    and snippet off disk, so the render inside the transaction is a map
 *    lookup. The transaction never waits on IO it could have done earlier —
 *    the same rule `notification-service.ts` states for network calls.
 * 3. **Allocate, render, write — all inside one transaction.** The number and
 *    the frozen document land together or not at all.
 */
export async function issueContract(
  db: PrismaClient,
  input: { contractId: string; actorId: string }
): Promise<ActionResult<{ agreementNo: string }>> {
  const row = await db.contract.findUnique({ where: { id: input.contractId } });
  if (!row) return err(NOT_FOUND);
  if (row.status === "ISSUED") return err("This contract has already been issued");
  if (row.status === "VOID") return err("This contract was voided — draft a replacement");

  const deal: ContractDeal = {
    kind: row.kind,
    trial: row.trial,
    plan: row.plan,
    ads: row.ads,
    websiteTier: row.websiteTier,
    realEstate: row.realEstate,
  };
  const problem = dealProblem(deal);
  if (problem) return err(problem);

  const clauses = await loadRealEstateClauses(deal);

  // Step 1 and 2.
  const dryRun = await renderContract(factsFromRow(row, PROVISIONAL_AGREEMENT_NO, clauses));
  if (dryRun.problems.length > 0) {
    return err(`This contract cannot be issued yet — ${describeProblems(dryRun.problems)}`);
  }

  // Spec §05 check 3, and it needs the other half of the pair, so it cannot
  // live in `validateRendered`. Only a *wrong* cross-reference is refused; a
  // blank one is normal, because the one-time agreement is routinely written
  // before the maintenance agreement it points at exists.
  if (row.counterpartAgreementNo) {
    const counterpart = await db.contract.findUnique({
      where: { agreementNo: row.counterpartAgreementNo },
      select: { agreementNo: true, counterpartAgreementNo: true, clientId: true },
    });
    if (counterpart && counterpart.clientId !== row.clientId) {
      return err(`${row.counterpartAgreementNo} belongs to a different client`);
    }
  }

  const year = row.documentDate.getUTCFullYear();

  for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    try {
      const agreementNo = await db.$transaction(async (tx) => {
        const sequence = await nextSequence(tx, row.kind, year);
        const number = formatAgreementNo(row.kind, year, sequence);

        // Step 3. A cache hit — see the note above.
        const rendered = await renderContract(factsFromRow(row, number, clauses));
        if (rendered.problems.length > 0) {
          // Unreachable unless the dry run and this one disagree, which would
          // mean the number itself changed the outcome. Throwing rolls the
          // allocation back rather than issuing a document that failed a
          // check nobody saw fail.
          throw new Error(
            `issueContract: validation passed the dry run and failed the real one: ${rendered.problems
              .map((p) => `${p.check}: ${p.detail}`)
              .join("; ")}`
          );
        }

        await tx.contract.update({
          where: { id: row.id },
          data: {
            status: "ISSUED",
            agreementNo: number,
            year,
            sequence,
            templatePath: rendered.templatePath,
            issuedHtml: rendered.html,
            issuedAt: new Date(),
            issuedById: input.actorId,
          },
        });
        await recordActivity(tx, {
          actorId: input.actorId,
          entityType: "CONTRACT",
          entityId: row.id,
          action: "contract.issued",
          clientId: row.clientId,
          meta: { name: describeContract(deal), agreementNo: number },
        });
        return number;
      });
      return ok({ agreementNo });
    } catch (e) {
      // Someone else took this sequence between the read and the write. Any
      // other failure is not a race and must not be retried — retrying a
      // genuine error four more times just makes it slower.
      //
      // A P2002 on the LAST attempt falls out of the loop rather than
      // rethrowing. That distinction is the whole reason the loop is written
      // this way: rethrowing would put a raw "Unique constraint failed" in
      // front of somebody trying to issue a contract, which names a database
      // index rather than telling them to press the button again.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  return err("The register is busy — try again in a moment");
}

/** Withdraw an issued contract. The row, its number and its frozen document
 * all stay: this records that it was withdrawn, it does not erase it. */
export async function voidContract(
  db: PrismaClient,
  input: { contractId: string; actorId: string; reason: string | null }
): Promise<ActionResult> {
  const row = await db.contract.findUnique({ where: { id: input.contractId } });
  if (!row) return err(NOT_FOUND);
  if (row.status !== "ISSUED") return err("Only an issued contract can be voided");

  await db.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: row.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: input.reason || null },
    });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CONTRACT",
      entityId: row.id,
      action: "contract.voided",
      clientId: row.clientId,
      meta: {
        name: describeContract({
          kind: row.kind,
          trial: row.trial,
          plan: row.plan,
          ads: row.ads,
          websiteTier: row.websiteTier,
          realEstate: row.realEstate,
        }),
        agreementNo: row.agreementNo,
        reason: input.reason,
      },
    });
  });
  return ok(undefined);
}

/** Drafts only, and it really does delete. A draft has no number and was
 * never sent anywhere, so there is nothing to preserve — unlike an issued
 * contract, which is voided instead. */
export async function discardDraft(
  db: PrismaClient,
  input: { contractId: string; actorId: string }
): Promise<ActionResult> {
  const row = await db.contract.findUnique({ where: { id: input.contractId } });
  if (!row) return err(NOT_FOUND);
  if (row.status !== "DRAFT") {
    return err("Only a draft can be discarded — an issued contract is voided instead");
  }

  await db.$transaction(async (tx) => {
    await tx.contract.delete({ where: { id: row.id } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CONTRACT",
      entityId: row.id,
      action: "contract.draft_discarded",
      clientId: row.clientId,
      meta: {
        name: describeContract({
          kind: row.kind,
          trial: row.trial,
          plan: row.plan,
          ads: row.ads,
          websiteTier: row.websiteTier,
          realEstate: row.realEstate,
        }),
      },
    });
  });
  return ok(undefined);
}
