/** HTML in, A4 PDF out, with no human in the loop.
 *
 * ## Why this exists
 *
 * The first version of this feature had no renderer: it served the document
 * and let the operator print it. That shipped, and the first real export came
 * back wrong in four ways at once — US Letter instead of A4, so every page
 * break landed wrong; `http://localhost:3000/…` and a timestamp stamped on
 * every page of a client agreement; 6.5 MB; and font encoding mangled badly
 * enough that WPS Office refused to open the file. One cause: the print
 * dialog's destination was "Microsoft Print to PDF", a virtual *printer*,
 * which uses its own paper size and ignores `@page { size: A4 }`.
 *
 * The lesson is not "pick the other destination". It is that a legal document
 * cannot depend on four settings in an OS dialog being right. So the app
 * renders it, and the operator gets a file.
 *
 * ## Why Chromium and not WeasyPrint
 *
 * WeasyPrint needs Pango, which Vercel's Python runtime does not provide, so
 * it would mean a second service on another host.
 *
 * **It would also buy nothing. Chromium renders the `@page` margin boxes.**
 * The running header, the running footer and `counter(page) " / "
 * counter(pages)` all come out — verified by rasterising page 2 of a real
 * contract and reading "2 / 10" off it in gold.
 *
 * This file previously claimed the opposite, twice, and the claim reached the
 * owner as a trade-off they were asked to accept. It came from checking the
 * *end* of a page's extracted text for a footer: pdf text extraction emits
 * margin-box content **first**, so the footer was there all along and the
 * check was looking in the wrong place. Worth remembering — an absence proved
 * by a single weak probe is not an absence.
 */

import puppeteer, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { contractFontFacesInline } from "@/lib/contract-print";

/** A local Chrome, for `next dev`.
 *
 * `@sparticuz/chromium` ships a Linux binary meant for a Lambda filesystem;
 * on a developer's Windows or macOS machine it cannot run at all. Rather than
 * make everyone install a second browser, the renderer uses the Chrome that
 * is already there. `CHROME_PATH` overrides, for anyone whose install is
 * somewhere unusual or who wants to pin a specific build. */
const LOCAL_CHROME = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
].filter(Boolean) as string[];

async function localChromePath(): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  for (const candidate of LOCAL_CHROME) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Next candidate.
    }
  }
  return null;
}

/** Vercel sets this on every deployment; nothing else does. Used to decide
 * which browser to launch rather than `NODE_ENV`, because `next build` runs
 * with NODE_ENV=production on a developer's laptop too and would otherwise
 * try to launch a Linux binary there. */
const onVercel = () => Boolean(process.env.VERCEL);

async function launch(): Promise<Browser> {
  if (onVercel()) {
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const local = await localChromePath();
  if (!local) {
    throw new Error(
      "contract-pdf: no local Chrome found. Install Google Chrome, or set CHROME_PATH " +
        `to its executable. Looked in: ${LOCAL_CHROME.join(", ")}`
    );
  }
  return puppeteer.launch({
    executablePath: local,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
}

/** The cover page is meant to be solid navy, edge to edge, and in Chromium it
 * was not — it came out inset by the page margin with a white border around
 * it, which is what the owner reported.
 *
 * The templates get a full-bleed cover the standard paged-media way: the page
 * carries `margin: 18mm 17mm 16mm 17mm`, and `.cover` cancels it with
 * `margin: -18mm -17mm 0 -17mm` so its background reaches the paper. That is
 * correct CSS and it works in WeasyPrint and Prince. **Chromium clips page
 * content to the margin box**, so the overhang is simply cut off and the
 * paper shows through.
 *
 * The fix is per-page margins, which Chromium does support: give the first
 * page no margin at all, and cancel the cover's negative margin to match.
 * `.cover` then fills the sheet on its own and its existing
 * `padding: 30mm 17mm 22mm 17mm` supplies the inset the design wants. Body
 * pages are untouched and keep their margins.
 *
 * Injected at render time rather than edited into 72 files — spec §06 puts
 * the templates off limits, and this is a property of the renderer, not of
 * the document.
 *
 * `min-height: 100vh` replaces the template's `263mm`, which is the height of
 * the *content box* on a margined page. With the first page's margins removed
 * the sheet is the full 297mm, and 263mm of navy leaves 34mm of white along
 * the bottom edge — the same bug as the sides, one step later. `100vh`
 * resolves to the page box in print layout, so it stays correct if the paper
 * ever changes. `* { box-sizing: border-box }` is set globally, so the
 * cover's own `padding: 30mm 17mm 22mm 17mm` sits inside that height.
 *
 * **`body { margin: 0 }` is the part that is easy to miss.** No template sets
 * a `body` rule, so the browser default of 8px applies, and 8px of body
 * margin is enough to keep the cover off the paper edge no matter what the
 * page margin is. Zeroing the page margin alone does nothing visible, which
 * is exactly how the first attempt at this fix "worked" and changed nothing.
 * Only the cover is affected: `body`'s margin sits outside the `@page`
 * margin box, so body pages keep the 17mm the template asks for either way.
 */
export const COVER_BLEED_CSS = `
body { margin: 0; }
@page :first { margin: 0; }
.cover { margin: 0 !important; min-height: 100vh !important; }
`.trim();

/** Inserted before `</head>`, exactly as the print route does it — see the
 * note there about anchoring on the closing tag rather than on any of the
 * template's internal structure. Last in the head, so these rules win over
 * the template's own without needing to out-specify them. */
async function installFonts(html: string): Promise<string> {
  const style = `<style>\n${await contractFontFacesInline()}\n${COVER_BLEED_CSS}\n</style>`;
  const head = html.lastIndexOf("</head>");
  if (head === -1) return `${style}\n${html}`;
  return `${html.slice(0, head)}${style}\n${html.slice(head)}`;
}

export async function renderContractPdf(html: string): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();

    // `load` and not `networkidle0`: every font is inlined as a data: URI by
    // `installFonts`, so there is no network to go idle and waiting for it
    // only burns the function's timeout.
    await page.setContent(await installFonts(html), { waitUntil: "load" });

    // The one wait that matters. `font-display: block` keeps text invisible
    // until its face is ready, and a PDF captured before then is a PDF of
    // blank space — or, worse, of fallback metrics with different page
    // breaks. This resolves once every declared face has loaded or failed.
    await page.evaluate(() => document.fonts.ready);

    return await page.pdf({
      // Takes A4 from the templates' own `@page { size: A4 }` instead of
      // imposing a size here. `format: "A4"` would also be 210x297, but it
      // would be this file asserting it rather than the document, and the
      // next package that changes paper would then be silently overridden.
      preferCSSPageSize: true,
      // Without this the navy cover block, the gold rules and every shaded
      // table print as white. It is off by default in every browser print
      // path, which is why the "just tick the right boxes" approach was
      // never going to hold.
      printBackground: true,
      // The templates set their own margins in `@page`. An explicit margin
      // here would be added to those.
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    // Always. A leaked browser process on a warm lambda outlives the request
    // and eventually takes the function's memory with it.
    await browser.close();
  }
}

/** `SO/MT/2026/001` is a perfectly good identifier and an illegal filename on
 * every operating system this app runs on. Slashes become dashes; a draft has
 * no number and is named for what it is instead. */
export function pdfFileName(input: {
  agreementNo: string | null;
  kindLabel: string;
  clientName: string;
}): string {
  const stem = input.agreementNo
    ? input.agreementNo.replace(/\//g, "-")
    : `DRAFT-${input.kindLabel}`;
  const who = input.clientName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `Shape_Odyssey_${stem}_${who}.pdf`.replace(/_+/g, "_");
}
