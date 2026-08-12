-- CreateEnum
CREATE TYPE "ContractKind" AS ENUM ('PROPOSAL', 'ONE_TIME', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ContractPlan" AS ENUM ('STARTER', 'STANDARD', 'ADVANCED', 'WEBSITE');

-- CreateEnum
CREATE TYPE "ContractAdSetup" AS ENUM ('NONE', 'META', 'GOOGLE', 'BOTH');

-- CreateEnum
CREATE TYPE "ContractWebsiteTier" AS ENUM ('BUSINESS', 'PREMIUM', 'FLAGSHIP');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "ContractKind" NOT NULL,
    "trial" BOOLEAN NOT NULL DEFAULT false,
    "plan" "ContractPlan" NOT NULL,
    "ads" "ContractAdSetup" NOT NULL DEFAULT 'NONE',
    "websiteTier" "ContractWebsiteTier",
    "realEstate" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "agreementNo" TEXT,
    "year" INTEGER,
    "sequence" INTEGER,
    "clientName" TEXT NOT NULL,
    "clientFirm" TEXT NOT NULL,
    "clientPhone" TEXT,
    "clientEmail" TEXT,
    "projectName" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "timeline" TEXT,
    "campaignStartDate" TIMESTAMP(3),
    "gracePeriod" TEXT,
    "paidAmount" TEXT,
    "paidDate" TIMESTAMP(3),
    "counterpartAgreementNo" TEXT,
    "templatePath" TEXT,
    "issuedHtml" TEXT,
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_agreementNo_key" ON "Contract"("agreementNo");

-- CreateIndex
-- The register's race guard: two simultaneous issues cannot both take 055.
CREATE UNIQUE INDEX "Contract_kind_year_sequence_key" ON "Contract"("kind", "year", "sequence");

-- CreateIndex
CREATE INDEX "Contract_clientId_createdAt_idx" ON "Contract"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Contract_status_createdAt_idx" ON "Contract"("status", "createdAt");

-- AddForeignKey
-- RESTRICT: a contract register with holes in it cannot be audited, so a
-- client with contracts cannot be deleted. See the note on Contract.client.
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
