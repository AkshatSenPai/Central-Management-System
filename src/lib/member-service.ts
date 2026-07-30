import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";

/** Internal sentinel thrown inside a transaction when the post-update recount
 * shows zero active admins remain — caught and mapped to the friendly guard
 * error for the calling function. Never escapes this module. */
class AdminInvariantError extends Error {}

/** Serializable closes the mutual-demotion window READ COMMITTED leaves open:
 * two concurrent transactions can each see the other's admin as still active
 * in their recount, both commit, and zero active admins remain. */
const SERIALIZABLE = { isolationLevel: "Serializable" } as const;

/** Under Serializable, the losing side of a conflicting pair fails with P2034
 * instead of committing — the caller just needs to retry. */
function isSerializationConflict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
}

const CONFLICT_MESSAGE = "Another member change happened at the same time. Try again.";

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

  const reducesActiveAdmins = !input.active && target.role === "ADMIN" && target.active;

  if (reducesActiveAdmins) {
    // Fast friendly path: catches the common case cheaply.
    if ((await countActiveAdmins(db)) <= 1) {
      return err("Cannot deactivate the last active admin");
    }
    // Backstop: two concurrent requests can both pass the check above before
    // either commits. Re-verify the invariant inside the same transaction as
    // the write so a concurrent race can't zero out active admins.
    try {
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: input.targetId },
          data: { active: input.active },
        });
        const remaining = await tx.user.count({ where: { role: "ADMIN", active: true } });
        if (remaining < 1) throw new AdminInvariantError();
      }, SERIALIZABLE);
    } catch (e) {
      if (e instanceof AdminInvariantError) {
        return err("Cannot deactivate the last active admin");
      }
      if (isSerializationConflict(e)) return err(CONFLICT_MESSAGE);
      throw e;
    }
    return ok(undefined);
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

  const reducesActiveAdmins = target.role === "ADMIN" && input.role === "MEMBER" && target.active;

  if (reducesActiveAdmins) {
    // Fast friendly path: catches the common case cheaply.
    if ((await countActiveAdmins(db)) <= 1) {
      return err("Cannot demote the last active admin");
    }
    // Backstop: two concurrent requests can both pass the check above before
    // either commits. Re-verify the invariant inside the same transaction as
    // the write so a concurrent race can't zero out active admins.
    try {
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: input.targetId },
          data: { role: input.role },
        });
        const remaining = await tx.user.count({ where: { role: "ADMIN", active: true } });
        if (remaining < 1) throw new AdminInvariantError();
      }, SERIALIZABLE);
    } catch (e) {
      if (e instanceof AdminInvariantError) {
        return err("Cannot demote the last active admin");
      }
      if (isSerializationConflict(e)) return err(CONFLICT_MESSAGE);
      throw e;
    }
    return ok(undefined);
  }

  await db.user.update({
    where: { id: input.targetId },
    data: { role: input.role },
  });
  return ok(undefined);
}
