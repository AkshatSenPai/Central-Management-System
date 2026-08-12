import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContractDetail, getIssuedHtml } from "@/lib/contract-queries";
import { factsFromRow, PROVISIONAL_AGREEMENT_NO } from "@/lib/contract-service";
import { loadRealEstateClauses, renderContract } from "@/lib/contract-template";
import { CONTRACT_FONT_FACES } from "@/lib/contract-print";

/** Serves one contract as a standalone HTML document, ready to print.
 *
 * A Route Handler rather than a page, for the same reason the activity export
 * is one: the deliverable is a *document*, not a screen. It has no layout, no
 * sidebar and no app CSS — what comes back is the contract and nothing else,
 * which is what makes Ctrl+P produce the intended A4 pages and what makes the
 * response safe to save to disk as-is.
 *
 * **An issued contract is served from the frozen copy, never re-rendered.**
 * `TODO.md` §O's ruling: "a document sent to a client must not silently change
 * afterwards, so the rendered output is the record, not a re-render from the
 * current template." A draft has no frozen copy yet and is rendered live, so
 * the preview tracks what is being edited.
 *
 * ## The one modification made to the document
 *
 * An `@font-face` block is injected into `<head>`. Spec §01 requires Playfair
 * Display and Source Serif 4 to be "installed on the rendering server, or the
 * output will fall back to system fonts and look wrong" — and the templates
 * name those families without shipping them. The rendering machine here is
 * whoever presses Ctrl+P, so installing them means pointing the document at
 * the two woff2 files in `public/fonts/contracts/`.
 *
 * This does not touch the stored bytes and does not change a word of the
 * document. `issuedHtml` in the database remains exactly what was frozen at
 * issue; this is the equivalent of installing a font on the printer.
 */

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** Inserted immediately before `</head>` so it lands after the template's own
 * `<style>` — which matters not for the cascade (an `@font-face` is a
 * declaration, not a rule that competes) but for one practical reason: every
 * one of the 72 templates ends its head the same way, and anchoring on the
 * closing tag is the one insertion point that does not depend on the
 * template's internal structure.
 *
 * If a future package ever ships a document with no `</head>`, the block is
 * appended to the top of the response instead of being silently dropped — a
 * document with a stray style block above it is visibly wrong, which is a
 * better failure than one that quietly prints in Times New Roman. */
function installFonts(html: string): string {
  const style = `<style>\n${CONTRACT_FONT_FACES}\n</style>`;
  const head = html.lastIndexOf("</head>");
  if (head === -1) return `${style}\n${html}`;
  return `${html.slice(0, head)}${style}\n${html.slice(head)}`;
}

export async function GET(
  _request: Request,
  props: { params: Promise<{ contractId: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session?.user) return textResponse("Sign in first", 401);

  const { contractId } = await props.params;

  // The frozen copy, if there is one. Its own query, so the 90 KB column is
  // read exactly when it is about to be streamed and never as a side effect.
  const issued = await getIssuedHtml(prisma, contractId);
  if (issued) {
    return document(installFonts(issued.html));
  }

  const row = await getContractDetail(prisma, contractId);
  if (!row) return textResponse("Contract not found", 404);
  if (row.status !== "DRAFT") {
    // ISSUED or VOID with no stored HTML. Not reachable through the app —
    // issuing writes both in one transaction — so this means the row was
    // edited by hand, and rendering something in its place would invent a
    // document that was never issued.
    return textResponse("This contract has no stored document", 500);
  }

  const clauses = await loadRealEstateClauses({
    kind: row.kind,
    trial: row.trial,
    plan: row.plan,
    ads: row.ads,
    websiteTier: row.websiteTier,
    realEstate: row.realEstate,
  });
  const { html } = await renderContract(
    factsFromRow(row, row.agreementNo ?? PROVISIONAL_AGREEMENT_NO, clauses)
  );
  return document(installFonts(html));
}

function document(html: string): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // A draft changes on every save and an issued document is a record
      // nobody should ever be served a stale copy of. Neither wants a cache.
      "cache-control": "no-store",
      // The document is served from this origin and contains client data.
      // It is never framed by anyone but this app's own preview.
      "x-frame-options": "SAMEORIGIN",
    },
  });
}
