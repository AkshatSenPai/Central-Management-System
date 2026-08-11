import { describe, it, expect } from "vitest";
import {
  contractFormValues,
  contractSchema,
  dealProblem,
  dealSummary,
  dueDateDay,
  formatAgreementNo,
  longDate,
  longMonthYear,
  ordinalDay,
  parseAgreementNo,
  planIsAvailable,
  realEstateIsAvailable,
  tokensFor,
  trialEndDate,
  trialIsAvailable,
  typeChoiceFor,
  type ContractDeal,
} from "@/lib/contract";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("the agreement register format", () => {
  it("pads to three digits and uses the kind's series letter", () => {
    expect(formatAgreementNo("ONE_TIME", 2026, 55)).toBe("SO/OT/2026/055");
    expect(formatAgreementNo("MAINTENANCE", 2026, 55)).toBe("SO/MT/2026/055");
    expect(formatAgreementNo("PROPOSAL", 2026, 1)).toBe("SO/PR/2026/001");
  });

  it("widens rather than wrapping past 999", () => {
    expect(formatAgreementNo("ONE_TIME", 2026, 1000)).toBe("SO/OT/2026/1000");
  });

  it("round-trips through the parser", () => {
    expect(parseAgreementNo("SO/OT/2026/055")).toEqual({
      series: "OT",
      year: 2026,
      sequence: 55,
    });
    expect(parseAgreementNo("  SO/MT/2026/007  ")).toEqual({
      series: "MT",
      year: 2026,
      sequence: 7,
    });
  });

  it("refuses anything that is not the format, rather than coercing it", () => {
    for (const bad of ["", "055", "SO/XX/2026/055", "SO/OT/26/055", "SO/OT/2026/5", "so/ot/2026/055"]) {
      expect(parseAgreementNo(bad), bad).toBeNull();
    }
  });
});

describe("ordinals", () => {
  it("gets the teens right — the reason this is not n % 10", () => {
    expect(ordinalDay(11)).toBe("11th");
    expect(ordinalDay(12)).toBe("12th");
    expect(ordinalDay(13)).toBe("13th");
  });

  it("handles the rest", () => {
    const expected: Record<number, string> = {
      1: "1st",
      2: "2nd",
      3: "3rd",
      4: "4th",
      10: "10th",
      21: "21st",
      22: "22nd",
      23: "23rd",
      30: "30th",
      31: "31st",
    };
    for (const [day, label] of Object.entries(expected)) {
      expect(ordinalDay(Number(day))).toBe(label);
    }
  });

  it("reads the day out of a campaign start", () => {
    expect(dueDateDay(utc(2026, 8, 15))).toBe("15th");
    expect(dueDateDay(utc(2026, 8, 1))).toBe("1st");
  });
});

describe("trialEndDate", () => {
  it("is the day before the same calendar day one month on — spec §05 check 5", () => {
    expect(trialEndDate(utc(2026, 8, 15))).toEqual(utc(2026, 9, 14));
    expect(trialEndDate(utc(2026, 1, 1))).toEqual(utc(2026, 1, 31));
  });

  it("crosses a year boundary", () => {
    expect(trialEndDate(utc(2026, 12, 15))).toEqual(utc(2027, 1, 14));
  });

  /** The case that would otherwise sell a 31-day trial as a one-month one:
   * `setUTCMonth` alone rolls 31 January forward to 3 March. */
  it("clamps rather than rolling over when the target month is shorter", () => {
    expect(trialEndDate(utc(2026, 1, 31))).toEqual(utc(2026, 2, 27));
    expect(trialEndDate(utc(2026, 3, 31))).toEqual(utc(2026, 4, 29));
  });

  it("handles a leap February", () => {
    expect(trialEndDate(utc(2028, 1, 30))).toEqual(utc(2028, 2, 28));
  });
});

describe("dates as a contract prints them", () => {
  it("spells the month out", () => {
    expect(longDate(utc(2026, 8, 15))).toBe("15 August 2026");
    expect(longMonthYear(utc(2026, 8, 1))).toBe("August 2026");
  });

  /** These read UTC fields on purpose — a contract date is a calendar date,
   * not an instant. A value stored at UTC midnight must print as that day. */
  it("prints the stored calendar day, not a timezone-shifted one", () => {
    expect(longDate(new Date("2026-08-15T00:00:00.000Z"))).toBe("15 August 2026");
    expect(longDate(new Date("2026-01-01T00:00:00.000Z"))).toBe("1 January 2026");
  });
});

describe("which combinations exist", () => {
  it("has no website proposal and no trial proposal", () => {
    expect(planIsAvailable("PROPOSAL", "WEBSITE")).toBe(false);
    expect(planIsAvailable("ONE_TIME", "WEBSITE")).toBe(true);
    expect(trialIsAvailable("PROPOSAL")).toBe(false);
    expect(trialIsAvailable("MAINTENANCE")).toBe(true);
    expect(realEstateIsAvailable("PROPOSAL")).toBe(false);
  });

  it("names the reason a deal cannot be built", () => {
    const base: ContractDeal = {
      kind: "PROPOSAL",
      trial: false,
      plan: "STARTER",
      ads: "META",
      websiteTier: null,
      realEstate: false,
    };
    expect(dealProblem(base)).toBeNull();
    expect(dealProblem({ ...base, realEstate: true })).toMatch(/no clauses/i);
    expect(dealProblem({ ...base, trial: true })).toMatch(/trial is a term/i);
    expect(dealProblem({ ...base, plan: "WEBSITE", websiteTier: "BUSINESS" })).toMatch(
      /no website proposal/i
    );
  });
});

describe("tokensFor", () => {
  it("gives a proposal no agreement number and no clauses toggle", () => {
    const tokens = tokensFor("PROPOSAL", false);
    expect(tokens).not.toContain("AGREEMENT_NO");
    expect(tokens).not.toContain("REAL_ESTATE_CLAUSES");
    expect(tokens).toContain("CLIENT_FIRM_UPPER");
  });

  /** The cross-references point at each other. Reading "the token on the
   * maintenance document is the maintenance number" is the mistake. */
  it("puts each document's counterpart number on the other document", () => {
    expect(tokensFor("ONE_TIME", false)).toContain("MAINTENANCE_AGREEMENT_NO");
    expect(tokensFor("ONE_TIME", false)).not.toContain("ONETIME_AGREEMENT_NO");
    expect(tokensFor("MAINTENANCE", false)).toContain("ONETIME_AGREEMENT_NO");
    expect(tokensFor("MAINTENANCE", false)).not.toContain("MAINTENANCE_AGREEMENT_NO");
  });

  /** Trial dates live on the maintenance half of the pair only — the one-time
   * trial templates differ by a cover badge, not by dates. */
  it("adds trial dates to a trial maintenance agreement and nothing else", () => {
    expect(tokensFor("MAINTENANCE", true)).toContain("TRIAL_START_DATE");
    expect(tokensFor("MAINTENANCE", true)).toContain("TRIAL_END_DATE");
    expect(tokensFor("ONE_TIME", true)).not.toContain("TRIAL_START_DATE");
    expect(tokensFor("MAINTENANCE", false)).not.toContain("TRIAL_START_DATE");
  });
});

describe("dealSummary", () => {
  const base: ContractDeal = {
    kind: "MAINTENANCE",
    trial: false,
    plan: "STANDARD",
    ads: "BOTH",
    websiteTier: null,
    realEstate: false,
  };

  it("reads as a sentence fragment", () => {
    expect(dealSummary(base)).toBe("Standard · Meta + Google");
    expect(dealSummary({ ...base, trial: true, realEstate: true })).toBe(
      "Standard · Meta + Google · Trial · Real estate"
    );
  });

  it("names the tier rather than the ad setup for a website deal", () => {
    expect(dealSummary({ ...base, plan: "WEBSITE", websiteTier: "FLAGSHIP" })).toBe(
      "Flagship website"
    );
  });
});

describe("the four-type picker", () => {
  it("maps a trial of either agreement onto the one Trial card", () => {
    expect(typeChoiceFor("ONE_TIME", false)).toBe("ONE_TIME");
    expect(typeChoiceFor("MAINTENANCE", false)).toBe("MAINTENANCE");
    expect(typeChoiceFor("PROPOSAL", false)).toBe("PROPOSAL");
    expect(typeChoiceFor("ONE_TIME", true)).toBe("TRIAL");
    expect(typeChoiceFor("MAINTENANCE", true)).toBe("TRIAL");
  });
});

/** The seam between the form and the schema, and the one nothing covered
 * until a browser found it.
 *
 * The form renders only the fields the chosen template needs, so on a
 * maintenance agreement `timeline`, `paidAmount`, `paidDate` and
 * `websiteTier` are simply not in the DOM. `formData.get()` returns `null`
 * for those, `.optional()` admits `undefined` but not `null`, and every
 * single draft was refused with zod's fallback "Invalid input" — naming no
 * field, because the failure was a union branch rather than a named rule.
 *
 * These tests build the FormData the browser actually submits, verified by
 * reading it out of the live form. */
describe("contractFormValues", () => {
  function maintenanceForm(): FormData {
    const fd = new FormData();
    // Exactly what a trial maintenance agreement posts — note the four keys
    // that are absent rather than blank.
    fd.set("kind", "MAINTENANCE");
    fd.set("trial", "on");
    fd.set("plan", "STANDARD");
    fd.set("ads", "META");
    fd.set("realEstate", "on");
    fd.set("clientName", "Mr. Sandeep Singh");
    fd.set("clientFirm", "Magus Realty, Lucknow");
    fd.set("clientPhone", "+91 73909 38686");
    fd.set("clientEmail", "sandeep@example.com");
    fd.set("projectName", "Wave City Plots");
    fd.set("documentDate", "2026-08-11");
    fd.set("campaignStartDate", "2026-08-15");
    fd.set("gracePeriod", "48 hours");
    fd.set("counterpartAgreementNo", "");
    return fd;
  }

  it("parses a maintenance form whose optional fields were never rendered", () => {
    const parsed = contractSchema.safeParse(contractFormValues(maintenanceForm()));
    expect(parsed.success, parsed.error?.issues[0]?.message).toBe(true);
    expect(parsed.data?.kind).toBe("MAINTENANCE");
    expect(parsed.data?.trial).toBe(true);
    expect(parsed.data?.realEstate).toBe(true);
  });

  it("turns an absent key into a blank, not a null", () => {
    const values = contractFormValues(maintenanceForm());
    for (const absent of ["timeline", "paidAmount", "paidDate", "websiteTier"]) {
      expect(values[absent], absent).toBe("");
    }
  });

  it("parses a proposal form, which renders fewer fields still", () => {
    const fd = new FormData();
    fd.set("kind", "PROPOSAL");
    fd.set("plan", "STANDARD");
    fd.set("ads", "META");
    fd.set("clientName", "Mr. Sandeep Singh");
    fd.set("clientFirm", "Magus Realty, Lucknow");
    fd.set("projectName", "Wave City Plots");
    fd.set("documentDate", "2026-08-11");
    fd.set("timeline", "7 to 10 working days");
    const parsed = contractSchema.safeParse(contractFormValues(fd));
    expect(parsed.success, parsed.error?.issues[0]?.message).toBe(true);
    expect(parsed.data?.trial).toBe(false);
    expect(parsed.data?.realEstate).toBe(false);
  });

  /** An unticked checkbox omits its key entirely; presence is the answer. */
  it("reads an unticked checkbox as false rather than missing", () => {
    const fd = maintenanceForm();
    fd.delete("trial");
    fd.delete("realEstate");
    const values = contractFormValues(fd);
    expect(values.trial).toBe(false);
    expect(values.realEstate).toBe(false);
  });

  /** A file input posted under a field name would otherwise reach zod as a
   * File and fail with the same unnamed union error. */
  it("treats a non-string value as blank", () => {
    const fd = maintenanceForm();
    fd.set("timeline", new Blob(["x"]), "x.txt");
    expect(contractFormValues(fd).timeline).toBe("");
  });
});

describe("contractSchema", () => {
  const valid = {
    kind: "ONE_TIME",
    trial: false,
    plan: "STANDARD",
    ads: "BOTH",
    websiteTier: "",
    realEstate: false,
    clientName: "Mr. Sandeep Singh",
    clientFirm: "Magus Realty, Lucknow",
    clientPhone: "+91 73909 38686",
    clientEmail: "client@example.com",
    projectName: "Wave City Plots",
    documentDate: "2026-08-01",
    timeline: "7 to 10 working days",
    campaignStartDate: "",
    gracePeriod: "",
    paidAmount: "",
    paidDate: "",
    counterpartAgreementNo: "",
  };

  it("accepts a complete one-time deal", () => {
    expect(contractSchema.safeParse(valid).success).toBe(true);
  });

  it("requires the three fields every document prints", () => {
    for (const field of ["clientName", "clientFirm", "projectName"]) {
      const parsed = contractSchema.safeParse({ ...valid, [field]: "   " });
      expect(parsed.success, field).toBe(false);
    }
    expect(contractSchema.safeParse({ ...valid, documentDate: "" }).success).toBe(false);
  });

  it("trims what it stores", () => {
    const parsed = contractSchema.safeParse({ ...valid, clientName: "  Mr. Sandeep Singh  " });
    expect(parsed.data?.clientName).toBe("Mr. Sandeep Singh");
  });

  it("rejects a malformed email but allows a blank one", () => {
    expect(contractSchema.safeParse({ ...valid, clientEmail: "not-an-email" }).success).toBe(false);
    expect(contractSchema.safeParse({ ...valid, clientEmail: "" }).success).toBe(true);
  });
});
