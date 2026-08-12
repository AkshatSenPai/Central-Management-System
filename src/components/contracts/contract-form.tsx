"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AD_SETUPS,
  AD_SETUP_LABEL,
  CONTRACT_PLANS,
  CONTRACT_PLAN_LABEL,
  DEFAULT_GRACE_PERIOD,
  DEFAULT_TIMELINE,
  WEBSITE_TIERS,
  WEBSITE_TIER_LABEL,
  dueDateDay,
  longDate,
  planIsAvailable,
  tokensFor,
  trialEndDate,
  type AdSetup,
  type ContractKind,
  type ContractPlan,
  type ContractToken,
  type WebsiteTier,
} from "@/lib/contract";
import { parseDateInput, toDateInputValue } from "@/lib/dates";
import { createContractAction, updateContractAction } from "@/server/actions/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, SelectField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";

/** The four types the owner names. "Trial" is one choice here and two fields
 * underneath — see CONTRACT_TYPE_CHOICES in `contract.ts`. Selecting it
 * reveals the one extra question the template package needs answered. */
const DOC_TYPES = [
  { id: "PROPOSAL", label: "Proposal" },
  { id: "ONE_TIME", label: "One-time agreement" },
  { id: "MAINTENANCE", label: "Maintenance agreement" },
  { id: "TRIAL", label: "Trial agreement" },
] as const;
type DocType = (typeof DOC_TYPES)[number]["id"];

type Values = {
  docType: DocType;
  /** Only read when docType is TRIAL. */
  trialOf: "ONE_TIME" | "MAINTENANCE";
  plan: ContractPlan;
  ads: AdSetup;
  websiteTier: WebsiteTier | "";
  realEstate: boolean;
  clientName: string;
  clientFirm: string;
  clientPhone: string;
  clientEmail: string;
  projectName: string;
  documentDate: string;
  timeline: string;
  campaignStartDate: string;
  gracePeriod: string;
  paidAmount: string;
  paidDate: string;
  counterpartAgreementNo: string;
};

export type ContractDefaults = {
  id: string;
  kind: ContractKind;
  trial: boolean;
  plan: ContractPlan;
  ads: AdSetup;
  websiteTier: WebsiteTier | null;
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
};

/** Today, in the app's own calendar. A contract drafted at 11pm IST carries
 * tomorrow's date if this used UTC, which is the wrong month for two hours
 * of every 31st. */
function todayInput(): string {
  return toDateInputValue(new Date());
}

function initialValues(
  contract: ContractDefaults | undefined,
  client: { name: string; sector: string | null }
): Values {
  if (!contract) {
    return {
      docType: "PROPOSAL",
      trialOf: "MAINTENANCE",
      plan: "STANDARD",
      ads: "META",
      websiteTier: "",
      // Prefilled from the client's sector rather than left to be
      // remembered. Getting this wrong is the difference between a property
      // developer's contract carrying its RERA clauses and not.
      realEstate: /real ?estate|propert|realty|infra|builder/i.test(client.sector ?? ""),
      clientName: "",
      clientFirm: client.name,
      clientPhone: "",
      clientEmail: "",
      projectName: "",
      documentDate: todayInput(),
      timeline: DEFAULT_TIMELINE,
      campaignStartDate: "",
      gracePeriod: DEFAULT_GRACE_PERIOD,
      paidAmount: "",
      paidDate: "",
      counterpartAgreementNo: "",
    };
  }
  return {
    docType: contract.trial ? "TRIAL" : contract.kind,
    trialOf: contract.kind === "ONE_TIME" ? "ONE_TIME" : "MAINTENANCE",
    plan: contract.plan,
    ads: contract.ads,
    websiteTier: contract.websiteTier ?? "",
    realEstate: contract.realEstate,
    clientName: contract.clientName,
    clientFirm: contract.clientFirm,
    clientPhone: contract.clientPhone ?? "",
    clientEmail: contract.clientEmail ?? "",
    projectName: contract.projectName,
    documentDate: toDateInputValue(contract.documentDate),
    timeline: contract.timeline ?? "",
    campaignStartDate: toDateInputValue(contract.campaignStartDate),
    gracePeriod: contract.gracePeriod ?? "",
    paidAmount: contract.paidAmount ?? "",
    paidDate: toDateInputValue(contract.paidDate),
    counterpartAgreementNo: contract.counterpartAgreementNo ?? "",
  };
}

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

export function ContractForm({
  clientId,
  client,
  contract,
  agreementNumbers,
}: {
  clientId: string;
  client: { name: string; sector: string | null };
  contract?: ContractDefaults;
  agreementNumbers: { id: string; agreementNo: string; kind: ContractKind }[];
}) {
  const [open, setOpen] = useState(false);
  // Controlled, and remounted on a rejected submit, for the reasons spelled
  // out at length in `client-form.tsx` — React 19 resets the form once the
  // action resolves and a <select> does not restore itself.
  const [values, setValues] = useState<Values>(() => initialValues(contract, client));
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();

  const save = (contract ? updateContractAction : createContractAction) as SaveAction;
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await save(prev, formData);
      if (result.ok) {
        setOpen(false);
        if (!contract) {
          setValues(initialValues(undefined, client));
          const created = result.data as { id?: string } | undefined;
          // Straight to the new draft, which is where the preview is. The
          // alternative — a toast on the client page — leaves someone one
          // click from a document they have not seen.
          if (created?.id) router.push(`/contracts/${created.id}`);
        } else {
          router.refresh();
        }
      } else {
        setAttempt((a) => a + 1);
      }
      return result;
    },
    null
  );

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function cancel() {
    setOpen(false);
    setValues(initialValues(contract, client));
  }

  // The deal, as the form currently stands. Everything below keys off this.
  const kind: ContractKind = values.docType === "TRIAL" ? values.trialOf : values.docType;
  const trial = values.docType === "TRIAL";
  const plan = planIsAvailable(kind, values.plan) ? values.plan : "STANDARD";

  /** The form asks for exactly the tokens the chosen template contains.
   * Driving visibility from `tokensFor` rather than from a hand-written set
   * of conditions means a field can never be asked for and unused, or used
   * and unasked-for — the two failure modes that produce a contract with a
   * blank in it. */
  const tokens = new Set<ContractToken>(tokensFor(kind, trial));
  const needs = (token: ContractToken) => tokens.has(token);

  // Derived and shown read-only, so what will be printed is visible before
  // it is printed. Spec §05 check 5 is unfailable because of this.
  const campaign = parseDateInput(values.campaignStartDate);
  const derived = campaign
    ? {
        dueDay: dueDateDay(campaign),
        trialStart: longDate(campaign),
        trialEnd: longDate(trialEndDate(campaign)),
      }
    : null;

  const formId = contract ? `contract-form-${contract.id}` : "contract-form-new";

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={contract ? "secondary" : "primary"}
        size="sm"
        className="gap-1.5"
      >
        <Icon name={contract ? "edit" : "add"} size="sm" />
        {contract ? "Edit" : "New contract"}
      </Button>

      <Modal
        open={open}
        onClose={cancel}
        title={contract ? "Edit draft" : "New contract"}
        icon="description"
        width={760}
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={cancel}>Cancel</Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? "Saving…" : contract ? "Save draft" : "Create draft"}
            </Button>
          </>
        }
      >
        <form id={formId} key={attempt} action={formAction} className="space-y-5">
          <input type="hidden" name="clientId" value={clientId} />
          {contract ? <input type="hidden" name="contractId" value={contract.id} /> : null}
          {/* The three deal fields the visible controls derive rather than
              hold. `kind` is one of four labelled choices, `trial` is whether
              that choice was the fourth, and `plan` falls back when a website
              deal is switched to a proposal. */}
          <input type="hidden" name="kind" value={kind} />
          {trial ? <input type="hidden" name="trial" value="on" /> : null}
          <input type="hidden" name="plan" value={plan} />

          {state && !state.ok ? <FormError message={state.error} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Document type"
              className="w-full"
              value={values.docType}
              onChange={(e) => set("docType", e.target.value as DocType)}
            >
              {DOC_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </SelectField>

            {trial ? (
              <SelectField
                label="Trial of"
                className="w-full"
                value={values.trialOf}
                onChange={(e) => set("trialOf", e.target.value as "ONE_TIME" | "MAINTENANCE")}
              >
                <option value="ONE_TIME">The one-time agreement</option>
                <option value="MAINTENANCE">The maintenance agreement</option>
              </SelectField>
            ) : null}

            <SelectField
              label="Plan"
              className="w-full"
              value={plan}
              onChange={(e) => set("plan", e.target.value as ContractPlan)}
            >
              {CONTRACT_PLANS.filter((p) => planIsAvailable(kind, p)).map((p) => (
                <option key={p} value={p}>
                  {CONTRACT_PLAN_LABEL[p]}
                </option>
              ))}
            </SelectField>

            {plan === "WEBSITE" ? (
              <SelectField
                label="Website tier"
                className="w-full"
                name="websiteTier"
                value={values.websiteTier}
                onChange={(e) => set("websiteTier", e.target.value as WebsiteTier)}
              >
                <option value="">Choose a tier</option>
                {WEBSITE_TIERS.map((t) => (
                  <option key={t} value={t}>
                    {WEBSITE_TIER_LABEL[t]}
                  </option>
                ))}
              </SelectField>
            ) : (
              <SelectField
                label={kind === "MAINTENANCE" ? "Ad management" : "Ad setup"}
                className="w-full"
                name="ads"
                value={values.ads}
                onChange={(e) => set("ads", e.target.value as AdSetup)}
              >
                {AD_SETUPS.map((a) => (
                  <option key={a} value={a}>
                    {AD_SETUP_LABEL[a]}
                  </option>
                ))}
              </SelectField>
            )}
          </div>

          {/* Ads is still submitted on a website deal so the resolver has a
              defined value; it selects no file and appears nowhere. */}
          {plan === "WEBSITE" ? <input type="hidden" name="ads" value="NONE" /> : null}

          {kind !== "PROPOSAL" ? (
            <div className="rounded-md border border-[var(--border)] p-3">
              <Checkbox
                name="realEstate"
                label="This is a real-estate project"
                checked={values.realEstate}
                onChange={(e) => set("realEstate", e.target.checked)}
              />
              <p className="mt-1.5 pl-6 text-xs text-[var(--text-3)]">
                Adds seven clauses — RERA compliance, written approval of advertising, no role in
                sales or customer money, and four more. Recommended for every property client.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Client name"
              className="w-full"
              name="clientName"
              required
              placeholder="Mr. Sandeep Singh"
              value={values.clientName}
              onChange={(e) => set("clientName", e.target.value)}
            />
            <Field
              label="Firm and city"
              className="w-full"
              name="clientFirm"
              required
              placeholder="Magus Realty, Lucknow"
              value={values.clientFirm}
              onChange={(e) => set("clientFirm", e.target.value)}
            />
            {needs("CLIENT_PHONE") ? (
              <Field
                label="Phone"
                className="w-full"
                name="clientPhone"
                placeholder="+91 73909 38686"
                value={values.clientPhone}
                onChange={(e) => set("clientPhone", e.target.value)}
              />
            ) : null}
            {needs("CLIENT_EMAIL") ? (
              <Field
                label="Email"
                className="w-full"
                type="email"
                name="clientEmail"
                value={values.clientEmail}
                onChange={(e) => set("clientEmail", e.target.value)}
              />
            ) : null}
            <Field
              label="Project"
              className="w-full"
              name="projectName"
              required
              placeholder="Wave City Plots"
              value={values.projectName}
              onChange={(e) => set("projectName", e.target.value)}
            />
            <Field
              label="Document date"
              className="w-full"
              type="date"
              name="documentDate"
              required
              value={values.documentDate}
              onChange={(e) => set("documentDate", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {needs("TIMELINE") ? (
              <Field
                label="Timeline"
                className="w-full"
                name="timeline"
                placeholder={DEFAULT_TIMELINE}
                value={values.timeline}
                onChange={(e) => set("timeline", e.target.value)}
              />
            ) : null}
            {needs("CAMPAIGN_START_DATE") ? (
              // Required, and it is the only optional-looking field that is
              // not optional. A maintenance agreement derives three printed
              // values from it — the campaign start, the due day, and on a
              // trial both trial dates — so a blank one leaves four tokens
              // unsubstituted and the contract cannot be issued. It used to
              // be an ordinary field, and the first person to leave it empty
              // met a greyed-out Issue button with the explanation somewhere
              // further down the page.
              <Field
                label="Campaign start"
                className="w-full"
                type="date"
                name="campaignStartDate"
                required
                value={values.campaignStartDate}
                onChange={(e) => set("campaignStartDate", e.target.value)}
              />
            ) : null}
            {needs("GRACE_PERIOD") ? (
              <Field
                label="Grace period"
                className="w-full"
                name="gracePeriod"
                placeholder={DEFAULT_GRACE_PERIOD}
                value={values.gracePeriod}
                onChange={(e) => set("gracePeriod", e.target.value)}
              />
            ) : null}
            {needs("PAID_AMOUNT") ? (
              <Field
                label="Amount paid"
                className="w-full"
                name="paidAmount"
                placeholder="Leave blank for a dotted line"
                value={values.paidAmount}
                onChange={(e) => set("paidAmount", e.target.value)}
              />
            ) : null}
            {needs("PAID_DATE") ? (
              <Field
                label="Date paid"
                className="w-full"
                type="date"
                name="paidDate"
                value={values.paidDate}
                onChange={(e) => set("paidDate", e.target.value)}
              />
            ) : null}
          </div>

          {needs("CAMPAIGN_START_DATE") && derived ? (
            <p className="text-xs text-[var(--text-3)]">
              Payments fall due on the <b className="text-[var(--text-2)]">{derived.dueDay}</b> of
              each month.
              {trial ? (
                <>
                  {" "}
                  The trial runs{" "}
                  <b className="text-[var(--text-2)]">{derived.trialStart}</b> to{" "}
                  <b className="text-[var(--text-2)]">{derived.trialEnd}</b>.
                </>
              ) : null}{" "}
              Both are worked out from the campaign start, so they cannot disagree with it.
            </p>
          ) : null}

          {needs("ONETIME_AGREEMENT_NO") || needs("MAINTENANCE_AGREEMENT_NO") ? (
            <SelectField
              label={
                kind === "ONE_TIME"
                  ? "Cross-reference: the maintenance agreement"
                  : "Cross-reference: the one-time agreement"
              }
              className="w-full"
              name="counterpartAgreementNo"
              value={values.counterpartAgreementNo}
              onChange={(e) => set("counterpartAgreementNo", e.target.value)}
            >
              <option value="">Not issued yet — leave blank</option>
              {agreementNumbers
                .filter((a) => a.kind === (kind === "ONE_TIME" ? "MAINTENANCE" : "ONE_TIME"))
                .map((a) => (
                  <option key={a.id} value={a.agreementNo}>
                    {a.agreementNo}
                  </option>
                ))}
              {/* A number issued before this app existed, or one from a client
                  record that was split. Kept selectable so a real pair can be
                  recorded rather than silently left blank. */}
              {values.counterpartAgreementNo &&
              !agreementNumbers.some((a) => a.agreementNo === values.counterpartAgreementNo) ? (
                <option value={values.counterpartAgreementNo}>
                  {values.counterpartAgreementNo}
                </option>
              ) : null}
            </SelectField>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
