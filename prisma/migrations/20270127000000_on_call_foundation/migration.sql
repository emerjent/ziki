-- On-call agents and the 12 Nov security plan foundation (#on-call, #security-checks).
-- CreateEnum
CREATE TYPE "OnCallInviteStatus" AS ENUM ('pending', 'accepted', 'declined', 'cancelled');

-- AlterTable
-- Rename, not drop and add: agents already marked always-on stay on call.
ALTER TABLE "Agent" RENAME COLUMN "alwaysOnAt" TO "onCallAt";
ALTER TABLE "Agent" ADD COLUMN "securityClearedAt" TIMESTAMP(3);
-- Agents already on call do security-check jobs today, so they keep that clearance.
UPDATE "Agent" SET "securityClearedAt" = "onCallAt" WHERE "onCallAt" IS NOT NULL;

-- AlterTable
ALTER TABLE "AgentActivation" ADD COLUMN     "guestEndedAt" TIMESTAMP(3),
ADD COLUMN     "guestUntilFirstDelivery" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SecurityCheck" ADD COLUMN     "free" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SecurityCheckResult" ADD COLUMN     "payoutReleasedAt" TIMESTAMP(3),
ADD COLUMN     "priceCoins" INTEGER,
ADD COLUMN     "unlockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OnCallInvite" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "clearForSecurity" BOOLEAN NOT NULL DEFAULT false,
    "status" "OnCallInviteStatus" NOT NULL DEFAULT 'pending',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnCallInvite_agentId_status_idx" ON "OnCallInvite"("agentId", "status");

-- CreateIndex
CREATE INDEX "OnCallInvite_status_createdAt_idx" ON "OnCallInvite"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityCheckResult_checkId_unlockedAt_idx" ON "SecurityCheckResult"("checkId", "unlockedAt");

-- AddForeignKey
ALTER TABLE "OnCallInvite" ADD CONSTRAINT "OnCallInvite_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallInvite" ADD CONSTRAINT "OnCallInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


