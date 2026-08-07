import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { generateTemporaryPassword, hashPassword } from "@/lib/password";
import { orphanOpenSessionFor } from "@/lib/attendance-service";

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

  // Deactivating someone who is still punched in must close their session in
  // the same transaction. They are about to be signed out by
  // `refreshTokenFromDb` and to vanish from `listTeamCards` (which filters to
  // active members), so an open row left behind is unresolvable by anyone
  // afterwards — attendance is owner-only by ruling, and the owner is gone.
  // It is discarded rather than closed at this instant because nobody knows
  // when they actually stopped working.
  const isDeactivation = !input.active && target.active;
  const now = new Date();

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
        if (isDeactivation) {
          await orphanOpenSessionFor(tx, {
            memberId: input.targetId,
            actorId: input.actorId,
            now,
          });
        }
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

  // A transaction on this path too, now that it may write two rows: the user
  // update and the orphaned session must land together or not at all.
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.targetId },
      data: { active: input.active },
    });
    if (isDeactivation) {
      await orphanOpenSessionFor(tx, { memberId: input.targetId, actorId: input.actorId, now });
    }
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

/**
 * Admin reset for a member who cannot sign in at all. Generates a temporary
 * password, stores its hash, and **returns the plaintext exactly once** —
 * the caller shows it to the admin and it exists nowhere else. It is never
 * logged and never stored, because only the hash is kept, so an admin who
 * navigates away before sending it must reset again.
 *
 * This exists because there was previously no recovery path whatsoever:
 * `passwordHash` was written in exactly one place, `redeemInvite`, and that
 * function refuses an email that already has an account. A mistyped password
 * at signup was permanent, and the only remedy was writing a hash directly
 * to the production database.
 *
 * **Self-reset is refused**, the same call `setMemberActive` makes for
 * self-deactivation. An admin changing their own password uses
 * `changeOwnPassword`, which requires knowing the current one. Without this
 * guard, "reset my own password" becomes a documented way around that check,
 * and an unlocked admin laptop is a two-click account takeover.
 *
 * There is deliberately **no active-admin invariant** here, unlike
 * `setMemberActive`. Resetting a password changes neither who is an admin
 * nor how many accounts are active — the account stays exactly as privileged
 * as it was, so none of that function's serializable-transaction machinery
 * applies. An inactive member can be reset too: an admin reactivating
 * someone will often reset them in the same sitting, and refusing would
 * force an order for no reason. `authenticate` (`credentials.ts`) still
 * rejects an inactive user before it checks any password, so a reset alone
 * never grants access.
 */
export async function resetMemberPassword(
  db: PrismaClient,
  input: { targetId: string; actorId: string }
): Promise<ActionResult<{ temporaryPassword: string }>> {
  if (input.targetId === input.actorId) {
    return err("Use your profile to change your own password");
  }

  const target = await db.user.findUnique({ where: { id: input.targetId } });
  if (!target) return err("Member not found");

  const temporaryPassword = generateTemporaryPassword();
  await db.user.update({
    where: { id: input.targetId },
    data: { passwordHash: await hashPassword(temporaryPassword) },
  });
  return ok({ temporaryPassword });
}
