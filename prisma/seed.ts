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

  const launch = await prisma.project.upsert({
    where: { clientId_name: { clientId: harlow.id, name: "Launch Toolkit" } },
    update: {},
    create: {
      clientId: harlow.id,
      name: "Launch Toolkit",
      description: "Everything the team needs on launch day.",
      status: "IN_PROGRESS",
      health: "ON_TRACK",
      dueDate: new Date("2026-09-12T00:00:00Z"),
    },
  });

  // Task has no unique column and two tasks may legitimately share a title, so
  // idempotency is a count guard rather than an upsert.
  if ((await prisma.task.count({ where: { projectId: launch.id } })) === 0) {
    const rows: { title: string; status: "TO_DO" | "IN_PROGRESS" | "REVIEW" | "DONE"; order: number }[] = [
      { title: "Agree the launch checklist", status: "DONE", order: 0 },
      { title: "Write the announcement post", status: "DONE", order: 1 },
      { title: "Build the landing section", status: "IN_PROGRESS", order: 2 },
      { title: "Proof the press kit", status: "REVIEW", order: 3 },
      { title: "Schedule the social queue", status: "TO_DO", order: 4 },
    ];
    for (const row of rows) {
      await prisma.task.create({
        data: {
          projectId: launch.id,
          creatorId: adminId,
          title: row.title,
          status: row.status,
          priority: "MEDIUM",
          order: row.order,
          assignees: { create: [{ userId: adminId }] },
        },
      });
    }
  }

  if ((await prisma.task.count({ where: { projectId: null, creatorId: adminId } })) === 0) {
    await prisma.task.create({
      data: { creatorId: adminId, title: "Review the quarterly numbers", status: "IN_PROGRESS", priority: "HIGH", order: 0,
              assignees: { create: [{ userId: adminId }] } },
    });
    await prisma.task.create({
      data: { creatorId: adminId, title: "Book the team offsite", status: "TO_DO", priority: "LOW", order: 1,
              assignees: { create: [{ userId: adminId }] } },
    });
  }

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
