import { describe, it, expect } from "vitest";
import {
  buildTokens,
  clauseNumbers,
  crossReferenceProblem,
  crossReferenceShapeProblem,
  duplicateClauseNumbers,
  escapeHtml,
  letteringGaps,
  parseLongDate,
  substitute,
  trialDateProblem,
  unsubstitutedTokens,
  validateRendered,
  type ContractFacts,
} from "@/lib/contract-render";
import type { ContractDeal } from "@/lib/contract";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const maintenance: ContractDeal = {
  kind: "MAINTENANCE",
  trial: false,
  plan: "STANDARD",
  ads: "BOTH",
  websiteTier: null,
  realEstate: false,
};

function facts(deal: ContractDeal, overrides: Partial<ContractFacts> = {}): ContractFacts {
  return {
    deal,
    agreementNo: "SO/MT/2026/055",
    clientName: "Mr. Sandeep Singh",
    clientFirm: "Magus Realty, Lucknow",
    clientPhone: "+91 73909 38686",
    clientEmail: "client@example.com",
    projectName: "Wave City Plots",
    documentDate: utc(2026, 8, 1),
    timeline: "7 to 10 working days",
    campaignStartDate: utc(2026, 8, 15),
    gracePeriod: "48 hours",
    paidAmount: "₹22,998",
    paidDate: utc(2026, 8, 14),
    counterpartAgreementNo: "SO/OT/2026/055",
    realEstateClauses: null,
    ...overrides,
  };
}

describe("substitute", () => {
  it("replaces every occurrence of a token", () => {
    expect(substitute("{{CLIENT_NAME}} and {{CLIENT_NAME}}", { CLIENT_NAME: "Sandeep" })).toBe(
      "Sandeep and Sandeep"
    );
  });

  it("escapes text values", () => {
    expect(substitute("{{CLIENT_FIRM}}", { CLIENT_FIRM: "Harlow & Fitch" })).toBe(
      "Harlow &amp; Fitch"
    );
    expect(substitute("{{CLIENT_NAME}}", { CLIENT_NAME: '<script>alert("x")</script>' })).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  it("inserts raw values verbatim", () => {
    expect(
      substitute("{{REAL_ESTATE_CLAUSES}}", {}, { REAL_ESTATE_CLAUSES: "<h3>10F</h3>" })
    ).toBe("<h3>10F</h3>");
  });

  /** The reason this is one regex pass and not twenty replaceAll calls. A
   * value that looks like a token must land as literal text. */
  it("never re-scans what it substituted", () => {
    expect(substitute("{{CLIENT_FIRM}}", { CLIENT_FIRM: "{{REAL_ESTATE_CLAUSES}}" })).toBe(
      "{{REAL_ESTATE_CLAUSES}}"
    );
    expect(
      substitute(
        "{{CLIENT_FIRM}} {{PROJECT_NAME}}",
        { CLIENT_FIRM: "{{PROJECT_NAME}}", PROJECT_NAME: "Wave City" }
      )
    ).toBe("{{PROJECT_NAME}} Wave City");
  });

  it("leaves an unknown token standing rather than blanking it", () => {
    expect(substitute("{{NOPE}}", { CLIENT_NAME: "x" })).toBe("{{NOPE}}");
  });

  it("refuses a token supplied as both text and raw", () => {
    expect(() => substitute("{{PAID_AMOUNT}}", { PAID_AMOUNT: "a" }, { PAID_AMOUNT: "b" })).toThrow(
      /both/i
    );
  });

  it("escapes the five characters and no others", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
    expect(escapeHtml("₹22,998 — Wave City")).toBe("₹22,998 — Wave City");
  });
});

describe("buildTokens", () => {
  it("derives the due day and both trial dates from one campaign start", () => {
    const { text } = buildTokens(facts({ ...maintenance, trial: true }));
    expect(text.CAMPAIGN_START_DATE).toBe("15 August 2026");
    expect(text.DUE_DATE_DAY).toBe("15th");
    expect(text.TRIAL_START_DATE).toBe("15 August 2026");
    expect(text.TRIAL_END_DATE).toBe("14 September 2026");
  });

  it("omits the trial dates when the agreement has no trial", () => {
    const { text } = buildTokens(facts(maintenance));
    expect(text.TRIAL_START_DATE).toBeUndefined();
    expect(text.TRIAL_END_DATE).toBeUndefined();
  });

  it("uppercases the firm for a proposal rather than asking twice", () => {
    const { text } = buildTokens(
      facts({ ...maintenance, kind: "PROPOSAL" }, { clientFirm: "Magus Realty" })
    );
    expect(text.CLIENT_FIRM_UPPER).toBe("MAGUS REALTY");
  });

  it("gives a proposal no agreement number and no clause block", () => {
    const { text, raw } = buildTokens(facts({ ...maintenance, kind: "PROPOSAL" }));
    expect(text.AGREEMENT_NO).toBeUndefined();
    expect(raw.REAL_ESTATE_CLAUSES).toBeUndefined();
  });

  it("replaces the toggle with an empty string when not a real-estate deal", () => {
    const { raw } = buildTokens(facts(maintenance));
    expect(raw.REAL_ESTATE_CLAUSES).toBe("");
  });

  /** Spec §02: a dotted rule to write on, not an empty string. */
  it("puts a blank rule in place of an unpaid amount and date", () => {
    const oneTime: ContractDeal = { ...maintenance, kind: "ONE_TIME" };
    const { raw, text } = buildTokens(facts(oneTime, { paidAmount: null, paidDate: null }));
    expect(raw.PAID_AMOUNT).toContain('class="blank"');
    expect(raw.PAID_DATE).toContain('class="blank"');
    expect(text.PAID_AMOUNT).toBeUndefined();
  });

  it("uses the typed amount when there is one", () => {
    const oneTime: ContractDeal = { ...maintenance, kind: "ONE_TIME" };
    const { text, raw } = buildTokens(facts(oneTime));
    expect(text.PAID_AMOUNT).toBe("₹22,998");
    expect(text.PAID_DATE).toBe("14 August 2026");
    expect(raw.PAID_AMOUNT).toBeUndefined();
  });
});

describe("check 1 — unsubstituted tokens", () => {
  it("finds what is left, deduplicated", () => {
    expect(unsubstitutedTokens("{{A}} {{B}} {{A}}")).toEqual(["A", "B"]);
    expect(unsubstitutedTokens("nothing here")).toEqual([]);
  });

  it("is what validateRendered blocks on", () => {
    const problems = validateRendered("{{CLIENT_NAME}}", {}, maintenance);
    expect(problems[0].check).toBe("Unsubstituted tokens");
    expect(problems[0].detail).toBe("{{CLIENT_NAME}}");
  });
});

describe("check 2 — clause numbers", () => {
  const doc = (...numbers: string[]) =>
    numbers.map((n) => `<span class="num">${n}</span>`).join("");

  it("reads them in document order", () => {
    expect(clauseNumbers(doc("02", "10A", "10B"))).toEqual(["02", "10A", "10B"]);
  });

  it("reports a repeat", () => {
    expect(duplicateClauseNumbers(doc("10A", "10B", "10A"))).toEqual(["10A"]);
    expect(duplicateClauseNumbers(doc("10A", "10B"))).toEqual([]);
  });
});

describe("check 2b — lettering gaps", () => {
  const doc = (...numbers: string[]) =>
    numbers.map((n) => `<span class="num">${n}</span>`).join("");

  it("accepts a contiguous run", () => {
    expect(letteringGaps(doc("10A", "10B", "10C"))).toEqual([]);
  });

  /** The wrong real-estate snippet: 10F-10L dropped into a document whose
   * own lettered block stops at 10A. Only the seam is reported — 10G follows
   * 10F, which is present, so the run is intact from there on. One complaint
   * per break is the point; seven would bury it. */
  it("names the seam, once", () => {
    expect(letteringGaps(doc("10", "10A", "10F", "10G"))).toEqual([
      "10F follows nothing — 10E is missing",
    ]);
  });

  it("reports each separate break", () => {
    expect(letteringGaps(doc("10A", "10C", "10E"))).toEqual([
      "10C follows nothing — 10B is missing",
      "10E follows nothing — 10D is missing",
    ]);
  });

  it("does not complain about an A with no predecessor", () => {
    expect(letteringGaps(doc("12", "12A"))).toEqual([]);
  });

  it("treats blocks independently", () => {
    expect(letteringGaps(doc("10A", "10B", "12A", "12B"))).toEqual([]);
  });
});

describe("check 3 — cross-references", () => {
  it("passes when both point at each other", () => {
    expect(
      crossReferenceProblem({
        oneTimeNo: "SO/OT/2026/055",
        oneTimeSaysMaintenanceIs: "SO/MT/2026/055",
        maintenanceNo: "SO/MT/2026/055",
        maintenanceSaysOneTimeIs: "SO/OT/2026/055",
      })
    ).toBeNull();
  });

  /** A one-time agreement is routinely written before its maintenance
   * counterpart exists, so a blank must not block it. */
  it("allows a blank on either side", () => {
    expect(
      crossReferenceProblem({
        oneTimeNo: "SO/OT/2026/055",
        oneTimeSaysMaintenanceIs: null,
        maintenanceNo: "SO/MT/2026/055",
        maintenanceSaysOneTimeIs: null,
      })
    ).toBeNull();
  });

  it("catches a mismatch in either direction", () => {
    expect(
      crossReferenceProblem({
        oneTimeNo: "SO/OT/2026/055",
        oneTimeSaysMaintenanceIs: "SO/MT/2026/054",
        maintenanceNo: "SO/MT/2026/055",
        maintenanceSaysOneTimeIs: "SO/OT/2026/055",
      })
    ).toMatch(/054/);
    expect(
      crossReferenceProblem({
        oneTimeNo: "SO/OT/2026/055",
        oneTimeSaysMaintenanceIs: "SO/MT/2026/055",
        maintenanceNo: "SO/MT/2026/055",
        maintenanceSaysOneTimeIs: "SO/OT/2026/099",
      })
    ).toMatch(/099/);
  });

  it("refuses a cross-reference that is not an agreement number", () => {
    expect(crossReferenceShapeProblem("the other one")).toMatch(/not an agreement number/i);
    expect(crossReferenceShapeProblem("SO/OT/2026/055")).toBeNull();
    expect(crossReferenceShapeProblem(null)).toBeNull();
  });
});

describe("check 5 — trial and due dates", () => {
  it("passes what buildTokens produces", () => {
    const deal = { ...maintenance, trial: true };
    const { text } = buildTokens(facts(deal));
    expect(trialDateProblem(text, deal)).toBeNull();
  });

  it("catches a due day that disagrees with the campaign start", () => {
    const deal = { ...maintenance, trial: true };
    const { text } = buildTokens(facts(deal));
    expect(trialDateProblem({ ...text, DUE_DATE_DAY: "1st" }, deal)).toMatch(/does not match/i);
  });

  it("catches a trial end that is not one month less a day", () => {
    const deal = { ...maintenance, trial: true };
    const { text } = buildTokens(facts(deal));
    expect(trialDateProblem({ ...text, TRIAL_END_DATE: "15 September 2026" }, deal)).toMatch(
      /ends 14 September 2026/
    );
  });

  it("ignores a one-time agreement, which has neither", () => {
    expect(trialDateProblem({}, { ...maintenance, kind: "ONE_TIME" })).toBeNull();
  });

  it("reads a rendered date back", () => {
    expect(parseLongDate("15 August 2026")).toEqual(utc(2026, 8, 15));
    expect(parseLongDate("1 January 2026")).toEqual(utc(2026, 1, 1));
    expect(parseLongDate("31 February 2026")).toBeNull();
    expect(parseLongDate("15 Augst 2026")).toBeNull();
    expect(parseLongDate("2026-08-15")).toBeNull();
  });
});
