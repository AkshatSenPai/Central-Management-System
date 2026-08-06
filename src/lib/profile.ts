import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { hashPassword, validatePasswordChange, verifyPassword } from "@/lib/password";

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  title: z.string().trim().max(100).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  avatarUrl: z
    .string()
    .trim()
    .url("Avatar must be a valid URL")
    .refine((v) => /^https?:\/\//i.test(v), "Avatar must be an http(s) URL")
    .optional()
    .or(z.literal("")),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/** One message for two different failures — a wrong current password, and a
 * row that has no `passwordHash` at all (a Google-only account). Telling
 * them apart would report something about an account the caller has not
 * authenticated to, and neither case has a different remedy: you cannot
 * proceed without the current password either way. */
const WRONG_CURRENT = "Current password is incorrect";

/**
 * Self-service password change.
 *
 * **`userId` comes from the session, never from a form.** That is the whole
 * authorisation model. This function can only ever update the row belonging
 * to whoever is signed in, so there is no target to tamper with and no admin
 * branch to get wrong — a caller cannot express "change someone else's
 * password" in this signature at all.
 *
 * **Verifying `current` is the other half.** Without it, anyone reaching an
 * unlocked laptop takes permanent ownership of the account: they set a new
 * password, the real owner is locked out, and this app has no email recovery
 * to get back in through. That is not hypothetical here — it is exactly the
 * state a colleague was left in the day before this was written, and the
 * only way out was writing a hash directly to the production database.
 *
 * Validation runs before the read, so a rejected change costs nothing. The
 * read happens before the write, so a wrong current password never reaches
 * an `update` at all.
 */
export async function changeOwnPassword(
  db: Pick<PrismaClient, "user">,
  input: { userId: string; current: string; next: string; confirm: string }
): Promise<ActionResult> {
  const validationError = validatePasswordChange({
    next: input.next,
    confirm: input.confirm,
    current: input.current,
  });
  if (validationError) return err(validationError);

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true },
  });
  if (!user?.passwordHash) return err(WRONG_CURRENT);

  if (!(await verifyPassword(user.passwordHash, input.current))) {
    return err(WRONG_CURRENT);
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.next) },
  });
  return ok(undefined);
}
