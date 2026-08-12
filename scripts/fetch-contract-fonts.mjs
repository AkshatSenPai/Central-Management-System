/** Downloads the two fonts the contract templates are typeset in, into
 * `public/fonts/contracts/`.
 *
 * The CMS implementation spec, §01: "The fonts used (Playfair Display, Source
 * Serif 4) must be installed on the rendering server, or the output will fall
 * back to system fonts and look wrong."
 *
 * The templates name those families in CSS and carry no `@font-face` and no
 * `<link>` — they are self-contained by design, which also means they bring no
 * fonts with them. On a machine without both families installed, every one of
 * the 72 documents silently renders in the browser's default serif: right
 * words, wrong document.
 *
 * `/contracts/{id}/print` injects an `@font-face` block pointing at these
 * files, which is this app's version of "installed on the rendering server" —
 * the rendering machine here is whichever laptop presses Ctrl+P.
 *
 * Same shape and the same reasoning as `fetch-icon-font.mjs`: the output is
 * committed, nothing at runtime touches the network, and regenerating is one
 * command.
 *
 * Usage: node scripts/fetch-contract-fonts.mjs [--check]
 *   --check  exits non-zero if a file is missing or stale, without writing.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public/fonts/contracts");
const MANIFEST = join(OUT_DIR, "manifest.json");

/** See fetch-icon-font.mjs — Google serves TTF to a bare fetch and woff2 only
 * to a UA it recognises. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Weights are the ones the templates actually ask for, read out of the
 * template CSS: Playfair Display at 600 for headings and the cover, Source
 * Serif 4 at 400 for body and 600 for the bolds. Downloading the full
 * variable range would quadruple the bytes for weights no document uses.
 *
 * `text=` is deliberately NOT used to subset by character. A contract carries
 * arbitrary client names and project names, and a subset built from today's
 * documents would be missing a glyph in tomorrow's. The full latin range is
 * the correct trade here — it is about 100 KB per face, downloaded once and
 * cached by the browser. */
/** The rupee sign, and the reason three of these faces exist.
 *
 * **Neither Source Serif 4 nor Playfair Display ships U+20B9 in any Google
 * subset.** Not latin, not latin-ext, not anywhere — their latin range
 * enumerates U+20AC (€) and U+2122 (™) and simply omits the rupee. So every
 * `₹` in every contract fell through to the generic `serif` and rendered in
 * Times New Roman: a Times rupee sign against Source Serif digits, on every
 * page with a figure on it. Found by reading the fonts out of a rendered PDF,
 * not by looking at the screen, where it is easy to miss.
 *
 * The fix needs no template edit. `@font-face` may map a *second* file to a
 * narrow `unicode-range` under the **same family name**, and the browser will
 * use it for exactly those codepoints — which is the mechanism Google Fonts
 * itself is built on. So a rupee-only cut of Noto Serif is declared as
 * "Source Serif 4" and as "Playfair Display", and only the ₹ comes from it.
 *
 * Google serves single-glyph subsets via `&text=`; each of these is well
 * under 2 KB. Noto Serif is the match because it is a transitional serif of
 * broadly similar colour and it actually has the glyph. */
const RUPEE = "₹";

const FACES = [
  { family: "Playfair Display", weights: [600], file: "playfair-display-600" },
  { family: "Source Serif 4", weights: [400], file: "source-serif-4-400" },
  { family: "Source Serif 4", weights: [600], file: "source-serif-4-600" },
  { family: "Noto Serif", weights: [400], file: "rupee-400", text: RUPEE },
  { family: "Noto Serif", weights: [600], file: "rupee-600", text: RUPEE },
];

async function fetchFace(face) {
  const url =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(face.family)}:wght@${face.weights.join(";")}` +
    (face.text ? `&text=${encodeURIComponent(face.text)}` : "&display=swap");
  const cssResponse = await fetch(url, { headers: { "user-agent": UA } });
  if (!cssResponse.ok) {
    throw new Error(`${face.family}: CSS request failed with ${cssResponse.status}`);
  }
  const css = await cssResponse.text();

  // Google returns one @font-face per unicode-range (latin, latin-ext,
  // cyrillic, …). The latin block is the last one it emits and the only one
  // these documents need; taking the last one is how the icon script picks
  // its single file too. A `&text=` request returns exactly one block.
  //
  // The URL is matched by its `format('woff2')` rather than by a `.woff2`
  // extension: a `&text=` subset is served from `/l/font?kit=…` with no
  // extension at all, and an extension-anchored pattern silently finds
  // nothing — which is how the first attempt at this "proved" that no serif
  // on Google Fonts had the rupee sign.
  const urls = [...css.matchAll(/url\((https:\/\/[^)]+)\)\s*format\('woff2'\)/g)].map((m) => m[1]);
  if (urls.length === 0) throw new Error(`${face.family}: no woff2 in the CSS response`);

  const fontResponse = await fetch(urls[urls.length - 1], { headers: { "user-agent": UA } });
  if (!fontResponse.ok) {
    throw new Error(`${face.family}: font request failed with ${fontResponse.status}`);
  }
  return Buffer.from(await fontResponse.arrayBuffer());
}

const check = process.argv.includes("--check");
mkdirSync(OUT_DIR, { recursive: true });

const manifest = {};
let stale = false;

for (const face of FACES) {
  const target = join(OUT_DIR, `${face.file}.woff2`);
  const bytes = await fetchFace(face);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  manifest[face.file] = { family: face.family, weight: face.weights[0], sha256: hash, bytes: bytes.length };

  if (check) {
    if (!existsSync(target) || createHash("sha256").update(readFileSync(target)).digest("hex").slice(0, 16) !== hash) {
      console.error(`stale or missing: public/fonts/contracts/${face.file}.woff2`);
      stale = true;
    }
    continue;
  }
  writeFileSync(target, bytes);
  console.log(`wrote ${face.file}.woff2 — ${face.family} ${face.weights[0]}, ${(bytes.length / 1024).toFixed(1)} KB`);
}

if (check) {
  const committed = existsSync(MANIFEST) ? readFileSync(MANIFEST, "utf8") : "";
  if (committed !== JSON.stringify(manifest, null, 2) + "\n") stale = true;
  process.exit(stale ? 1 : 0);
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log("wrote manifest.json");
