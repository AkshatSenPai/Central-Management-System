/** The template-package test.
 *
 * Everything here reads the real files in `src/contract-templates/`. That is
 * deliberate and is the whole point: these assertions are what turn "the
 * owner sent a new package" from a leap of faith into a five-second check.
 * Three of the spec's own validation rules are implemented as unit tests over
 * the actual 72 documents, in both real-estate states — 138 renders.
 *
 * If a future package fails one of these, the package is wrong, not the test.
 */

import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  dealProblem,
  resolveSnippetPath,
  resolveTemplatePath,
  tokensFor,
  type ContractDeal,
} from "@/lib/contract";
import {
  everyTemplatePath,
  loadRealEstateClauses,
  renderContract,
  tokensInTemplate,
} from "@/lib/contract-template";
import {
  clauseNumbers,
  duplicateClauseNumbers,
  letteringGaps,
  unsubstitutedTokens,
} from "@/lib/contract-render";
import type { ContractFacts } from "@/lib/contract-render";

const TEMPLATE_ROOT = path.join(process.cwd(), "src", "contract-templates");

/** A complete set of facts, so a render exercises every branch of
 * `buildTokens` rather than the subset one deal happens to need. */
function factsFor(deal: ContractDeal, realEstateClauses: string | null): ContractFacts {
  return {
    deal,
    agreementNo: "SO/OT/2026/055",
    clientName: "Mr. Sandeep Singh",
    clientFirm: "Magus Realty, Lucknow",
    clientPhone: "+91 73909 38686",
    clientEmail: "client@example.com",
    projectName: "Wave City Plots",
    documentDate: new Date(Date.UTC(2026, 7, 1)),
    timeline: "7 to 10 working days",
    campaignStartDate: new Date(Date.UTC(2026, 7, 15)),
    gracePeriod: "48 hours",
    paidAmount: "₹22,998",
    paidDate: new Date(Date.UTC(2026, 7, 14)),
    counterpartAgreementNo: "SO/MT/2026/055",
    realEstateClauses,
  };
}

async function everyHtmlFile(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (entry.name.endsWith(".html")) out.push(rel);
    }
  }
  await walk(TEMPLATE_ROOT, "");
  return out.sort();
}

describe("the vendored package", () => {
  it("holds 72 templates and 2 snippets", async () => {
    const files = await everyHtmlFile();
    expect(files.filter((f) => f.startsWith("_snippets/"))).toHaveLength(2);
    expect(files.filter((f) => !f.startsWith("_snippets/"))).toHaveLength(72);
  });

  it("has a file for every combination the resolver can produce", async () => {
    const files = new Set(await everyHtmlFile());
    const resolved = everyTemplatePath();
    expect(resolved).toHaveLength(72);
    for (const { path: p } of resolved) {
      expect(files.has(p), `${p} was resolved but does not exist`).toBe(true);
    }
  });

  it("leaves no template unreachable", async () => {
    const resolved = new Set(everyTemplatePath().map((r) => r.path));
    for (const file of await everyHtmlFile()) {
      if (file.startsWith("_snippets/")) continue;
      expect(resolved.has(file), `${file} exists but no deal resolves to it`).toBe(true);
    }
  });
});

/** `BLANK_FILL` renders `<span class="blank">`, relying on a rule the
 * templates define rather than carrying its own inline style. That is only
 * safe while every template that can receive a blank actually defines the
 * class — so this asserts it, and a package that drops `.blank` fails here
 * rather than printing an invisible gap where an amount should be. */
describe("the unpaid blank", () => {
  it("has its class defined in every template that can receive one", async () => {
    for (const { path: p, deal } of everyTemplatePath()) {
      const needsBlank = tokensFor(deal.kind, deal.trial).includes("PAID_AMOUNT");
      if (!needsBlank) continue;
      const html = await readFile(path.join(TEMPLATE_ROOT, p), "utf8");
      expect(/\.blank\s*\{/.test(html), `${p} uses {{PAID_AMOUNT}} but defines no .blank`).toBe(
        true
      );
    }
  });

  it("renders a dotted rule when the contract is unpaid", async () => {
    const deal: ContractDeal = {
      kind: "ONE_TIME",
      trial: false,
      plan: "STARTER",
      ads: "META",
      websiteTier: null,
      realEstate: false,
    };
    const unpaid = { ...factsFor(deal, null), paidAmount: null, paidDate: null };
    const { html } = await renderContract(unpaid);
    expect(html).toContain('<span class="blank">&nbsp;</span>');
    expect(unsubstitutedTokens(html)).toEqual([]);
  });
});

describe("tokensFor matches the real templates", () => {
  it("declares exactly the tokens each template contains", async () => {
    for (const { path: p, deal } of everyTemplatePath()) {
      const actual = await tokensInTemplate(p);
      const declared = [...tokensFor(deal.kind, deal.trial)].sort();
      expect(actual, `token drift in ${p}`).toEqual(declared);
    }
  });
});

/** Spec §05 check 1, over the whole package. */
describe("no unsubstituted tokens", () => {
  it("renders every template clean, in both real-estate states", async () => {
    for (const { deal } of everyTemplatePath()) {
      for (const realEstate of [false, true]) {
        if (realEstate && deal.kind === "PROPOSAL") continue;
        const withToggle = { ...deal, realEstate };
        const clauses = await loadRealEstateClauses(withToggle);
        const { html } = await renderContract(factsFor(withToggle, clauses));
        expect(unsubstitutedTokens(html), `${resolveTemplatePath(withToggle)} (re=${realEstate})`).toEqual(
          []
        );
      }
    }
  });
});

/** Spec §05 check 2 — "the check that would have caught a real numbering bug
 * found during build". */
describe("no duplicate clause numbers", () => {
  it("holds for every agreement, in both real-estate states", async () => {
    for (const { deal } of everyTemplatePath()) {
      if (deal.kind === "PROPOSAL") continue;
      for (const realEstate of [false, true]) {
        const withToggle = { ...deal, realEstate };
        const clauses = await loadRealEstateClauses(withToggle);
        const { html } = await renderContract(factsFor(withToggle, clauses));
        expect(
          duplicateClauseNumbers(html),
          `${resolveTemplatePath(withToggle)} (re=${realEstate})`
        ).toEqual([]);
      }
    }
  });

  it("has no lettering gaps anywhere in the package", async () => {
    for (const { deal } of everyTemplatePath()) {
      if (deal.kind === "PROPOSAL") continue;
      for (const realEstate of [false, true]) {
        const withToggle = { ...deal, realEstate };
        const clauses = await loadRealEstateClauses(withToggle);
        const { html } = await renderContract(factsFor(withToggle, clauses));
        expect(letteringGaps(html), `${resolveTemplatePath(withToggle)} (re=${realEstate})`).toEqual(
          []
        );
      }
    }
  });
});

/** The negative control for check 2b, and the record of why it exists.
 *
 * Both directions of the wrong-snippet mistake are asserted here: that the
 * spec's own check misses it, and that the lettering check catches it. If the
 * first of these ever starts failing, a new package has changed the numbering
 * and the note in `letteringGaps` should be revisited. */
describe("the wrong real-estate snippet", () => {
  const maintenance: ContractDeal = {
    kind: "MAINTENANCE",
    trial: false,
    plan: "STANDARD",
    ads: "BOTH",
    websiteTier: null,
    realEstate: true,
  };
  const oneTime: ContractDeal = { ...maintenance, kind: "ONE_TIME" };

  it("does NOT produce duplicate clause numbers, contrary to the spec", async () => {
    const wrong = await loadRealEstateClauses({ ...maintenance, kind: "ONE_TIME" });
    const { html } = await renderContract(factsFor(maintenance, wrong));
    expect(duplicateClauseNumbers(html)).toEqual([]);
  });

  it("is caught by the lettering check, in both directions", async () => {
    const maintenanceWithOneTimeSnippet = await renderContract(
      factsFor(maintenance, await loadRealEstateClauses({ ...maintenance, kind: "ONE_TIME" }))
    );
    expect(letteringGaps(maintenanceWithOneTimeSnippet.html)).toContain(
      "10F follows nothing — 10E is missing"
    );

    const oneTimeWithMaintenanceSnippet = await renderContract(
      factsFor(oneTime, await loadRealEstateClauses({ ...oneTime, kind: "MAINTENANCE" }))
    );
    expect(letteringGaps(oneTimeWithMaintenanceSnippet.html)).toContain(
      "12F follows nothing — 12E is missing"
    );
  });

  it("picks a different snippet for each agreement family", () => {
    expect(resolveSnippetPath("ONE_TIME")).toBe("_snippets/real_estate_clauses_ONETIME.html");
    expect(resolveSnippetPath("MAINTENANCE")).toBe("_snippets/real_estate_clauses_MAINTENANCE.html");
    expect(resolveSnippetPath("PROPOSAL")).toBeNull();
  });
});

describe("the real-estate toggle", () => {
  it("adds seven lettered clauses and removes none", async () => {
    const deal: ContractDeal = {
      kind: "ONE_TIME",
      trial: false,
      plan: "ADVANCED",
      ads: "BOTH",
      websiteTier: null,
      realEstate: false,
    };
    const off = await renderContract(factsFor(deal, null));
    const onDeal = { ...deal, realEstate: true };
    const on = await renderContract(factsFor(onDeal, await loadRealEstateClauses(onDeal)));

    const added = clauseNumbers(on.html).filter((n) => !clauseNumbers(off.html).includes(n));
    expect(added).toEqual(["10F", "10G", "10H", "10I", "10J", "10K", "10L"]);
    for (const number of clauseNumbers(off.html)) {
      expect(clauseNumbers(on.html)).toContain(number);
    }
  });

  it("leaves nothing behind when off", async () => {
    const deal: ContractDeal = {
      kind: "MAINTENANCE",
      trial: true,
      plan: "STARTER",
      ads: "META",
      websiteTier: null,
      realEstate: false,
    };
    const { html } = await renderContract(factsFor(deal, null));
    expect(html).not.toContain("REAL_ESTATE_CLAUSES");
    expect(html).not.toContain("RERA");
  });
});

describe("resolveTemplatePath", () => {
  it("builds the filename from the deal", () => {
    const base: ContractDeal = {
      kind: "ONE_TIME",
      trial: false,
      plan: "STANDARD",
      ads: "BOTH",
      websiteTier: null,
      realEstate: false,
    };
    expect(resolveTemplatePath(base)).toBe("one-time/onetime_standard_both.html");
    expect(resolveTemplatePath({ ...base, trial: true })).toBe(
      "trial/one-time/trial_onetime_standard_both.html"
    );
    expect(resolveTemplatePath({ ...base, kind: "MAINTENANCE" })).toBe(
      "maintenance/maintenance_standard_both.html"
    );
    expect(resolveTemplatePath({ ...base, kind: "PROPOSAL" })).toBe(
      "proposals/proposal_standard_both.html"
    );
    expect(
      resolveTemplatePath({ ...base, plan: "WEBSITE", websiteTier: "FLAGSHIP" })
    ).toBe("one-time/onetime_website_flagship.html");
    expect(
      resolveTemplatePath({ ...base, kind: "MAINTENANCE", trial: true, plan: "WEBSITE", websiteTier: "PREMIUM" })
    ).toBe("trial/maintenance/trial_maintenance_website_premium.html");
  });

  it("refuses a combination the package has no file for", () => {
    const websiteProposal: ContractDeal = {
      kind: "PROPOSAL",
      trial: false,
      plan: "WEBSITE",
      ads: "NONE",
      websiteTier: "BUSINESS",
      realEstate: false,
    };
    expect(dealProblem(websiteProposal)).toMatch(/no website proposal/i);
    expect(() => resolveTemplatePath(websiteProposal)).toThrow();

    const trialProposal: ContractDeal = {
      kind: "PROPOSAL",
      trial: true,
      plan: "STARTER",
      ads: "META",
      websiteTier: null,
      realEstate: false,
    };
    expect(dealProblem(trialProposal)).toMatch(/trial/i);
    expect(() => resolveTemplatePath(trialProposal)).toThrow();
  });

  it("refuses a website deal with no tier", () => {
    expect(
      dealProblem({
        kind: "ONE_TIME",
        trial: false,
        plan: "WEBSITE",
        ads: "NONE",
        websiteTier: null,
        realEstate: false,
      })
    ).toMatch(/website tier/i);
  });
});
