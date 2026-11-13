-- CreateEnum
CREATE TYPE "SecurityTargetKind" AS ENUM ('website', 'server', 'repo');

-- CreateEnum
CREATE TYPE "SecurityCheckStatus" AS ENUM ('awaiting_ownership', 'queued', 'splitting', 'checking', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "SecurityCheckItemKind" AS ENUM ('split', 'check');

-- CreateEnum
CREATE TYPE "SecurityCheckItemStatus" AS ENUM ('waiting', 'checking', 'done', 'skipped');

-- CreateTable
CREATE TABLE "SecurityTarget" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "SecurityTargetKind" NOT NULL,
    "value" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "ownershipToken" TEXT NOT NULL,
    "ownershipMethod" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityCheck" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "projectId" TEXT,
    "requestedById" TEXT NOT NULL,
    "status" "SecurityCheckStatus" NOT NULL DEFAULT 'awaiting_ownership',
    "priceCoins" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityCheckItem" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "kind" "SecurityCheckItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "status" "SecurityCheckItemStatus" NOT NULL DEFAULT 'waiting',
    "agentId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "payoutReleasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityCheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityCheckResult" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "severity" "SecuritySeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "howToFix" TEXT NOT NULL,
    "findingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityCheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityTarget_ownershipToken_key" ON "SecurityTarget"("ownershipToken");

-- CreateIndex
CREATE INDEX "SecurityTarget_organisationId_createdAt_idx" ON "SecurityTarget"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityTarget_organisationId_kind_value_key" ON "SecurityTarget"("organisationId", "kind", "value");

-- CreateIndex
CREATE INDEX "SecurityCheck_organisationId_createdAt_idx" ON "SecurityCheck"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityCheck_targetId_createdAt_idx" ON "SecurityCheck"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityCheck_status_idx" ON "SecurityCheck"("status");

-- CreateIndex
CREATE INDEX "SecurityCheckItem_checkId_status_idx" ON "SecurityCheckItem"("checkId", "status");

-- CreateIndex
CREATE INDEX "SecurityCheckItem_agentId_status_idx" ON "SecurityCheckItem"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityCheckResult_findingId_key" ON "SecurityCheckResult"("findingId");

-- CreateIndex
CREATE INDEX "SecurityCheckResult_checkId_severity_idx" ON "SecurityCheckResult"("checkId", "severity");

-- CreateIndex
CREATE INDEX "SecurityCheckResult_itemId_idx" ON "SecurityCheckResult"("itemId");

-- AddForeignKey
ALTER TABLE "SecurityTarget" ADD CONSTRAINT "SecurityTarget_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityTarget" ADD CONSTRAINT "SecurityTarget_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityCheck" ADD CONSTRAINT "SecurityCheck_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityCheck" ADD CONSTRAINT "SecurityCheck_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "SecurityTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityCheck" ADD CONSTRAINT "SecurityCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityCheck" ADD CONSTRAINT "SecurityCheck_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityCheckItem" ADD CONSTRAINT "SecurityCheckItem_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "SecurityCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityCheckItem" ADD CONSTRAINT "SecurityCheckItem_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityCheckResult" ADD CONSTRAINT "SecurityCheckResult_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "SecurityCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityCheckResult" ADD CONSTRAINT "SecurityCheckResult_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SecurityCheckItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityCheckResult" ADD CONSTRAINT "SecurityCheckResult_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "SecurityFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

