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

  // Fix round 2, finding 3: only the leading dot was stripped before —
  // trailing dots survived unchanged, an asymmetry rather than a
  // considered choice. Windows silently drops a trailing dot on write,
  // which makes a key ending in one a latent footgun for any tool that
  // materialises it.
  it("strips a trailing dot too, not just a leading one", () => {
    expect(sanitiseFileName("file.")).toBe("file");
    expect(sanitiseFileName("invoice.pdf.")).toBe("invoice.pdf");
  });

  // Fix round 2, finding 2: R2 caps an object key at 1024 UTF-8 bytes;
  // sanitiseFileName caps its own contribution at 255 (the classic
  // per-component filesystem limit — see the constant's comment for the
  // arithmetic against the 1024-byte key budget). At the threshold itself
  // nothing changes; one character past it, the name is cut but the
  // extension survives.
  it("leaves a name at the 255-byte threshold untouched", () => {
    const exactly255 = "b".repeat(251) + ".txt";
    expect(exactly255.length).toBe(255);
    expect(sanitiseFileName(exactly255)).toBe(exactly255);
  });

  it("truncates a name past the 255-byte threshold, preserving the extension", () => {
    const oneOver = "b".repeat(252) + ".txt";
    expect(sanitiseFileName(oneOver)).toBe("b".repeat(251) + ".txt");
  });

  // The truncation cut is a plain string slice, which can land right after
  // an internal dot in the base name — and appending the real extension's
  // own leading dot right after that would recreate the exact ".." pattern
  // this whole file exists to keep out. Constructed so the 255-byte cut
  // falls immediately after the embedded "." in `base`, so this only
  // passes if the post-truncation collapseAndTrimDots pass actually runs.
  it("does not let truncation recreate '..' at the base/extension boundary", () => {
    const base = "x".repeat(250) + "." + "y".repeat(100);
    const hostile = `${base}.pdf`;
    const result = sanitiseFileName(hostile);
    expect(result).not.toMatch(/\.\./);
    expect(result.endsWith(".pdf")).toBe(true);
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

  // Fix round 2, finding 1: sanitiseFileName only ever touched fileName —
  // parentId and id reached the template string completely untouched, so
  // either one could add or remove segments of its own. parentId and id
  // are meant to be strict identifiers (a Prisma row id, this attachment's
  // own cuid), not display strings, so a malformed one throws rather than
  // being silently rewritten — see assertSafeKeySegment's comment for why.
  it("throws if parentId is a traversal path instead of a real id", () => {
    expect(() => buildFileKey("TASK", "../../secrets", "cuidabc", "invoice.pdf")).toThrow();
  });

  it("throws if id is a traversal path instead of a real id", () => {
    expect(() => buildFileKey("TASK", "clxyz1", "../../secrets", "invoice.pdf")).toThrow();
  });

  it("throws if parentId contains a slash", () => {
    expect(() => buildFileKey("TASK", "a/b", "cuidabc", "invoice.pdf")).toThrow();
  });

  it("throws if id contains a backslash", () => {
    expect(() => buildFileKey("TASK", "clxyz1", "a\\b", "invoice.pdf")).toThrow();
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

  // Fix round 1: formatFileSize rounds to one decimal place, so
  // MAX_UPLOAD_BYTES + 1 formats identically to MAX_UPLOAD_BYTES itself
  // ("25.0 MB" both sides). The old message ("X is 25.0 MB — the limit is
  // 25.0 MB") printed the limit text twice and read as the app
  // contradicting itself right at the boundary that matters most. This is
  // the regression test for that: the limit string must appear at most
  // once, which only holds because the message no longer states the file's
  // own (rounded) size at all.
  it("never prints the limit text twice at the one-byte-over boundary", () => {
    const error = validateUpload("a.pdf", MAX_UPLOAD_BYTES + 1);
    expect(error).not.toBeNull();
    const limitText = formatFileSize(MAX_UPLOAD_BYTES);
    const occurrences = error!.split(limitText).length - 1;
    expect(occurrences).toBe(1);
  });

  // Fix round 1, zero-byte ruling: reject. Recorded and tested at both
  // sides of the boundary per the brief — see the doc comment on
  // validateUpload in src/lib/attachment.ts for the reasoning.
  it("rejects a zero-byte upload", () => {
    const error = validateUpload("empty.txt", 0);
    expect(error).not.toBeNull();
    expect(error).toContain("empty.txt");
  });

  it("accepts a one-byte upload", () => {
    expect(validateUpload("tiny.txt", 1)).toBeNull();
  });

  // Fix round 2, finding 5: the `sizeBytes <= 0` guard was documented as
  // covering negatives defensively but nothing asserted it — a future
  // narrowing to `=== 0` would let a negative size through unnoticed.
  it("rejects a negative size", () => {
    expect(validateUpload("x.pdf", -1)).not.toBeNull();
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

  // Fix round 2, finding 4: one byte under a megabyte divides out to
  // 1023.999... KB, which rounds to 1024.0 at one decimal place — a value
  // that belongs in the MB tier, not still reading as KB.
  it("rounds a near-megabyte value into the MB tier instead of reporting 1024.0 KB", () => {
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1.0 MB");
  });
});
