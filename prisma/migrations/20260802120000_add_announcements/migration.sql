-- Announcement (spec 6.3) plus the notification type for "new announcement"
-- from spec 5.7. Purely additive: one new table, one new enum value.

ALTER TYPE "NotificationType" ADD VALUE 'ANNOUNCEMENT_POSTED';

CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    -- Null means never pinned; a past date means pinned and lapsed. The row
    -- keeps the history rather than nulling it, so "this was pinned until
    -- Friday" stays answerable.
    "pinnedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");
CREATE INDEX "Announcement_pinnedUntil_idx" ON "Announcement"("pinnedUntil");

-- RESTRICT, not CASCADE: deleting a member must not silently erase the
-- notices they posted to the whole studio.
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
