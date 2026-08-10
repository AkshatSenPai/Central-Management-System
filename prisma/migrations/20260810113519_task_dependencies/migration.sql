-- CreateTable
CREATE TABLE "TaskDependency" (
    "blockedTaskId" TEXT NOT NULL,
    "blockerTaskId" TEXT NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("blockedTaskId","blockerTaskId")
);

-- CreateIndex
CREATE INDEX "TaskDependency_blockerTaskId_idx" ON "TaskDependency"("blockerTaskId");

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_blockedTaskId_fkey" FOREIGN KEY ("blockedTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_blockerTaskId_fkey" FOREIGN KEY ("blockerTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
