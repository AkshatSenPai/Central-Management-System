/** Token substitution and the spec's five validation checks. Pure — strings
 * in, strings out, no fs and no Prisma. `contract-template.ts` is the file
 * that reads the vendored HTML and calls into here.
 *
 * Spec §02: "A plain global string replace is sufficient — no template engine
 * required." True of the substitution itself. It is not true of *escaping*,
 * which a template engine would have done silently and which this file
 * therefore has to do out loud — see `substitute`.
 */

import {
  BLANK_FILL,
  CONTRACT_TOKENS,
  dueDateDay,
  longDate,
  longMonthYear,
  ordinalDay,
  parseAgreementNo,
  TOKEN_FIELD_LABEL,
  trialEndDate,
  type ContractDeal,
  type ContractToken,
  type TokenMap,
} from "@/lib/contract";

/* -------------------------------------------------------------------------
 * Substitution
 * ---------------------------------------------------------------------- */

/** Five characters, the standard set. `'` is included because it costs
 * nothing and removes the need for anyone reading this to first check whether
 * a token can land inside a single-quoted attribute. (It cannot — verified
 * across all 74 files, every token sits in text content — but "verified once
 * in 2026" is a weaker guarantee than "escaped".) */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TOKEN_PATTERN = /\{\{([A-Z_]+)\}\}/g;

/** Replaces every `{{TOKEN}}` in one pass.
 *
 * **Two maps, and the split is the point.** `text` holds what a person typed
 * — a client's name, their firm, a project — and every value in it is
 * HTML-escaped on the way in. `raw` holds the two kinds of value that are
 * markup by design: the real-estate clause block (a 7 KB fragment of the
 * document itself) and the dotted blank line spec §02 requires in place of an
 * unpaid amount. A token given in both maps throws, because "which one wins"
 * is not a question that should have a quiet answer.
 *
 * **One pass, not one pass per token.** A single regex with a callback means
 * a substituted value is never itself re-scanned, so a firm legitimately
 * named `{{ACME}}` — or a malicious one named `{{REAL_ESTATE_CLAUSES}}` —
 * lands as literal text instead of expanding. Twenty sequential
 * `String.replaceAll` calls would not have that property, and the bug it
 * produces appears in exactly one client's contract months later.
 *
 * An unknown token is left standing rather than replaced with an empty
 * string. `unsubstitutedTokens` is what turns that into a blocked render, and
 * a check that can see the problem beats a substitution that hides it. */
export function substitute(html: string, text: TokenMap, raw: TokenMap = {}): string {
  for (const key of Object.keys(raw) as ContractToken[]) {
    if (key in text) {
      throw new Error(`substitute: ${key} was supplied as both escaped text and raw markup`);
    }
  }
  return html.replace(TOKEN_PATTERN, (whole, name: string) => {
    const token = name as ContractToken;
    if (token in raw) return raw[token]!;
    if (token in text) return escapeHtml(text[token]!);
    return whole;
  });
}

/* -------------------------------------------------------------------------
 * Building the token values
 * ---------------------------------------------------------------------- */

/** Everything the token values are built from, after the action layer has
 * parsed dates and mapped empty strings to null. Dates are the UTC-midnight
 * calendar dates `parseDateInput` produces. */
export type ContractFacts = {
  deal: ContractDeal;
  agreementNo: string;
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
  /** The real-estate clause block, already read from `_snippets/`. Null when
   * the deal is not a real-estate one — which still produces an entry in
   * `raw`, holding `""`, because spec §04 says the token is replaced with an
   * empty string rather than left in place. */
  realEstateClauses: string | null;
};

/** Turns the facts into the two maps `substitute` wants.
 *
 * Derived rather than asked for, and each for a stated reason:
 *   - `MONTH_YEAR` from `documentDate`
 *   - `DUE_DATE_DAY` from `campaignStartDate` (spec §05 check 5)
 *   - `TRIAL_START_DATE` = `campaignStartDate`; the trial is the first month
 *     of the engagement, so they are the same day by definition
 *   - `TRIAL_END_DATE` from that (spec §05 check 5)
 *   - `CLIENT_FIRM_UPPER` from `clientFirm`
 *
 * A token the deal does not use is simply absent from the result. The
 * template does not contain it, so there is nothing to replace; supplying it
 * anyway would be harmless but would make `tokensFor` and this function two
 * separate claims about the same thing. */
export function buildTokens(facts: ContractFacts): { text: TokenMap; raw: TokenMap } {
  const { deal } = facts;
  const text: TokenMap = {};
  const raw: TokenMap = {};

  text.CLIENT_NAME = facts.clientName;
  text.CLIENT_FIRM = facts.clientFirm;
  text.PROJECT_NAME = facts.projectName;
  text.MONTH_YEAR = longMonthYear(facts.documentDate);

  if (deal.kind === "PROPOSAL") {
    // The cover kicker and the page footer, per spec §02's notes column.
    // `toUpperCase` on the firm rather than a second input: two fields that
    // must always agree are one field and a transform.
    text.CLIENT_FIRM_UPPER = facts.clientFirm.toUpperCase();
    text.TIMELINE = facts.timeline ?? "";
    return { text, raw };
  }

  text.AGREEMENT_NO = facts.agreementNo;
  text.CLIENT_PHONE = facts.clientPhone ?? "";
  text.CLIENT_EMAIL = facts.clientEmail ?? "";

  // Spec §04: an empty string when the client is not a real-estate project.
  // `raw` and not `text`, in both branches — escaping "" is a no-op, but
  // routing one branch through the escaped map and the other through the raw
  // one would mean the token's handling depended on the answer.
  raw.REAL_ESTATE_CLAUSES = facts.realEstateClauses ?? "";

  if (deal.kind === "ONE_TIME") {
    text.MAINTENANCE_AGREEMENT_NO = facts.counterpartAgreementNo ?? "";
    text.TIMELINE = facts.timeline ?? "";
    // Spec §02: a dotted rule to write on, not an empty string, when unpaid.
    if (facts.paidAmount) text.PAID_AMOUNT = facts.paidAmount;
    else raw.PAID_AMOUNT = BLANK_FILL;
    if (facts.paidDate) text.PAID_DATE = longDate(facts.paidDate);
    else raw.PAID_DATE = BLANK_FILL;
    return { text, raw };
  }

  text.ONETIME_AGREEMENT_NO = facts.counterpartAgreementNo ?? "";
  text.GRACE_PERIOD = facts.gracePeriod ?? "";
  if (facts.campaignStartDate) {
    text.CAMPAIGN_START_DATE = longDate(facts.campaignStartDate);
    text.DUE_DATE_DAY = dueDateDay(facts.campaignStartDate);
    if (deal.trial) {
      text.TRIAL_START_DATE = longDate(facts.campaignStartDate);
      text.TRIAL_END_DATE = longDate(trialEndDate(facts.campaignStartDate));
    }
  }
  return { text, raw };
}

/* -------------------------------------------------------------------------
 * Validation — spec §05
 * ---------------------------------------------------------------------- */

/** Check 1. "Regex the rendered HTML for `\{\{[A-Z_]+\}\}`. If anything
 * matches, block the render. A contract that goes out saying
 * {{CLIENT_NAME}} is worse than no contract."
 *
 * Deduplicated and in document order — a token missed 40 times is one
 * mistake, and a list repeating it 40 times buries the second one. */
export function unsubstitutedTokens(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(TOKEN_PATTERN)) found.add(match[1]);
  return [...found];
}

const CLAUSE_NUMBER = /class="num">([^<]*)<\/span>/g;

/** Every clause number in the rendered document, in order. The spec writes
 * the pattern as `num">(…)</span>`; anchoring on `class="num"` is the same
 * match against these templates and refuses to also collect, say, a
 * `data-num` that someone adds later. */
export function clauseNumbers(html: string): string[] {
  return [...html.matchAll(CLAUSE_NUMBER)].map((m) => m[1].trim());
}

/** Check 2. "Extract all matches ... and assert the list has no duplicates.
 * This is the check that would have caught a real numbering bug found during
 * build."
 *
 * The bug it guards against is specific and easy to reintroduce: using the
 * one-time real-estate snippet (10F-10L) in a maintenance agreement, whose
 * own clauses already run to 12. `resolveSnippetPath` is what picks the right
 * one; this is what proves it did. */
export function duplicateClauseNumbers(html: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const number of clauseNumbers(html)) {
    if (seen.has(number)) duplicates.add(number);
    seen.add(number);
  }
  return [...duplicates];
}

const LETTERED_CLAUSE = /^(\d{1,2})([A-Z])$/;

/** Check 2b, and it is this file's own addition rather than the spec's.
 *
 * **Spec §04 and §05 both claim that using the wrong real-estate snippet
 * "produces duplicate clause numbers", and against this package that is not
 * true.** Verified against the real files: a one-time agreement numbers its
 * lettered sub-clauses 10A-10E and its snippet continues 10F-10L; a
 * maintenance agreement numbers its own 12A-12E and its snippet continues
 * 12F-12L. Cross them over and a maintenance agreement gains clauses
 * 10F-10L — beside its existing `10` and `10A`, and colliding with neither.
 * `duplicateClauseNumbers` returns nothing. The document is silently wrong:
 * seven clauses filed under the wrong block, cross-referencing a "Clause 10C"
 * that does not exist in a maintenance agreement (its indemnity is 12C).
 *
 * So the failure the spec wanted caught is real, and the check it specified
 * does not catch it. This one does, by a more general invariant: **a lettered
 * clause run may not have a gap.** `10F` without `10E` is either the wrong
 * snippet or a template that lost a clause, and both are worth blocking.
 *
 * `duplicateClauseNumbers` is kept and still runs — it is cheap, it is what
 * the spec asked for, and it catches a different failure (the same clause
 * twice) that this check would not. */
export function letteringGaps(html: string): string[] {
  const present = new Set(clauseNumbers(html));
  const gaps: string[] = [];
  for (const number of present) {
    const match = LETTERED_CLAUSE.exec(number);
    if (!match) continue;
    const [, block, letter] = match;
    if (letter === "A") continue;
    const previous = `${block}${String.fromCharCode(letter.charCodeAt(0) - 1)}`;
    if (!present.has(previous)) gaps.push(`${number} follows nothing — ${previous} is missing`);
  }
  return gaps.sort();
}

/** Check 3. "If both agreements are generated for one client, assert that the
 * one-time document's {{MAINTENANCE_AGREEMENT_NO}} matches the maintenance
 * document's {{AGREEMENT_NO}}, and vice versa."
 *
 * Both arguments are the *stored* numbers of the two documents, not the
 * rendered HTML: comparing the strings that went in is the same assertion
 * without having to parse two documents back out again.
 *
 * A blank cross-reference is not a failure. A one-time agreement is
 * frequently written before the maintenance one exists, and refusing to issue
 * it until its counterpart has a number would make the pair impossible to
 * start. Only a *wrong* number is refused. */
export function crossReferenceProblem(input: {
  oneTimeNo: string;
  oneTimeSaysMaintenanceIs: string | null;
  maintenanceNo: string;
  maintenanceSaysOneTimeIs: string | null;
}): string | null {
  const { oneTimeNo, oneTimeSaysMaintenanceIs, maintenanceNo, maintenanceSaysOneTimeIs } = input;
  if (oneTimeSaysMaintenanceIs && oneTimeSaysMaintenanceIs !== maintenanceNo) {
    return `The one-time agreement cross-references ${oneTimeSaysMaintenanceIs}, but the maintenance agreement is ${maintenanceNo}`;
  }
  if (maintenanceSaysOneTimeIs && maintenanceSaysOneTimeIs !== oneTimeNo) {
    return `The maintenance agreement cross-references ${maintenanceSaysOneTimeIs}, but the one-time agreement is ${oneTimeNo}`;
  }
  return null;
}

/** A cross-reference that is not a well-formed agreement number at all.
 * Softer than `crossReferenceProblem` — it does not need the other document
 * to exist, so it can run on a single contract at issue time. Returns null
 * for a blank, which is allowed. */
export function crossReferenceShapeProblem(value: string | null): string | null {
  if (!value) return null;
  return parseAgreementNo(value)
    ? null
    : `"${value}" is not an agreement number — the format is SO/OT/2026/055`;
}

const MONTH_NAMES = [
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

/** Reads a rendered `{{...}}` date string — "15 August 2026" — back to the
 * UTC-midnight date it came from. Null on anything else.
 *
 * This exists so check 5 can assert against the strings that will actually be
 * in the client's PDF, rather than against the `Date` objects that produced
 * them. A formatter bug that renders the right day in the wrong month is
 * invisible to a check that never looks at its output. */
export function parseLongDate(value: string): Date | null {
  const match = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = MONTH_NAMES.indexOf(match[2]);
  if (month < 0) return null;
  const day = Number(match[1]);
  const date = new Date(Date.UTC(Number(match[3]), month, day));
  // Rejects "31 February 2026", which Date.UTC would roll forward to 3 March.
  return date.getUTCDate() === day ? date : null;
}

/** Check 5. "For trial templates, assert TRIAL_END_DATE is the day before the
 * same calendar day one month after TRIAL_START_DATE, and that DUE_DATE_DAY
 * matches the day of CAMPAIGN_START_DATE."
 *
 * `buildTokens` derives all four values from one input, so this cannot fail
 * unless that derivation is broken — which is exactly what it is here to
 * catch. It works from the *rendered* strings, parsed back: a check that
 * recomputed from `ContractFacts` would agree with a buggy builder for the
 * same reason the builder was buggy. */
export function trialDateProblem(text: TokenMap, deal: ContractDeal): string | null {
  if (deal.kind !== "MAINTENANCE") return null;
  const campaign = text.CAMPAIGN_START_DATE;
  const dueDay = text.DUE_DATE_DAY;
  if (!campaign || !dueDay) return null;

  const campaignDate = parseLongDate(campaign);
  if (!campaignDate) return `The campaign start date "${campaign}" is not a date`;

  if (dueDay !== ordinalDay(campaignDate.getUTCDate())) {
    return `The due date (${dueDay}) does not match the campaign start (${campaign})`;
  }
  if (!deal.trial) return null;

  if (text.TRIAL_START_DATE !== campaign) {
    return `The trial starts ${text.TRIAL_START_DATE}, but the campaign starts ${campaign}`;
  }
  const end = text.TRIAL_END_DATE ? parseLongDate(text.TRIAL_END_DATE) : null;
  if (!end) return `The trial end date "${text.TRIAL_END_DATE ?? ""}" is not a date`;
  if (end.getTime() !== trialEndDate(campaignDate).getTime()) {
    return `A trial starting ${campaign} ends ${longDate(trialEndDate(campaignDate))}, not ${text.TRIAL_END_DATE}`;
  }
  return null;
}

export type RenderProblem = { check: string; detail: string };

/** Checks 1, 2 and 5, run over one finished document. 3 needs both halves of
 * a pair and is called separately by the service; 4 ("no page ends on an
 * orphaned heading") is a CSS guarantee the templates already carry — spec
 * §05 check 4 says the two rules are in place and must not be removed, which
 * is a review instruction, not something a string check can assert.
 *
 * Returns every problem rather than the first. A render that is blocked twice
 * should say so once. */
export function validateRendered(
  html: string,
  text: TokenMap,
  deal: ContractDeal
): RenderProblem[] {
  const problems: RenderProblem[] = [];

  const left = unsubstitutedTokens(html);
  if (left.length > 0) {
    // Named by the field somebody fills in, not by the token. Four tokens are
    // derived from "Campaign start" alone, so the token list reads as four
    // problems when it is one empty box — and `{{DUE_DATE_DAY}}` is not a
    // thing anybody can go and fix. Deduplicated, in first-seen order.
    const fields = [
      ...new Set(
        left.map((token) => TOKEN_FIELD_LABEL[token as ContractToken] ?? `{{${token}}}`)
      ),
    ];
    problems.push({
      check: fields.length === 1 ? "Missing field" : "Missing fields",
      detail: fields.join(", "),
    });
  }

  const duplicates = duplicateClauseNumbers(html);
  if (duplicates.length > 0) {
    problems.push({
      check: "Duplicate clause numbers",
      detail: duplicates.join(", "),
    });
  }

  const gaps = letteringGaps(html);
  if (gaps.length > 0) {
    problems.push({ check: "Broken clause lettering", detail: gaps.join("; ") });
  }

  const trial = trialDateProblem(text, deal);
  if (trial) problems.push({ check: "Trial and due dates", detail: trial });

  return problems;
}

/** Every token name the type knows about, as a set, for the template-drift
 * test in `tests/contract-template.test.ts`. */
export const KNOWN_TOKENS: ReadonlySet<string> = new Set(CONTRACT_TOKENS);
