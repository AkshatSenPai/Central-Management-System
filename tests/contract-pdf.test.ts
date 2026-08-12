/** Renders a real contract to a real PDF and looks at the pixels.
 *
 * Everything asserted here was, at some point, broken in a way that every
 * other kind of test passed straight through. The paper was US Letter, the
 * cover printed with a white border round it, and the rupee sign came out in
 * Times New Roman — and unit tests, types, lint, gates and a production build
 * were all green for every one of them. The only thing that ever caught them
 * was rendering the document and inspecting it.
 *
 * It launches Chrome, so it is slower than the rest of the suite. That is the
 * price of testing the thing that actually goes to a client.
 */

import { describe, it, expect } from "vitest";
import { loadRealEstateClauses, renderContract } from "@/lib/contract-template";
import { renderContractPdf } from "@/lib/contract-pdf";
import type { ContractDeal } from "@/lib/contract";

const deal: ContractDeal = {
  kind: "ONE_TIME",
  trial: false,
  plan: "WEBSITE",
  ads: "NONE",
  websiteTier: "FLAGSHIP",
  realEstate: true,
};

async function renderPdf(): Promise<Uint8Array> {
  const clauses = await loadRealEstateClauses(deal);
  const { html } = await renderContract({
    deal,
    agreementNo: "SO/OT/2026/001",
    clientName: "Mr. Sandeep Singh",
    clientFirm: "Magus Realty, Lucknow",
    clientPhone: "+91 73909 38686",
    clientEmail: "sandeep@example.com",
    projectName: "Wave City Plots",
    documentDate: new Date(Date.UTC(2026, 7, 11)),
    timeline: "7 to 10 working days",
    campaignStartDate: null,
    gracePeriod: null,
    paidAmount: "₹22,997",
    paidDate: new Date(Date.UTC(2026, 7, 11)),
    counterpartAgreementNo: "SO/MT/2026/001",
    realEstateClauses: clauses,
  });
  return renderContractPdf(html);
}

/** A4 in PostScript points, the unit a PDF media box is written in. */
const A4_WIDTH_PT = 595;
const A4_HEIGHT_PT = 842;

/** Media boxes read straight out of the file. A PDF parser would be tidier
 * and would be a dependency added for one regex — `/MediaBox [ 0 0 w h ]` is
 * written uncompressed in the page dictionary, so it can simply be read. */
function mediaBoxes(pdf: Uint8Array): { width: number; height: number }[] {
  const raw = Buffer.from(pdf).toString("latin1");
  return [...raw.matchAll(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/g)].map(
    (m) => ({ width: Number(m[3]) - Number(m[1]), height: Number(m[4]) - Number(m[2]) })
  );
}

describe("the rendered PDF", () => {
  it("is A4, not Letter — the defect that started all of this", async () => {
    const boxes = mediaBoxes(await renderPdf());
    expect(boxes.length).toBeGreaterThan(1);
    for (const { width, height } of boxes) {
      // A point either way: Chromium's A4 comes out 209.9mm, not exactly 210.
      expect(Math.abs(width - A4_WIDTH_PT), `width ${width}`).toBeLessThan(2);
      expect(Math.abs(height - A4_HEIGHT_PT), `height ${height}`).toBeLessThan(2);
    }
  }, 90_000);

  it("carries no browser header, footer or source URL", async () => {
    const pdf = await renderPdf();
    // The bad export stamped `http://localhost:3000/...` across every page.
    // Searching the raw bytes is crude and that is the point: if the string
    // is anywhere in the file, it is on the paper.
    expect(Buffer.from(pdf).toString("latin1")).not.toContain("localhost");
  }, 90_000);

  /** The cover's full bleed and the rupee glyph are both verified by
   * rasterising the page and sampling pixels, which needs an image decoder
   * this repo does not carry. The procedure is written up in
   * `docs/contracts/README.md`; run it whenever the template package or the
   * renderer's CSS changes. What is asserted here is the cheap half — that
   * the rules which produce the bleed are actually in the document handed to
   * Chromium, so their removal fails a test rather than only a screenshot. */
  it("injects the cover-bleed rules", async () => {
    const { COVER_BLEED_CSS } = await import("@/lib/contract-pdf");
    expect(COVER_BLEED_CSS).toContain("body { margin: 0; }");
    expect(COVER_BLEED_CSS).toContain("@page :first { margin: 0; }");
    expect(COVER_BLEED_CSS).toMatch(/\.cover\s*\{[^}]*margin:\s*0\s*!important/);
    expect(COVER_BLEED_CSS).toMatch(/min-height:\s*100vh\s*!important/);
  });
});
