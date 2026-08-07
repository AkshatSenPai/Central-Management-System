import { describe, it, expect } from "vitest";
import { csvCell, csvRow, toCsv, csvFilename } from "@/lib/csv";

const BOM = "﻿";

describe("csvCell", () => {
  it("leaves an ordinary value unquoted", () => {
    expect(csvCell("Brand Guidelines v3")).toBe("Brand Guidelines v3");
    expect(csvCell(42)).toBe("42");
  });

  it("renders null and undefined as an empty field, not the word", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes a field containing a comma", () => {
    expect(csvCell("Reeve, Dana")).toBe('"Reeve, Dana"');
  });

  it("doubles inner quotes and wraps the field", () => {
    expect(csvCell('He said "go"')).toBe('"He said ""go"""');
  });

  // A bare newline ends the record, so an unquoted multi-line title becomes
  // two malformed rows — silently, and only in the file.
  it("quotes a field containing a newline or carriage return", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("serialises a Date as ISO 8601", () => {
    expect(csvCell(new Date("2026-08-07T09:30:00.000Z"))).toBe("2026-08-07T09:30:00.000Z");
  });

  // The hardening rule. These open as live formulas in Excel, Sheets and
  // LibreOffice, and the text comes from anyone with an account.
  it("neutralises a leading formula character with an apostrophe", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""x"")"'
    );
    expect(csvCell("+1234")).toBe("'+1234");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("prefixes rather than strips, so a legitimate value survives readable", () => {
    expect(csvCell("-- draft --")).toBe("'-- draft --");
  });

  it("leaves a formula character that is not leading alone", () => {
    expect(csvCell("2+2 is 4")).toBe("2+2 is 4");
    expect(csvCell("dana@example.com")).toBe("dana@example.com");
  });
});

describe("csvRow", () => {
  it("joins fields with commas, escaping each", () => {
    expect(csvRow(["a", "b,c", null, 'd"e'])).toBe('a,"b,c",,"d""e"');
  });

  it("renders an empty row as an empty string", () => {
    expect(csvRow([])).toBe("");
  });
});

describe("toCsv", () => {
  it("emits a UTF-8 BOM so Excel does not mangle non-ASCII", () => {
    const out = toCsv(["name"], [["Zoë"]]);
    expect(out.startsWith(BOM)).toBe(true);
    expect(out).toContain("Zoë");
  });

  it("uses CRLF line endings and terminates the final row", () => {
    const out = toCsv(["a", "b"], [[1, 2], [3, 4]]);
    expect(out).toBe(`${BOM}a,b\r\n1,2\r\n3,4\r\n`);
  });

  it("emits a header-only document when there are no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe(`${BOM}a,b\r\n`);
  });
});

describe("csvFilename", () => {
  it("appends the extension and keeps safe characters", () => {
    expect(csvFilename("activity-2026-08-01_2026-08-07")).toBe(
      "activity-2026-08-01_2026-08-07.csv"
    );
  });

  // The base carries a date range straight off the query string, so this is
  // user input reaching a response header. A quote or newline would let a
  // caller inject a second header.
  it("replaces quotes, newlines and separators that could forge a header", () => {
    expect(csvFilename('a"; X-Evil: 1')).toBe("a---X-Evil--1.csv");
    expect(csvFilename("a\r\nSet-Cookie: x")).toBe("a--Set-Cookie--x.csv");
    // Dots survive — they are legal in a filename. The traversal is defused
    // by the separators going, not by the dots.
    expect(csvFilename("../../etc/passwd")).toBe("..-..-etc-passwd.csv");
    expect(csvFilename("../../etc/passwd")).not.toContain("/");
  });

  it("falls back to a name rather than emitting a bare extension", () => {
    expect(csvFilename("")).toBe("export.csv");
    expect(csvFilename("!!!")).toBe("---.csv");
  });

  it("caps the length", () => {
    expect(csvFilename("x".repeat(500)).length).toBe(124);
  });
});
