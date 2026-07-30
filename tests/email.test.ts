import { describe, it, expect } from "vitest";
import { normalizeEmail } from "@/lib/email";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Jo@Example.COM ")).toBe("jo@example.com");
  });

  it("is a no-op on an already-normalized email", () => {
    expect(normalizeEmail("jo@example.com")).toBe("jo@example.com");
  });

  it("trims internal-safe whitespace only at the ends", () => {
    expect(normalizeEmail("\t jo@example.com\n")).toBe("jo@example.com");
  });
});
