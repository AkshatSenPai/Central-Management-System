/** Reads the icon vocabulary out of `src/lib/icons.ts`.
 *
 * Shared by `fetch-icon-font.mjs` (which subsets the font to exactly this
 * list) and `gates.mjs` (which checks nothing on the list is unused). Both
 * are plain .mjs run by bare node with no TypeScript loader, so the source is
 * parsed rather than imported. The list is a flat array of string literals by
 * construction; if that ever stops being true the explicit throws below turn
 * it into a loud failure rather than a silently empty set.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ICONS_TS = join(ROOT, "src/lib/icons.ts");

export function readIconNames() {
  const src = readFileSync(ICONS_TS, "utf8");
  const body = src.match(/export const ICON_NAMES = \[([\s\S]*?)\] as const;/);
  if (!body) {
    throw new Error(
      `Could not find "export const ICON_NAMES = [...] as const;" in ${ICONS_TS}. ` +
        `If its shape changed, update this parser.`
    );
  }
  const names = Array.from(body[1].matchAll(/"([a-z0-9_]+)"/g), (m) => m[1]);
  if (names.length === 0) throw new Error("ICON_NAMES parsed as empty.");
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicates.length) throw new Error(`Duplicate icon names: ${duplicates.join(", ")}`);
  return names;
}
