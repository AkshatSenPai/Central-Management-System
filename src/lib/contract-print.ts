/** The `@font-face` block a contract needs before it is printed or rendered,
 * built once and served two ways.
 *
 * Spec §01: the fonts "must be installed on the rendering server, or the
 * output will fall back to system fonts and look wrong". The templates name
 * Playfair Display and Source Serif 4 and ship neither, so something has to
 * put them there. See `scripts/fetch-contract-fonts.mjs` for where the files
 * come from and why they are committed rather than fetched at runtime.
 *
 * **Two consumers, one list.** The print route serves HTML to a browser that
 * can fetch `/fonts/contracts/…` over HTTP. The PDF renderer hands HTML to a
 * headless Chromium with no origin to resolve a relative URL against, so it
 * needs the same faces inlined as `data:` URIs. Both are generated from
 * `FACES` below — a second hand-maintained copy would drift, and the symptom
 * of drift is a PDF that silently differs from the preview that approved it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const FONT_DIR = path.join(process.cwd(), "public", "fonts", "contracts");

type Face = {
  family: string;
  weight: number;
  file: string;
  /** Present only on the rupee cuts — see the note below. */
  unicodeRange?: string;
};

/** The weights are the ones the templates ask for and no others: Playfair
 * Display 600 for headings and the cover, Source Serif 4 400 and 600 for body
 * text and its bolds. A weight the documents never request is bytes the
 * renderer downloads and never draws.
 *
 * **The last three are the rupee sign, and they are not decoration.** Neither
 * Source Serif 4 nor Playfair Display contains U+20B9 in any subset Google
 * serves — their latin range enumerates U+20AC (€) and U+2122 (™) and omits
 * the rupee entirely. Every `₹` in every contract was therefore falling
 * through to the generic `serif` and rendering in Times New Roman, beside
 * Source Serif digits, on every page with a figure on it. It was found by
 * reading the font list out of a rendered PDF; on screen it reads as a
 * slightly odd rupee sign and nothing more.
 *
 * A narrower `unicode-range` under the *same family name* wins for exactly
 * those codepoints, which is the mechanism Google Fonts is itself built on.
 * So a rupee-only cut of Noto Serif — 852 bytes — is declared as "Source
 * Serif 4" and as "Playfair Display", and nothing else changes. */
const FACES: Face[] = [
  { family: "Playfair Display", weight: 600, file: "playfair-display-600.woff2" },
  { family: "Source Serif 4", weight: 400, file: "source-serif-4-400.woff2" },
  { family: "Source Serif 4", weight: 600, file: "source-serif-4-600.woff2" },
  { family: "Source Serif 4", weight: 400, file: "rupee-400.woff2", unicodeRange: "U+20B9" },
  { family: "Source Serif 4", weight: 600, file: "rupee-600.woff2", unicodeRange: "U+20B9" },
  { family: "Playfair Display", weight: 600, file: "rupee-600.woff2", unicodeRange: "U+20B9" },
];

/** `font-display: block` rather than `swap`, and this is the one place in the
 * app where that is the right choice. `swap` paints fallback text immediately
 * and repaints when the real font arrives, which is correct for a screen and
 * wrong for a print job: the print pipeline can capture the page mid-swap and
 * produce a PDF in the fallback serif, with different metrics and therefore
 * different page breaks. `block` holds the text invisible instead, against
 * files of about 20 KB served from the same origin — or, in the renderer,
 * already inline. */
function faceCss(face: Face, src: string): string {
  return [
    "@font-face {",
    `  font-family: "${face.family}";`,
    "  font-style: normal;",
    `  font-weight: ${face.weight};`,
    "  font-display: block;",
    `  src: ${src};`,
    ...(face.unicodeRange ? [`  unicode-range: ${face.unicodeRange};`] : []),
    "}",
  ].join("\n");
}

/** For the print route: the browser fetches each file from this origin. */
export const CONTRACT_FONT_FACES = FACES.map((face) =>
  faceCss(face, `url("/fonts/contracts/${face.file}") format("woff2")`)
).join("\n");

/** For the PDF renderer: every face inlined, so the document is entirely
 * self-contained and Chromium makes no network request at all. That is worth
 * more than the ~85 KB of base64 it costs — a renderer that fetches is a
 * renderer that can produce a fontless PDF when the fetch is slow, and it
 * would do it silently. */
export async function contractFontFacesInline(): Promise<string> {
  const faces = await Promise.all(
    FACES.map(async (face) => {
      const bytes = await readFile(path.join(FONT_DIR, face.file));
      const src = `url("data:font/woff2;base64,${bytes.toString("base64")}") format("woff2")`;
      return faceCss(face, src);
    })
  );
  return faces.join("\n");
}
