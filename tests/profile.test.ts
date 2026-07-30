import { describe, it, expect } from "vitest";
import { profileSchema } from "@/lib/profile";

describe("profileSchema", () => {
  it("accepts a full valid profile", () => {
    const result = profileSchema.safeParse({
      name: "  Jo Smith ",
      title: "Designer",
      phone: "+91 98765 43210",
      avatarUrl: "https://example.com/a.png",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Jo Smith");
  });

  it("accepts empty optional fields", () => {
    const result = profileSchema.safeParse({
      name: "Jo",
      title: "",
      phone: "",
      avatarUrl: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    expect(profileSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a non-URL avatar", () => {
    expect(
      profileSchema.safeParse({ name: "Jo", avatarUrl: "not-a-url" }).success
    ).toBe(false);
  });
});
