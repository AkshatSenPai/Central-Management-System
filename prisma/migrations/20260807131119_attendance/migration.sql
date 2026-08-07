-- CreateEnum
CREATE TYPE "AttendanceResolution" AS ENUM ('PUNCH_OUT', 'CORRECTED', 'DISCARDED');

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "resolution" "AttendanceResolution",
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSession_memberId_startedAt_idx" ON "AttendanceSession"("memberId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_memberId_key" ON "AttendanceSession"("memberId") WHERE ("resolution" IS NULL);

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
