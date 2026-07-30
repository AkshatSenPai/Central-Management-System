import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The real PrismaClient spins up an engine on construction; these tests only
// exercise the module's env handling, so stub both packages out.
vi.mock("@prisma/client", () => ({ PrismaClient: class PrismaClient {} }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class PrismaPg {} }));

const globalForPrisma = globalThis as unknown as { prisma?: unknown };
const originalUrl = process.env.DATABASE_URL;

describe("prisma client bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalForPrisma.prisma;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    delete globalForPrisma.prisma;
  });

  it("throws a clear error when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    await expect(import("@/lib/prisma")).rejects.toThrow(/DATABASE_URL is not set/);
  });

  it("constructs the client when DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    const { prisma } = await import("@/lib/prisma");
    expect(prisma).toBeDefined();
  });
});
