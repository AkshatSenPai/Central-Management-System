/** Generates the PWA icons in `public/icons/` from one SVG defined here.
 *
 * The mark is the same one the sidebar draws — a rounded square in `--btn`
 * (#4b53c9) with a white "M" — so the home-screen icon and the app's own logo
 * cannot drift apart. Redrawing it in a design tool and exporting by hand is
 * exactly how they would.
 *
 * The output is committed, like the icon font. This script exists so those
 * files are reproducible and so changing the mark is one command rather than a
 * manual export; nothing at runtime touches it.
 *
 * Usage: node scripts/generate-app-icons.mjs [--check]
 *   --check  exits non-zero if any icon is missing or stale with respect to
 *            the SVG below, without writing. Suitable for a gate.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public/icons");
const MANIFEST = join(OUT_DIR, "icons.json");

const BG = "#4b53c9";
const FG = "#ffffff";

/** `padded` insets the mark so Android's maskable crop cannot clip the glyph:
 * a maskable icon may be cut to a circle, and the safe zone is the middle 80%.
 * The plain variant fills the square, which is what iOS and desktop want. */
function markSvg({ size, padded }) {
  const inset = padded ? size * 0.1 : 0;
  const box = size - inset * 2;
  const radius = padded ? box * 0.16 : size * 0.22;
  const fontSize = box * 0.58;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${padded ? BG : "none"}"/>
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="${BG}"/>
  <text x="${size / 2}" y="${size / 2}" fill="${FG}" font-family="Helvetica, Arial, sans-serif"
        font-size="${fontSize}" font-weight="700" letter-spacing="${-fontSize * 0.02}"
        text-anchor="middle" dominant-baseline="central">M</text>
</svg>`;
}

/** Every icon this app needs, and why each one exists.
 *
 * 192 and 512 are the two sizes the Web Manifest spec effectively requires for
 * an installable app. The maskable 512 is separate rather than reusing the
 * plain one because a maskable icon is cropped and a full-bleed mark loses its
 * corners. 180 is Apple's touch icon: iOS ignores the manifest icons for the
 * home screen, and without it Safari screenshots the page instead. */
const ICONS = [
  { file: "icon-192.png", size: 192, padded: false, purpose: "any" },
  { file: "icon-512.png", size: 512, padded: false, purpose: "any" },
  { file: "icon-maskable-512.png", size: 512, padded: true, purpose: "maskable" },
  { file: "apple-touch-icon.png", size: 180, padded: false, purpose: "apple" },
];

const signature = createHash("sha256")
  .update(ICONS.map((i) => `${i.file}:${markSvg({ size: i.size, padded: i.padded })}`).join("|"))
  .digest("hex")
  .slice(0, 16);

const check = process.argv.includes("--check");

if (check) {
  const missing = ICONS.filter((i) => !existsSync(join(OUT_DIR, i.file))).map((i) => i.file);
  if (missing.length > 0) {
    console.error(`FAIL app icons missing: ${missing.join(", ")}`);
    console.error("  Run: node scripts/generate-app-icons.mjs");
    process.exit(1);
  }
  if (!existsSync(MANIFEST) || JSON.parse(readFileSync(MANIFEST, "utf8")).signature !== signature) {
    console.error("FAIL app icons are stale with respect to the mark in this script");
    console.error("  Run: node scripts/generate-app-icons.mjs");
    process.exit(1);
  }
  console.log(`ok   ${ICONS.length} app icons match the committed mark`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const icon of ICONS) {
  const svg = Buffer.from(markSvg({ size: icon.size, padded: icon.padded }));
  const png = await sharp(svg).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(OUT_DIR, icon.file), png);
  console.log(`wrote public/icons/${icon.file} — ${(png.length / 1024).toFixed(1)} KB`);
}
writeFileSync(
  MANIFEST,
  `${JSON.stringify({ signature, icons: ICONS.map((i) => i.file) }, null, 2)}\n`
);
