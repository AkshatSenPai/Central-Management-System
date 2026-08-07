/** CSV encoding, RFC 4180 plus one hardening rule. Pure — no Prisma, no
 * request — so every escaping edge tests without a database or a browser. */

/** Characters that force a field to be quoted. A bare newline inside an
 * unquoted field ends the record, which is how a task title containing a line
 * break silently becomes two malformed rows. */
const MUST_QUOTE = /[",\r\n]/;

/** Excel, Sheets and LibreOffice all treat a cell beginning with one of these
 * as a formula. A task titled `=1+1` is a curiosity; one titled
 * `=HYPERLINK("http://…","Click")` — or a `+`-prefixed DDE payload — is an
 * attack that runs when a colleague opens the export.
 *
 * The export carries user-supplied text (task titles, client names, file
 * names) written by anyone with an account, so this is not theoretical.
 *
 * The fix is a leading apostrophe, which every spreadsheet strips on display
 * and treats as "this is text". The alternative — stripping the character —
 * would silently corrupt a legitimate title like "-- draft --". */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** One field, escaped and quoted exactly as much as it needs to be.
 *
 * `null` and `undefined` both become an empty field rather than the strings
 * "null"/"undefined" — a blank cell is what a reader expects for "no client",
 * and it is what re-importing the file will parse back as absent. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_LEAD.test(text)) text = `'${text}`;

  if (MUST_QUOTE.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

/** A whole document.
 *
 * CRLF line endings, per RFC 4180 — Excel on Windows is the target reader and
 * is the one that cares.
 *
 * The BOM is deliberate and is the difference between "Harlow & Fitch" and
 * mojibake: Excel assumes the system codepage for a .csv unless a UTF-8 byte
 * order mark says otherwise, and it will not ask. Everything else that reads
 * CSV tolerates the BOM; Excel is the only one that needs it, and it is the
 * one the owner means by "export it and store it somewhere". */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** A safe `Content-Disposition` filename.
 *
 * The name carries a date range that comes from the query string, so it is
 * user input reaching a response header. A quote or newline there would let a
 * caller inject a second header; anything outside this set is replaced rather
 * than escaped, because no legitimate export filename needs it. */
export function csvFilename(base: string): string {
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
  return `${safe || "export"}.csv`;
}
