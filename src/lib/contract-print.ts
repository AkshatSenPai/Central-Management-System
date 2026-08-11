/** The `@font-face` block injected into a contract before it is printed.
 *
 * Its own module so that the CSS string is testable and so the print route
 * stays a route. See `scripts/fetch-contract-fonts.mjs` for where the files
 * come from and why they are committed rather than fetched at runtime.
 *
 * The weights are the ones the templates ask for and no others — Playfair
 * Display 600 for headings and the cover, Source Serif 4 400 and 600 for body
 * text and its bolds. A weight the documents never request would be bytes the
 * browser downloads and never draws.
 *
 * `font-display: block` rather than `swap`, and this is the one place in the
 * app where that is the right choice. `swap` renders fallback text
 * immediately and repaints when the real font arrives, which is correct for a
 * screen and wrong for a print job: the print dialog can capture the page
 * mid-swap and produce a PDF in the fallback serif, with different metrics
 * and therefore different page breaks. `block` holds the text invisible for
 * up to three seconds instead, against two files of about 20 KB each served
 * from the same origin.
 */

export const CONTRACT_FONT_FACES = `
@font-face {
  font-family: "Playfair Display";
  font-style: normal;
  font-weight: 600;
  font-display: block;
  src: url("/fonts/contracts/playfair-display-600.woff2") format("woff2");
}
@font-face {
  font-family: "Source Serif 4";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("/fonts/contracts/source-serif-4-400.woff2") format("woff2");
}
@font-face {
  font-family: "Source Serif 4";
  font-style: normal;
  font-weight: 600;
  font-display: block;
  src: url("/fonts/contracts/source-serif-4-600.woff2") format("woff2");
}
`.trim();
