-- Task.reference — the human-facing handle, rendered as MER-024.
--
-- Added in four steps rather than as `ADD COLUMN reference SERIAL`, because
-- SERIAL backfills existing rows in whatever order the heap scan returns. The
-- oldest task should be MER-001; that is the whole point of a number people
-- say out loud.

-- 1. Nullable first, so the ALTER succeeds against a table with rows.
ALTER TABLE "Task" ADD COLUMN "reference" INTEGER;

-- 2. Backfill in creation order. `id` breaks ties so the result is
--    deterministic even if two tasks share a createdAt.
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn FROM "Task"
)
UPDATE "Task" t SET "reference" = ordered.rn
FROM ordered WHERE t."id" = ordered."id";

-- 3. Hand the sequence to Postgres, starting after the highest backfilled
--    value. Owning it to the column means dropping the column drops the
--    sequence. Two simultaneous creates cannot now collide, which a max()+1
--    read in the service layer could never have promised.
CREATE SEQUENCE "Task_reference_seq" OWNED BY "Task"."reference";
SELECT setval('"Task_reference_seq"', COALESCE((SELECT MAX("reference") FROM "Task"), 0) + 1, false);
ALTER TABLE "Task" ALTER COLUMN "reference" SET DEFAULT nextval('"Task_reference_seq"');
ALTER TABLE "Task" ALTER COLUMN "reference" SET NOT NULL;

-- 4. Unique, so a number is never reused. Deleting MER-024 does not free 24:
--    a reference written in someone's notes must not later point at a
--    different task.
CREATE UNIQUE INDEX "Task_reference_key" ON "Task"("reference");
