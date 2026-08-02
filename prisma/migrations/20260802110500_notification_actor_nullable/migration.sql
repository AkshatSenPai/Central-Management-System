-- TASK_DUE_SOON is written by the reminder cron and has no actor: a deadline
-- arriving is not something anybody did. Caught while writing the renderer,
-- before any row existed — the alternative was inventing a system user, or
-- naming the recipient as their own actor, either of which would make every
-- reader of this column check for a sentinel instead of a null.
ALTER TABLE "Notification" ALTER COLUMN "actorId" DROP NOT NULL;
