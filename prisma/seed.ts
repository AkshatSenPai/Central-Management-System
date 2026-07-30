import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";
import { normalizeEmail } from "../src/lib/email";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Demo clients and projects, behind SEED_DEMO=true. Keyed on unique columns
 * with empty `update` blocks so re-running is a no-op. */
async function seedDemo(prisma: PrismaClient, adminId: string) {
  const harlow = await prisma.client.upsert({
    where: { name: "Harlow & Fitch" },
    update: {},
    create: {
      name: "Harlow & Fitch",
      status: "ACTIVE",
      sector: "Retail & apparel",
      website: "https://harlowfitch.com",
      engagementType: "Retainer",
      clientSince: new Date("2024-03-01T00:00:00Z"),
      accountLeadId: adminId,
      contacts: {
        create: [
          { name: "Dana Reeve", email: "dana@harlowfitch.com", role: "Marketing Director", isPrimary: true },
          { name: "Tom Iversen", email: "tom@harlowfitch.com", role: "Brand Manager" },
        ],
      },
    },
  });

  const verity = await prisma.client.upsert({
    where: { name: "Verity Health" },
    update: {},
    create: {
      name: "Verity Health",
      status: "PAUSED",
      sector: "Healthcare",
      website: "https://verityhealth.example",
      engagementType: "Project",
      clientSince: new Date("2025-01-01T00:00:00Z"),
      contacts: {
        create: [{ name: "Priya Kohli", email: "priya@verityhealth.example", role: "Head of Digital", isPrimary: true }],
      },
    },
  });

  await prisma.project.upsert({
    where: { clientId_name: { clientId: harlow.id, name: "Brand Guidelines v3" } },
    update: {},
    create: {
      clientId: harlow.id,
      name: "Brand Guidelines v3",
      description: "Refresh the identity system and ship a new guidelines site.",
      status: "IN_PROGRESS",
      health: "AT_RISK",
      dueDate: new Date("2026-08-14T00:00:00Z"),
      milestones: {
        create: [
          { title: "Discovery sign-off", order: 0, completedAt: new Date("2026-06-12T00:00:00Z") },
          { title: "Design system freeze", order: 1, completedAt: new Date("2026-07-03T00:00:00Z") },
          { title: "Campaign pages build", order: 2, dueDate: new Date("2026-08-14T00:00:00Z") },
          { title: "Launch & QA", order: 3, dueDate: new Date("2026-08-29T00:00:00Z") },
        ],
      },
    },
  });

  // Deliberately has no milestones: the fixture that proves the
  // AUTO-with-no-units "—" state rather than a misleading 0%.
  await prisma.project.upsert({
    where: { clientId_name: { clientId: harlow.id, name: "Spring Campaign Site" } },
    update: {},
    create: {
      clientId: harlow.id,
      name: "Spring Campaign Site",
      status: "PLANNING",
      health: "ON_TRACK",
      dueDate: new Date("2026-09-30T00:00:00Z"),
    },
  });

  await prisma.project.upsert({
    where: { clientId_name: { clientId: verity.id, name: "Patient Portal UX" } },
    update: {},
    create: {
      clientId: verity.id,
      name: "Patient Portal UX",
      status: "ON_HOLD",
      health: "BLOCKED",
      progressMode: "MANUAL",
      manualProgress: 40,
    },
  });

  console.log("Demo clients and projects ready");
}

async function main() {
  const email = process.env.ADMIN_EMAIL ? normalizeEmail(process.env.ADMIN_EMAIL) : undefined;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Admin";
  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before seeding");
  }
  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash, role: "ADMIN" },
  });
  console.log(`Admin user ready: ${email}`);

  if (process.env.SEED_DEMO === "true") {
    await seedDemo(prisma, admin.id);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
