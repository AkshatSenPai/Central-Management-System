import { describe, it, expect } from "vitest";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { withNormalizedEmail } from "@/lib/auth-adapter";

describe("withNormalizedEmail", () => {
  it("normalizes the email passed to getUserByEmail (Google linking lookup)", async () => {
    const lookedUp: string[] = [];
    const base = {
      getUserByEmail: async (email: string) => {
        lookedUp.push(email);
        return null;
      },
    } as Adapter;
    await withNormalizedEmail(base).getUserByEmail!("  Jo@Example.COM ");
    expect(lookedUp).toEqual(["jo@example.com"]);
  });

  it("normalizes the email on createUser", async () => {
    const created: AdapterUser[] = [];
    const base = {
      createUser: async (user: AdapterUser) => {
        created.push(user);
        return user;
      },
    } as Adapter;
    await withNormalizedEmail(base).createUser!({
      id: "u1",
      email: " New@Example.COM ",
      emailVerified: null,
    });
    expect(created[0].email).toBe("new@example.com");
  });

  it("passes other adapter methods through untouched", () => {
    const getUserByAccount = async () => null;
    const base = { getUserByAccount } as unknown as Adapter;
    expect(withNormalizedEmail(base).getUserByAccount).toBe(getUserByAccount);
  });

  it("leaves methods undefined when the base adapter lacks them", () => {
    const adapter = withNormalizedEmail({} as Adapter);
    expect(adapter.getUserByEmail).toBeUndefined();
    expect(adapter.createUser).toBeUndefined();
  });
});
