/** Contract generation — the pure layer.
 *
 * Everything here is a total function over plain values: no Prisma, no fs, no
 * React. The two files that do touch the world are `contract-template.ts`
 * (reads the 74 vendored HTML files) and `contract-service.ts` (writes rows).
 *
 * The domain is the one described by `docs/contracts/IMPLEMENTATION-SPEC.md`,
 * the owner's own build spec, and the vocabulary below is deliberately its
 * vocabulary rather than a prettier one invented here — a term that differs
 * from the spec is a term somebody has to translate every time they read both.
 *
 * ## Why there is no price anywhere in this file
 *
 * Spec §03: "Prices are baked into each file, not passed as variables.
 * Choosing the right file is how the price is set. This is deliberate — it
 * makes it impossible to quote a Standard funnel at Starter pricing by
 * mistake. There is no price token, and none should be added."
 *
 * So the deal fields below (`plan`, `ads`, `websiteTier`) do not *describe* a
 * price, they *select a document that already contains one*. Adding a price
 * column to `Contract` would create a second source of truth for a number the
 * PDF states in three places — figures, words, and the liability cap — and the
 * two would drift on the first pricing change. `PAID_AMOUNT` is the single
 * exception and is not a price: it is a receipt of what actually arrived.
 */

import { z } from "zod";
import type { BadgeKind } from "@/lib/badges";

/* -------------------------------------------------------------------------
 * The deal
 * ---------------------------------------------------------------------- */

/** The three document families. `trial` is a separate boolean rather than a
 * fourth member here, because that is how the template package is actually
 * organised: `trial/one-time/` holds a *one-time agreement* that happens to
 * mention a trial, and `trial/maintenance/` a *maintenance agreement* whose
 * first month is the trial. A `TRIAL` kind would have to answer "a trial of
 * what?" with a second field anyway, and would put the answer somewhere the
 * filename resolver could contradict it.
 *
 * The owner names four types — Proposals, Trial Contracts, Maintenance,
 * One-Time — and the picker in the UI shows exactly those four. This is the
 * storage shape underneath it, not a disagreement with it: see
 * `CONTRACT_TYPE_CHOICES` at the bottom of this file, which is that picker. */
export const CONTRACT_KINDS = ["PROPOSAL", "ONE_TIME", "MAINTENANCE"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const CONTRACT_KIND_LABEL: Record<ContractKind, string> = {
  PROPOSAL: "Proposal",
  ONE_TIME: "One-time agreement",
  MAINTENANCE: "Maintenance agreement",
};

/** Funnel tier, or `WEBSITE` for the website-build/website-care line, which
 * is graded by `websiteTier` instead of by ad setup. They are one field
 * because they are one choice on one form: a deal is a funnel deal or a
 * website deal, never both, and the filename has one slot for the answer. */
export const CONTRACT_PLANS = ["STARTER", "STANDARD", "ADVANCED", "WEBSITE"] as const;
export type ContractPlan = (typeof CONTRACT_PLANS)[number];

export const CONTRACT_PLAN_LABEL: Record<ContractPlan, string> = {
  STARTER: "Starter",
  STANDARD: "Standard",
  ADVANCED: "Advanced",
  WEBSITE: "Website",
};

/** Which ad platforms are in scope. On a maintenance document this is the ad
 * *management* setup; the template package uses the same four values and the
 * same filename slot for both, so they are one type here. */
export const AD_SETUPS = ["NONE", "META", "GOOGLE", "BOTH"] as const;
export type AdSetup = (typeof AD_SETUPS)[number];

export const AD_SETUP_LABEL: Record<AdSetup, string> = {
  NONE: "No ads",
  META: "Meta",
  GOOGLE: "Google",
  BOTH: "Meta + Google",
};

export const WEBSITE_TIERS = ["BUSINESS", "PREMIUM", "FLAGSHIP"] as const;
export type WebsiteTier = (typeof WEBSITE_TIERS)[number];

export const WEBSITE_TIER_LABEL: Record<WebsiteTier, string> = {
  BUSINESS: "Business",
  PREMIUM: "Premium",
  FLAGSHIP: "Flagship",
};

/** DRAFT is editable and has no agreement number. ISSUED is frozen: the
 * rendered HTML is the record from that moment on, and the number is spent.
 * VOID is an issued contract withdrawn afterwards — the row and its number
 * stay, because a register with holes in it cannot be audited. */
export const CONTRACT_STATUSES = ["DRAFT", "ISSUED", "VOID"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  VOID: "Void",
};

export const CONTRACT_STATUS_BADGE: Record<ContractStatus, BadgeKind> = {
  DRAFT: "neutral",
  ISSUED: "ok",
  VOID: "warn",
};

/** The deal, reduced to exactly what picks a file. */
export type ContractDeal = {
  kind: ContractKind;
  trial: boolean;
  plan: ContractPlan;
  ads: AdSetup;
  websiteTier: WebsiteTier | null;
  realEstate: boolean;
};

/* -------------------------------------------------------------------------
 * Which combinations exist
 * ---------------------------------------------------------------------- */

/** A proposal is a funnel document only. The package ships 12 of them —
 * 3 tiers x 4 ad setups — and no `proposal_website_*.html`, because the
 * website line is quoted from the brochure rather than proposed on paper. */
export function planIsAvailable(kind: ContractKind, plan: ContractPlan): boolean {
  if (plan === "WEBSITE") return kind !== "PROPOSAL";
  return true;
}

/** There is no `trial/proposals/` folder, and there is nothing for one to
 * mean: a trial is a term of an agreement, and a proposal has no terms. */
export function trialIsAvailable(kind: ContractKind): boolean {
  return kind !== "PROPOSAL";
}

/** Spec §04: "Every agreement (not proposals) contains one additional token
 * that behaves as an on/off switch." A proposal carries no legal clauses at
 * all, so there is no `{{REAL_ESTATE_CLAUSES}}` in one to switch. */
export function realEstateIsAvailable(kind: ContractKind): boolean {
  return kind !== "PROPOSAL";
}

/** Returns the reason a deal cannot be built, or null when it can. Callers
 * treat null as valid; the string is shown to the person who typed it.
 *
 * This is the one place the availability rules above are composed, so the
 * form, the action and the service all refuse the same combinations for the
 * same stated reasons rather than each growing its own subset. */
export function dealProblem(deal: ContractDeal): string | null {
  if (!planIsAvailable(deal.kind, deal.plan)) {
    return "There is no website proposal template — proposals cover the funnel plans only";
  }
  if (deal.trial && !trialIsAvailable(deal.kind)) {
    return "A proposal cannot start with a trial — a trial is a term of an agreement";
  }
  if (deal.realEstate && !realEstateIsAvailable(deal.kind)) {
    return "Real-estate clauses belong to an agreement — a proposal carries no clauses";
  }
  if (deal.plan === "WEBSITE" && !deal.websiteTier) {
    return "Choose a website tier";
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Resolving the file
 * ---------------------------------------------------------------------- */

const KIND_STEM: Record<ContractKind, string> = {
  PROPOSAL: "proposal",
  ONE_TIME: "onetime",
  MAINTENANCE: "maintenance",
};

const KIND_FOLDER: Record<ContractKind, string> = {
  PROPOSAL: "proposals",
  ONE_TIME: "one-time",
  MAINTENANCE: "maintenance",
};

/** Spec §03: "The filename encodes the product combination. Build it from the
 * deal, don't hardcode a lookup table."
 *
 * Returns a path relative to the template root, with `/` separators — it is
 * joined to a real directory by `contract-template.ts` and is never itself a
 * filesystem path. There is no user-supplied text in the result: every
 * segment comes from a closed union above, which is what makes this safe to
 * hand to `path.join` without a traversal check.
 *
 * Throws on a combination that has no file. That is deliberately a throw and
 * not a null: `dealProblem` is the total function callers are expected to run
 * first, and reaching here with an impossible deal means something skipped
 * it — a bug, not a user error, and it should be loud. */
export function resolveTemplatePath(deal: ContractDeal): string {
  const problem = dealProblem(deal);
  if (problem) throw new Error(`resolveTemplatePath: ${problem}`);

  const stem = KIND_STEM[deal.kind];
  const base =
    deal.plan === "WEBSITE"
      ? `${stem}_website_${deal.websiteTier!.toLowerCase()}`
      : `${stem}_${deal.plan.toLowerCase()}_${deal.ads.toLowerCase()}`;

  if (!deal.trial) return `${KIND_FOLDER[deal.kind]}/${base}.html`;
  return `trial/${KIND_FOLDER[deal.kind]}/trial_${base}.html`;
}

/** Which of the two real-estate snippets slots into this document.
 *
 * Spec §04, and it matters: "The one-time snippet numbers clauses 10F-10L;
 * the maintenance snippet numbers them 12F-12L. Using the wrong one produces
 * duplicate clause numbers in the finished contract." The trial variants are
 * the same documents with a badge on the cover, so they take the same
 * snippet as their non-trial twin. Null for a proposal, which has no token. */
export function resolveSnippetPath(kind: ContractKind): string | null {
  if (kind === "PROPOSAL") return null;
  const file = kind === "ONE_TIME" ? "ONETIME" : "MAINTENANCE";
  return `_snippets/real_estate_clauses_${file}.html`;
}

/* -------------------------------------------------------------------------
 * The agreement register
 * ---------------------------------------------------------------------- */

/** Spec §07: "An agreement-number register. Numbers are referenced across
 * paired documents and are the only way to tie a signed PDF back to a deal.
 * Auto-increment them and never allow a duplicate."
 *
 * `SO/OT/2026/055`. The series letter is per kind, so the one-time and the
 * maintenance agreement for one client take the same sequence position in
 * different series and read as a matched pair. */
export const CONTRACT_SERIES: Record<ContractKind, string> = {
  PROPOSAL: "PR",
  ONE_TIME: "OT",
  MAINTENANCE: "MT",
};

/** Three digits because the register restarts every year and a studio that
 * writes a thousand agreements in one is a problem worth having. Numbers
 * above 999 simply get wider rather than wrapping — `String.padStart` never
 * truncates — so the format degrades into `SO/OT/2026/1000` instead of
 * silently colliding with `055`. */
export function formatAgreementNo(kind: ContractKind, year: number, sequence: number): string {
  return `SO/${CONTRACT_SERIES[kind]}/${year}/${String(sequence).padStart(3, "0")}`;
}

const AGREEMENT_NO = /^SO\/(PR|OT|MT)\/(\d{4})\/(\d{3,})$/;

/** Parses one back, for the cross-reference check in `contract-validation.ts`
 * and for anything that needs to sort a register. Null on anything that is
 * not exactly the format above — a hand-typed cross-reference is genuinely
 * arbitrary text and must not be coerced into looking valid. */
export function parseAgreementNo(
  value: string
): { series: string; year: number; sequence: number } | null {
  const match = AGREEMENT_NO.exec(value.trim());
  if (!match) return null;
  return { series: match[1], year: Number(match[2]), sequence: Number(match[3]) };
}

/* -------------------------------------------------------------------------
 * Dates
 * ---------------------------------------------------------------------- */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Contract dates are calendar dates, not instants: `parseDateInput` stores
 * them at UTC midnight precisely so "15 August 2026" means the same day
 * everywhere, and these read them back with `getUTC*` for the same reason.
 *
 * They do NOT use `dates.ts`'s app-local accessors. Those shift by +05:30 to
 * answer "what day is it in the office", which is the right question for a
 * punch card and the wrong one for a date somebody typed into a contract:
 * shifting a UTC-midnight value forward by five and a half hours leaves the
 * calendar day intact, but the pairing is a coincidence of the offset's sign,
 * and a contract that renders the wrong date is not a bug anyone catches
 * before a client does. */
export function longDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "August 2026" — the cover date on every document. `dates.ts`'s `monthYear`
 * is the app's own short form ("Aug 2026") and is used all over the UI; a
 * contract cover spells the month out. */
export function longMonthYear(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "1st", "2nd", "3rd", "4th" ... "11th", "12th", "13th" ... "21st", "31st".
 * The teens are the whole reason this is not `n % 10`. */
export function ordinalDay(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** `{{DUE_DATE_DAY}}`, derived rather than asked for. Spec §05 check 5
 * requires it to match the day of `CAMPAIGN_START_DATE`; deriving it makes
 * that check unfailable instead of merely checked. */
export function dueDateDay(campaignStart: Date): string {
  return ordinalDay(campaignStart.getUTCDate());
}

/** `{{TRIAL_END_DATE}}` — spec §05 check 5: "the day before the same calendar
 * day one month after TRIAL_START_DATE". 15 Aug 2026 -> 14 Sep 2026.
 *
 * Also derived, for the same reason as `dueDateDay`.
 *
 * The clamp is the interesting case. There is no 31 February, so a trial
 * starting 31 January cannot end "the day before 31 February". Rolling over
 * — which is what `setUTCMonth` does unaided, landing on 3 March — would
 * silently sell a 31-day trial as a one-month one. Clamping to the last day
 * of the target month gives 28 February, and the day before that is 27
 * February: a trial one day short of the month rather than three days long.
 * Short is the safe direction for the Company, and it is the convention every
 * subscription biller uses for the same date. */
export function trialEndDate(trialStart: Date): Date {
  const year = trialStart.getUTCFullYear();
  const month = trialStart.getUTCMonth();
  const day = trialStart.getUTCDate();

  // Day 0 of the month after the target is the last day of the target.
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const oneMonthOn = Date.UTC(year, month + 1, Math.min(day, lastDayOfTargetMonth));
  return new Date(oneMonthOn - 24 * 60 * 60 * 1000);
}

/* -------------------------------------------------------------------------
 * Tokens
 * ---------------------------------------------------------------------- */

/** The 18 tokens of spec §02, plus the §04 toggle. Named exactly as they
 * appear between the braces. */
export const CONTRACT_TOKENS = [
  "CLIENT_NAME",
  "CLIENT_FIRM",
  "CLIENT_FIRM_UPPER",
  "CLIENT_PHONE",
  "CLIENT_EMAIL",
  "PROJECT_NAME",
  "AGREEMENT_NO",
  "ONETIME_AGREEMENT_NO",
  "MAINTENANCE_AGREEMENT_NO",
  "MONTH_YEAR",
  "TIMELINE",
  "CAMPAIGN_START_DATE",
  "DUE_DATE_DAY",
  "GRACE_PERIOD",
  "TRIAL_START_DATE",
  "TRIAL_END_DATE",
  "PAID_AMOUNT",
  "PAID_DATE",
  "REAL_ESTATE_CLAUSES",
] as const;
export type ContractToken = (typeof CONTRACT_TOKENS)[number];

export type TokenMap = Partial<Record<ContractToken, string>>;

/** Which tokens each document family actually contains.
 *
 * Declared rather than discovered, so the form can ask for exactly the right
 * fields without reading 2 MB of HTML first — and then asserted against the
 * real files by `tests/contract-template.test.ts`, which walks all 74 and
 * fails if any template grows or drops a token. That test is the reason this
 * constant is allowed to be a hand-written list: it cannot drift silently.
 *
 * Two entries repay a second look:
 *
 *   - **trial one-time takes no trial dates.** `trial/one-time/` differs from
 *     `one-time/` by a cover badge and one line of prose — the dates live in
 *     the maintenance half of the pair, which is the document the trial is
 *     actually a term of.
 *   - **the cross-references point at each other.** A one-time agreement
 *     carries `MAINTENANCE_AGREEMENT_NO` and a maintenance agreement carries
 *     `ONETIME_AGREEMENT_NO`. Reading those two names as "the one on the
 *     maintenance doc is the maintenance number" is the mistake this comment
 *     exists to prevent; each names *the other document*. */
const BASE_AGREEMENT_TOKENS = [
  "CLIENT_NAME",
  "CLIENT_FIRM",
  "CLIENT_PHONE",
  "CLIENT_EMAIL",
  "PROJECT_NAME",
  "AGREEMENT_NO",
  "MONTH_YEAR",
  "REAL_ESTATE_CLAUSES",
] as const;

export function tokensFor(kind: ContractKind, trial: boolean): ContractToken[] {
  if (kind === "PROPOSAL") {
    return ["CLIENT_NAME", "CLIENT_FIRM", "CLIENT_FIRM_UPPER", "PROJECT_NAME", "MONTH_YEAR", "TIMELINE"];
  }
  if (kind === "ONE_TIME") {
    return [
      ...BASE_AGREEMENT_TOKENS,
      "MAINTENANCE_AGREEMENT_NO",
      "TIMELINE",
      "PAID_AMOUNT",
      "PAID_DATE",
    ];
  }
  return [
    ...BASE_AGREEMENT_TOKENS,
    "ONETIME_AGREEMENT_NO",
    "CAMPAIGN_START_DATE",
    "DUE_DATE_DAY",
    "GRACE_PERIOD",
    ...(trial ? (["TRIAL_START_DATE", "TRIAL_END_DATE"] as const) : []),
  ];
}

/** Spec §02: "For unpaid contracts, substitute these two with a blank line
 * rather than empty text, so there is somewhere to write on the printed
 * page."
 *
 * **Not the markup the spec prints, and deliberately so.** §02 gives an
 * inline style — a dotted bottom border, a fixed grey, a 28mm minimum width.
 * Every template that uses `{{PAID_AMOUNT}}` already defines exactly that
 * rule as a `.blank` class, verified present in all 30 one-time files, plain
 * and trial, and asserted by `tests/contract-template.test.ts` so a future
 * package that drops it fails loudly rather than printing an invisible gap.
 *
 * Using the class instead of the inline copy is better on three counts: the
 * blank comes out at the template's own 45mm rather than the spec prose's
 * 28mm; the colour stays defined in one place, so a restyled package restyles
 * its blanks with it; and no colour literal has to live in this app's source,
 * which is what `npm run gates` gate 1 is for. That gate has exactly two
 * standing exemptions and this was not a good enough reason to make it
 * three. */
export const BLANK_FILL = '<span class="blank">&nbsp;</span>';

/* -------------------------------------------------------------------------
 * The form
 * ---------------------------------------------------------------------- */

/** Everything a person types, before any derivation. Optional fields are
 * `""`-tolerant in the same style as `clientSchema` — the action layer maps
 * empties to null on the way to the column.
 *
 * `documentDate` drives `{{MONTH_YEAR}}`; `campaignStartDate` drives
 * `{{CAMPAIGN_START_DATE}}`, `{{DUE_DATE_DAY}}` and — on a trial maintenance
 * agreement — both trial dates. There is deliberately no separate trial-start
 * input: the trial *is* the first month of the engagement, so a trial start
 * that differed from the campaign start would describe a month of managed
 * advertising that is somehow not the trial month. One input, and spec §05
 * check 5 cannot fail. */
export const contractSchema = z.object({
  kind: z.enum(CONTRACT_KINDS),
  trial: z.coerce.boolean(),
  plan: z.enum(CONTRACT_PLANS),
  ads: z.enum(AD_SETUPS),
  websiteTier: z.enum(WEBSITE_TIERS).optional().or(z.literal("")),
  realEstate: z.coerce.boolean(),

  clientName: z.string().trim().min(1, "Client name is required").max(160),
  clientFirm: z.string().trim().min(1, "Firm and city are required").max(160),
  clientPhone: z.string().trim().max(40).optional().or(z.literal("")),
  clientEmail: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .optional()
    .or(z.literal("")),
  projectName: z.string().trim().min(1, "Project name is required").max(160),

  documentDate: z.string().trim().min(1, "Document date is required"),
  timeline: z.string().trim().max(120).optional().or(z.literal("")),
  campaignStartDate: z.string().trim().optional().or(z.literal("")),
  gracePeriod: z.string().trim().max(60).optional().or(z.literal("")),
  paidAmount: z.string().trim().max(60).optional().or(z.literal("")),
  paidDate: z.string().trim().optional().or(z.literal("")),
  counterpartAgreementNo: z.string().trim().max(60).optional().or(z.literal("")),
});

export type ContractInput = z.infer<typeof contractSchema>;

/** The house standard, stated in the spec's own notes column for
 * `{{GRACE_PERIOD}}`. Prefilled, and editable, because it is a term of the
 * deal rather than a constant of the document. */
export const DEFAULT_GRACE_PERIOD = "48 hours";

/** Likewise for `{{TIMELINE}}`, whose spec example is exactly this. */
export const DEFAULT_TIMELINE = "7 to 10 working days";

/* -------------------------------------------------------------------------
 * The picker
 * ---------------------------------------------------------------------- */

/** The four document types the owner names, mapped onto the storage shape.
 *
 * "Trial contract" is one choice here and two fields underneath, which is the
 * seam between how the business talks about the work and how the template
 * package is laid out. Picking it in the UI reveals the one extra question
 * the package needs answered — a trial of the one-time or of the
 * maintenance — and nothing else changes. */
export const CONTRACT_TYPE_CHOICES = [
  {
    id: "PROPOSAL",
    label: "Proposal",
    blurb: "What the work is and what it costs. No legal clauses, nothing to sign.",
    kind: "PROPOSAL" as ContractKind,
    trial: false,
  },
  {
    id: "ONE_TIME",
    label: "One-time",
    blurb: "The build-and-launch agreement. Paid once, delivered once.",
    kind: "ONE_TIME" as ContractKind,
    trial: false,
  },
  {
    id: "MAINTENANCE",
    label: "Maintenance",
    blurb: "The monthly agreement — system care and ad management.",
    kind: "MAINTENANCE" as ContractKind,
    trial: false,
  },
  {
    id: "TRIAL",
    label: "Trial",
    blurb: "Either agreement, where the first month is a mutual trial.",
    kind: null,
    trial: true,
  },
] as const;

/** Which of the four cards is lit for a stored contract. */
export function typeChoiceFor(kind: ContractKind, trial: boolean): string {
  return trial ? "TRIAL" : kind;
}

/** A one-line description of the deal, for a list row: "Standard · Meta +
 * Google · Trial · Real estate". */
export function dealSummary(deal: ContractDeal): string {
  const parts: string[] = [CONTRACT_PLAN_LABEL[deal.plan]];
  if (deal.plan === "WEBSITE" && deal.websiteTier) {
    parts[0] = `${WEBSITE_TIER_LABEL[deal.websiteTier]} website`;
  } else {
    parts.push(AD_SETUP_LABEL[deal.ads]);
  }
  if (deal.trial) parts.push("Trial");
  if (deal.realEstate) parts.push("Real estate");
  return parts.join(" · ");
}
