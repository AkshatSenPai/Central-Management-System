import { describe, it, expect } from "vitest";
import { clientSchema, contactSchema, clientInitials, clientListSummary } from "@/lib/client";

const valid = {
  name: "Harlow & Fitch",
  status: "ACTIVE",
  sector: "Retail & apparel",
  website: "https://harlowfitch.com",
  engagementType: "Retainer",
  clientSince: "2024-03-01",
  accountLeadId: "u1",
  notes: "Long-standing retainer.",
};

describe("clientSchema", () => {
  it("rejects a blank name", () => {
    const parsed = clientSchema.safeParse({ ...valid, name: "   " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Client name is required");
  });

  it("trims surrounding whitespace from the name", () => {
    const parsed = clientSchema.safeParse({ ...valid, name: "  Harlow & Fitch  " });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("Harlow & Fitch");
  });

  it("rejects a name over 120 characters", () => {
    expect(clientSchema.safeParse({ ...valid, name: "a".repeat(121) }).success).toBe(false);
  });

  it("accepts empty sector, website, engagement type, notes and account lead", () => {
    const parsed = clientSchema.safeParse({
      ...valid,
      sector: "",
      website: "",
      engagementType: "",
      clientSince: "",
      accountLeadId: "",
      notes: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a website that is not http(s)", () => {
    const parsed = clientSchema.safeParse({ ...valid, website: "javascript:alert(1)" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Website must be an http(s) URL");
  });

  it("rejects an unknown status", () => {
    expect(clientSchema.safeParse({ ...valid, status: "ARCHIVED" }).success).toBe(false);
  });
});

describe("contactSchema", () => {
  it("requires a contact name", () => {
    const parsed = contactSchema.safeParse({ name: "  ", email: "", phone: "", role: "" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Contact name is required");
  });

  it("rejects a malformed email", () => {
    const parsed = contactSchema.safeParse({ name: "Dana Reeve", email: "not-an-email" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Enter a valid email address");
  });

  it("accepts an empty email, phone and role", () => {
    expect(contactSchema.safeParse({ name: "Dana Reeve", email: "", phone: "", role: "" }).success).toBe(true);
  });

  it("trims the name", () => {
    const parsed = contactSchema.safeParse({ name: "  Dana Reeve  " });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("Dana Reeve");
  });
});

describe("clientInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(clientInitials("Harlow & Fitch")).toBe("HF");
  });

  it("falls back to the first two letters of a single word", () => {
    expect(clientInitials("Northwind")).toBe("NO");
  });

  it("trims and uppercases", () => {
    expect(clientInitials("  a b c ")).toBe("AB");
  });
});

describe("clientListSummary", () => {
  it('reads "5 clients · 4 active" and "1 client · 1 active"', () => {
    const five = [
      { status: "ACTIVE" },
      { status: "ACTIVE" },
      { status: "ACTIVE" },
      { status: "ACTIVE" },
      { status: "FORMER" },
    ];
    expect(clientListSummary(five)).toBe("5 clients · 4 active");
    expect(clientListSummary([{ status: "ACTIVE" }])).toBe("1 client · 1 active");
  });
});
