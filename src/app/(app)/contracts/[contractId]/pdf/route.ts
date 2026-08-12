import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CONTRACT_KIND_LABEL } from "@/lib/contract";
import { getContractDetail, getIssuedHtml } from "@/lib/contract-queries";
import { factsFromRow, PROVISIONAL_AGREEMENT_NO } from "@/lib/contract-service";
import { loadRealEstateClauses, renderContract } from "@/lib/contract-template";
import { pdfFileName, renderContractPdf } from "@/lib/contract-pdf";

/** The deliverable: one contract, as an A4 PDF.
 *
 * Sibling of `../print/route.ts` and deliberately built on the same two
 * sources — the frozen `issuedHtml` for an issued contract, a live render for
 * a draft. The preview a person approves and the file they send are the same
 * bytes through two different renderers, which is the only arrangement where
 * approving the preview means anything.
 *
 * Node runtime, not Edge: it launches a browser.
 */
export const runtime = "nodejs";

/** Launching Chromium, laying out ~10 pages and serialising a PDF runs to a
 * few seconds cold. The Vercel default of 10s is enough on a warm function
 * and marginal on a cold one, and a contract that times out at the moment
 * somebody tries to send it is the worst possible place to be stingy. */
export const maxDuration = 60;

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  _request: Request,
  props: { params: Promise<{ contractId: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session?.user) return textResponse("Sign in first", 401);

  const { contractId } = await props.params;

  const row = await getContractDetail(prisma, contractId);
  if (!row) return textResponse("Contract not found", 404);

  let html: string;
  const issued = await getIssuedHtml(prisma, contractId);
  if (issued) {
    // The frozen copy, never a re-render. `TODO.md` §O: a document sent to a
    // client must not silently change afterwards.
    html = issued.html;
  } else if (row.status === "DRAFT") {
    const clauses = await loadRealEstateClauses({
      kind: row.kind,
      trial: row.trial,
      plan: row.plan,
      ads: row.ads,
      websiteTier: row.websiteTier,
      realEstate: row.realEstate,
    });
    const rendered = await renderContract(
      factsFromRow(row, row.agreementNo ?? PROVISIONAL_AGREEMENT_NO, clauses)
    );
    html = rendered.html;
  } else {
    // ISSUED or VOID with no stored HTML — not reachable through the app,
    // since issuing writes both in one transaction. Rendering something in
    // its place would invent a document that was never issued.
    return textResponse("This contract has no stored document", 500);
  }

  let pdf: Uint8Array;
  try {
    pdf = await renderContractPdf(html);
  } catch (cause) {
    // Surfaced rather than swallowed: the two realistic failures are a
    // missing local Chrome in dev and a cold-start timeout on Vercel, and
    // both are things the person downloading needs told rather than a
    // zero-byte file.
    console.error("contract-pdf: render failed", cause);
    return textResponse("Could not render this contract as a PDF — try again", 500);
  }

  const filename = pdfFileName({
    agreementNo: row.agreementNo,
    kindLabel: CONTRACT_KIND_LABEL[row.kind],
    clientName: row.clientName,
  });

  return new Response(pdf as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      // `attachment` so it downloads rather than opening in the tab's own PDF
      // viewer — the point of this route is a file on disk to attach to an
      // email, and a viewer is one extra step to get there.
      "content-disposition": `attachment; filename="${filename}"`,
      // A draft changes on every save and an issued document is a record
      // nobody should be served a stale copy of.
      "cache-control": "no-store",
    },
  });
}
