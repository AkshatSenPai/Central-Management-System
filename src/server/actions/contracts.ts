"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation           | revalidatePath calls                                  |
 * |--------------------|-------------------------------------------------------|
 * | draft create       | `/clients/{clientId}`, `/contracts`                   |
 * | draft update       | `/contracts/{id}`, `/clients/{clientId}`              |
 * | issue              | `/contracts/{id}`, `/contracts`, `/clients/{clientId}`|
 * | void               | same as issue                                          |
 * | discard draft      | `/contracts`, `/clients/{clientId}`                   |
 *
 * Thin, like every other action file: guard, coerce FormData, safeParse,
 * delegate, revalidate. The one thing worth noting is that none of these is
 * admin-gated. Writing a proposal is ordinary studio work, and the register's
 * integrity is protected by the schema and the service rather than by role —
 * an issued contract cannot be edited by anyone, admin included.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { AuthError, requireUser } from "@/server/guards";
import { contractSchema, type ContractDeal } from "@/lib/contract";
import {
  createContract,
  updateContract,
  issueContract,
  voidContract,
  discardDraft,
  type ContractWriteInput,
} from "@/lib/contract-service";
import { parseDateInput } from "@/lib/dates";

/** `<input type="checkbox">` submits "on" when ticked and nothing at all when
 * not, so a missing key is false rather than invalid. */
function checked(formData: FormData, name: string): boolean {
  return formData.get(name) !== null;
}

/** The shared FormData -> service-input mapping for create and update. Two
 * copies of this would be two chances for the editor to store a different
 * field set from the creator, and the difference would only surface as a
 * token that renders blank on the second save. */
function parseForm(
  formData: FormData
): { ok: true; input: Omit<ContractWriteInput, "clientId"> } | { ok: false; error: string } {
  const parsed = contractSchema.safeParse({
    kind: formData.get("kind"),
    trial: checked(formData, "trial"),
    plan: formData.get("plan"),
    ads: formData.get("ads"),
    websiteTier: formData.get("websiteTier"),
    realEstate: checked(formData, "realEstate"),
    clientName: formData.get("clientName"),
    clientFirm: formData.get("clientFirm"),
    clientPhone: formData.get("clientPhone"),
    clientEmail: formData.get("clientEmail"),
    projectName: formData.get("projectName"),
    documentDate: formData.get("documentDate"),
    timeline: formData.get("timeline"),
    campaignStartDate: formData.get("campaignStartDate"),
    gracePeriod: formData.get("gracePeriod"),
    paidAmount: formData.get("paidAmount"),
    paidDate: formData.get("paidDate"),
    counterpartAgreementNo: formData.get("counterpartAgreementNo"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  const documentDate = parseDateInput(d.documentDate);
  if (!documentDate) return { ok: false, error: "Document date is required" };

  const deal: ContractDeal = {
    kind: d.kind,
    trial: d.trial,
    plan: d.plan,
    ads: d.ads,
    websiteTier: d.websiteTier ? d.websiteTier : null,
    realEstate: d.realEstate,
  };

  return {
    ok: true,
    input: {
      deal,
      clientName: d.clientName,
      clientFirm: d.clientFirm,
      clientPhone: d.clientPhone || null,
      clientEmail: d.clientEmail || null,
      projectName: d.projectName,
      documentDate,
      timeline: d.timeline || null,
      campaignStartDate: parseDateInput(d.campaignStartDate || ""),
      gracePeriod: d.gracePeriod || null,
      paidAmount: d.paidAmount || null,
      paidDate: parseDateInput(d.paidDate || ""),
      counterpartAgreementNo: d.counterpartAgreementNo || null,
    },
  };
}

export async function createContractAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = parseForm(formData);
    if (!parsed.ok) return err(parsed.error);

    const result = await createContract(prisma, {
      ...parsed.input,
      clientId,
      actorId: user.id,
    });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/contracts");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateContractAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const contractId = String(formData.get("contractId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = parseForm(formData);
    if (!parsed.ok) return err(parsed.error);

    const result = await updateContract(prisma, {
      ...parsed.input,
      clientId,
      contractId,
      actorId: user.id,
    });
    revalidatePath(`/contracts/${contractId}`);
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

/** Spec §07 steps 3-7, behind one button. */
export async function issueContractAction(
  _prev: ActionResult<{ agreementNo: string }> | null,
  formData: FormData
): Promise<ActionResult<{ agreementNo: string }>> {
  try {
    const user = await requireUser();
    const contractId = String(formData.get("contractId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const result = await issueContract(prisma, { contractId, actorId: user.id });
    revalidatePath(`/contracts/${contractId}`);
    revalidatePath("/contracts");
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function voidContractAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const contractId = String(formData.get("contractId") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    const result = await voidContract(prisma, {
      contractId,
      actorId: user.id,
      reason: String(formData.get("reason") ?? "").trim() || null,
    });
    revalidatePath(`/contracts/${contractId}`);
    revalidatePath("/contracts");
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function discardDraftAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const result = await discardDraft(prisma, {
      contractId: String(formData.get("contractId") ?? ""),
      actorId: user.id,
    });
    revalidatePath("/contracts");
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
