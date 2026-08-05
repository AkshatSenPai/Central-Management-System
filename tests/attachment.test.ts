import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  buildFileKey,
  formatFileSize,
  sanitiseFileName,
  validateUpload,
} from "@/lib/attachment";

describe("sanitiseFileName", () => {
  // §7:118: "A file called `../../etc/passwd` is a display string, not a
  // path." The whole point of this function is that neither the traversal
  // tokens nor the separators that give them meaning survive.
  it("never lets a traversal name through as a path", () => {
    const result = sanitiseFileName("../../etc/passwd");
    expect(result).not.toMatch(/\.\./);
    expect(result).not.toMatch(/\//);
    expect(result).not.toMatch(/\\/);
  });

  it("flattens mixed separators instead of taking just the last segment", () => {
    const result = sanitiseFileName("a/b\\c.pdf");
    expect(result).not.toMatch(/\//);
    expect(result).not.toMatch(/\\/);
    // Flattened, not merely truncated to the final segment — "a" and "b"
    // are still visible, proving the whole path was folded rather than
    // discarded down to "c.pdf".
    expect(result).toBe("a_b_c.pdf");
  });

  it("drops traversal segments but keeps the readable remainder", () => {
    expect(sanitiseFileName("../../etc/passwd")).toBe("etc_passwd");
  });

  // Every hostile case gets its own absence check, not just "it changed" —
  // a transform that turned ".." into "._" would pass a looser test while
  // still leaving a dot pair one character away from re-forming.
  it.each([
    ["../../etc/passwd", "path with leading traversal"],
    ["a/b\\c.pdf", "mixed separators"],
    [".env", "leading dot"],
    ["...", "name that is only dots"],
    ["", "empty string"],
    ["..secret.pdf", "leading traversal token with no separator"],
    ["video..mp4", "double dot with no separator, mid-name"],
  ])("contains no '/', '\\\\' or '..' for %j (%s)", (input) => {
    const result = sanitiseFileName(input);
    expect(result).not.toMatch(/\//);
    expect(result).not.toMatch(/\\/);
    expect(result).not.toMatch(/\.\./);
  });

  // A key segment cannot be empty — this is the fallback the brief requires,
  // exercised by the two inputs that reduce to nothing once traversal tokens
  // and separators are gone.
  it.each([
    ["", "empty string"],
    ["...", "only dots"],
  ])("never returns an empty string for %j (%s)", (input) => {
    expect(sanitiseFileName(input)).not.toBe("");
    expect(sanitiseFileName(input).length).toBeGreaterThan(0);
  });

  it("strips a leading dot so nothing here reads as a dotfile", () => {
    const result = sanitiseFileName(".env");
    expect(result).not.toMatch(/^\./);
    expect(result).toBe("env");
  });

  it("preserves a readable name and extension for ordinary input", () => {
    expect(sanitiseFileName("invoice-2026.pdf")).toBe("invoice-2026.pdf");
    expect(sanitiseFileName("Quarterly Report.pdf")).toBe("Quarterly_Report.pdf");
  });

  // Legal-but-awkward: punctuation and unicode that a real OS accepts in a
  // filename but that has no business in a storage key or a URL path
  // segment. Neither the sanitised name nor a hash — the extension and the
  // legible parts of the name both survive.
  it("replaces characters that are legal in a filename but awkward in a key", () => {
    expect(sanitiseFileName("weird?name*.pdf")).toBe("weird_name_.pdf");
    expect(sanitiseFileName("résumé.pdf")).toBe("r_sum_.pdf");
  });
});

describe("buildFileKey", () => {
  it("produces {parentType}/{parentId}/{id}/{sanitised filename}", () => {
    expect(buildFileKey("TASK", "clxyz1", "cuidabc123", "invoice.pdf")).toBe(
      "TASK/clxyz1/cuidabc123/invoice.pdf"
    );
  });

  // The assertion that proves sanitisation actually reached key generation:
  // a hostile filename must not be able to add or remove segments, only
  // occupy the fourth one under a different string.
  it("keeps exactly four segments even when the filename is a traversal path", () => {
    const key = buildFileKey("TASK", "clxyz1", "cuidabc123", "../../etc/passwd");
    expect(key.split("/")).toHaveLength(4);
    expect(key).toBe("TASK/clxyz1/cuidabc123/etc_passwd");
  });

  it("uses the sanitised name, never the raw one", () => {
    const key = buildFileKey("PROJECT", "p1", "c1", "a/b.pdf");
    expect(key).not.toContain("a/b.pdf");
    expect(key).toBe("PROJECT/p1/c1/a_b.pdf");
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  // Asserted as a literal so a future edit to the constant's definition
  // fails loudly here rather than silently widening the limit.
  it("is exactly 25 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(26214400);
  });
});

describe("validateUpload", () => {
  it("accepts a file well under the limit", () => {
    expect(validateUpload("small.txt", 100)).toBeNull();
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateUpload("exact.bin", MAX_UPLOAD_BYTES)).toBeNull();
  });

  it("rejects a file one byte over the limit", () => {
    const error = validateUpload("over.bin", MAX_UPLOAD_BYTES + 1);
    expect(error).not.toBeNull();
    expect(typeof error).toBe("string");
  });

  it("names the file and states the limit in the rejection message", () => {
    const error = validateUpload("huge-video.mov", MAX_UPLOAD_BYTES + 1);
    expect(error).toContain("huge-video.mov");
    expect(error).toContain("25.0 MB");
  });
});

describe("formatFileSize", () => {
  // Contract: below 1 KB, a whole-number byte count; at 1 KB and above, one
  // decimal place in the largest binary unit (KB, then MB) that is still
  // >= 1 — no GB tier, since nothing this app stores approaches one.
  it("renders sub-kilobyte sizes as whole bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("renders the kilobyte boundary and fractional kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("renders the megabyte boundary and the upload limit", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(MAX_UPLOAD_BYTES)).toBe("25.0 MB");
  });
});
