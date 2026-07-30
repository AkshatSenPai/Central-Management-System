import type { PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";

async function countActiveAdmins(db: PrismaClient): Promise<number> {
  return db.user.count({ where: { role: "ADMIN", active: true } });
}

export async function setMemberActive(
  db: PrismaClient,
  input: { targetId: string; active: boolean; actorId: string }
): Promise<ActionResult> {
  if (!input.active && input.targetId === input.actorId) {
    return err("You cannot deactivate your own account");
  }
  const target = await db.user.findUnique({ where: { id: input.targetId } });
  if (!target) return err("Member not found");
  if (!input.active && target.role === "ADMIN" && target.active) {
    if ((await countActiveAdmins(db)) <= 1) {
      return err("Cannot deactivate the last active admin");
    }
  }
  await db.user.update({
    where: { id: input.targetId },
    data: { active: input.active },
  });
  return ok(undefined);
}

export async function setMemberRole(
  db: PrismaClient,
  input: { targetId: string; role: "ADMIN" | "MEMBER" }
): Promise<ActionResult> {
  const target = await db.user.findUnique({ where: { id: input.targetId } });
  if (!target) return err("Member not found");
  if (target.role === "ADMIN" && input.role === "MEMBER" && target.active) {
    if ((await countActiveAdmins(db)) <= 1) {
      return err("Cannot demote the last active admin");
    }
  }
  await db.user.update({
    where: { id: input.targetId },
    data: { role: input.role },
  });
  return ok(undefined);
}
