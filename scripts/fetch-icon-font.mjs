/** Regenerates `public/fonts/material-symbols-outlined.woff2` from the icon
 * list in `src/lib/icons.ts`.
 *
 * Google Fonts subsets icon families on request via `icon_names=`, so the
 * committed file carries only the glyphs this app renders — 27 icons is
 * 4.7 KB against several megabytes for the full family. The axis instance
 * `@20,300,0,0` (opsz 20, wght 300, FILL 0, GRAD 0) is the one the design
 * mockup requests; see `docs/design/meridian-ops/desktop.html`.
 *
 * The output is committed. This script exists so that file is reproducible
 * and so adding an icon is one command, not a manual download — nothing at
 * runtime touches the network.
 *
 * Usage: node scripts/fetch-icon-font.mjs [--check]
 *   --check  exits non-zero if the committed file does not match the list,
 *            without writing. This is what gate 8 runs.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ROOT, readIconNames } from "./icon-names.mjs";

const OUT = join(ROOT, "public/fonts/material-symbols-outlined.woff2");
const MANIFEST = join(ROOT, "public/fonts/material-symbols-outlined.json");

/** Google's CSS endpoint serves a different payload to a browser than to a
 * bare fetch — an old UA gets TTF instead of woff2. Pinning a modern one is
 * what makes the download deterministic. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchSubset(names) {
  // Sorted so the request — and therefore the bytes — depend on the set of
  // icons, not on the order they happen to sit in the source file.
  const sorted = [...names].sort();
  const url =
    "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300,0,0" +
    `&icon_names=${sorted.join(",")}&display=block`;

  const cssRes = await fetch(url, { headers: { "User-Agent": UA } });
  if (!cssRes.ok) throw new Error(`Google Fonts CSS request failed: ${cssRes.status}`);
  const css = await cssRes.text();

  const match = css.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/);
  if (!match) throw new Error(`No woff2 source in the CSS response:\n${css.slice(0, 400)}`);

  const fontRes = await fetch(match[1], { headers: { "User-Agent": UA } });
  if (!fontRes.ok) throw new Error(`Font download failed: ${fontRes.status}`);
  return { bytes: Buffer.from(await fontRes.arrayBuffer()), names: sorted };
}

const check = process.argv.includes("--check");
const names = readIconNames();
const signature = createHash("sha256").update([...names].sort().join(",")).digest("hex").slice(0, 16);

if (check) {
  if (!existsSync(OUT) || !existsSync(MANIFEST)) {
    console.error(`FAIL icon font missing. Run: node scripts/fetch-icon-font.mjs`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  if (manifest.signature !== signature) {
    const added = names.filter((n) => !manifest.icons.includes(n));
    const removed = manifest.icons.filter((n) => !names.includes(n));
    console.error("FAIL icon font is stale with respect to src/lib/icons.ts");
    if (added.length) console.error(`  not in the font: ${added.join(", ")}`);
    if (removed.length) console.error(`  in the font but unlisted: ${removed.join(", ")}`);
    console.error("  Run: node scripts/fetch-icon-font.mjs");
    process.exit(1);
  }
  console.log(`ok   icon font matches ${names.length} listed icons`);
  process.exit(0);
}

const { bytes, names: sorted } = await fetchSubset(names);
writeFileSync(OUT, bytes);
writeFileSync(
  MANIFEST,
  `${JSON.stringify({ signature, icons: sorted, bytes: bytes.length }, null, 2)}\n`
);
console.log(`wrote ${OUT} — ${sorted.length} icons, ${(bytes.length / 1024).toFixed(1)} KB`);
